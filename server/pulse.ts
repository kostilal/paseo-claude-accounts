import { createHash } from "node:crypto";
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { AccountView, Bar } from "../shared/accounts.ts";
import { accountById, type Registry } from "../shared/registry.ts";
import { usageOrder } from "./groupUsage.ts";
import type { UsageInfo } from "./limits.ts";
import type { EventRing, EventsPage } from "./pulse-events.ts";
import type { UsageResult } from "./usage.ts";

/**
 * Claude Accounts as a source of Paseo Pulse, which shows plugins' readings in Paseo, in
 * widgets and in notifications (contract `paseo.pulse/1`). Three RPCs and nothing else:
 * `meta.pulse` says what there is (the manifest), `accounts.pulse` reads it, and
 * `accounts.pulse-events` hands over what happened since a cursor (server/pulse-events.ts).
 *
 * The readings are only what the plugin already holds: the logins as the Accounts screen last
 * saw them (server/snapshot.ts) with the usage cache laid over them (server/usage.ts). Nothing
 * here measures, asks Anthropic or starts a process, so polling it costs nothing; a login whose
 * numbers have not been measured lately reads as stale, not as refreshed. Pulse offers no
 * actions: switching a chat's account restarts the chat and needs a chat to say which, which a
 * widget or a notification cannot give. Emails never leave the plugin: a login is an opaque id
 * and "Account N", with its plan beside it.
 *
 * The "Show in Pulse" switch in the plugin's settings takes the readings out and silences the
 * events; the handlers themselves never refuse, since they cannot tell Pulse from anybody else.
 */

export const PULSE_SCHEMA = "paseo.pulse/1";

// The daemon parses every answer with its contract's output schema, and a plain z.object drops
// the keys it does not name, so these shells are loose on purpose: Pulse validates the
// contract, this only says which answer it is.
export const pulseManifestRpc = defineRpc({
  name: "meta.pulse",
  input: z.object({}),
  output: z.looseObject({ schema: z.literal(PULSE_SCHEMA), manifestRev: z.string() }),
});

export const pulseSnapshotRpc = defineRpc({
  name: "accounts.pulse",
  input: z.object({ ifRev: z.string().optional() }),
  // A full snapshot, or { unchanged: true, rev } when `ifRev` is still the current one.
  output: z.looseObject({ schema: z.literal(PULSE_SCHEMA), rev: z.string() }),
});

export const pulseEventsRpc = defineRpc({
  name: "accounts.pulse-events",
  input: z.object({ after: z.string().nullable().optional(), limit: z.number().int().positive().optional() }),
  output: z.looseObject({ schema: z.literal(PULSE_SCHEMA), head: z.string() }),
});

interface Text {
  en: string;
  ru: string;
  uk: string;
}
const t = (en: string, ru: string, uk: string): Text => ({ en, ru, uk });

/** Objects with sorted keys, so the same values always hash the same. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
  );
}

/** The contract's revision hash: what crosses the wire (undefined keys gone), keys sorted. */
export function pulseRev(value: unknown): string {
  const plain: unknown = JSON.parse(JSON.stringify(value));
  return `r${createHash("sha256").update(JSON.stringify(sorted(plain)), "utf8").digest("base64url").slice(0, 22)}`;
}

/** The two windows of an allowance, with the ids their metrics and events are named by. */
export const WINDOWS = [
  { id: "five_hour", key: "fiveHour", short: t("5h", "5ч", "5г"), title: t("5-hour window", "Окно 5 ч", "Вікно 5 г"), name: t("5-hour window", "5-часовое окно", "5-годинне вікно") },
  { id: "week", key: "sevenDay", short: t("Week", "Нед", "Тиж"), title: t("Week", "Неделя", "Тиждень"), name: t("weekly window", "недельное окно", "тижневе вікно") },
] as const;

/** Where the notice levels sit: what the quota meters show as warning and critical, and what the
 *  events are sent at. `clearBy` is the hysteresis, here and in Pulse. */
export const WARN_AT = 80;
export const CRITICAL_AT = 95;
const CLEAR_BY = 3;
const THRESHOLDS = { above: [[WARN_AT, "warning"], [CRITICAL_AT, "critical"]], clearBy: CLEAR_BY } as const;

/** Readings go stale after this: a little over the longest wait the plugin keeps by default
 *  (ten minutes), twice, so one missed poll of the pill does not turn them grey. */
const STALE_AFTER_SEC = 1800;

const quota = (id: string, title: Text, extra: Record<string, unknown>) => ({
  id,
  type: "quota",
  unit: "percent",
  staleAfterSec: STALE_AFTER_SEC,
  thresholds: THRESHOLDS,
  title,
  ...extra,
});

/**
 * The readings, in the order Pulse ranks them. `fullest` is the hero: the fullest window of any
 * login, the one that decides whether there is room to work. The rest are one per login.
 */
export const PULSE_METRICS = [
  quota("fullest", t("Fullest window", "Самое полное окно", "Найповніше вікно"), { glance: true, short: t("Full", "Полн", "Повн") }),
  ...WINDOWS.map((window) => quota(window.id, window.title, { entity: "login", short: window.short })),
  ...WINDOWS.map((window) => ({
    id: `${window.id}_resets`,
    type: "time",
    style: "countdown",
    entity: "login",
    title: t(`${window.title.en} resets in`, `${window.title.ru} сбросится через`, `${window.title.uk} скинеться через`),
    short: t("Reset", "Сброс", "Скид"),
    surfaces: { only: ["card"] },
  })),
  {
    id: "in_use",
    type: "state",
    entity: "login",
    symbol: "star",
    title: t("New chats", "Новые чаты", "Нові чати"),
    short: t("New", "Новые", "Нові"),
    states: {
      default: { title: t("Open here", "Открываются здесь", "Відкриваються тут"), short: t("Here", "Здесь", "Тут"), symbol: "star.fill", severity: "info" },
      auto: { title: t("Auto picks it now", "Auto выбирает его", "Auto обирає його"), short: t("Auto", "Auto", "Auto"), severity: "info" },
      other: { title: t("Elsewhere", "В другом", "В іншому"), short: t("—", "—", "—") },
    },
  },
  { id: "plan", type: "text", entity: "login", title: t("Plan", "Тариф", "Тариф"), surfaces: { only: ["card"] } },
];

/**
 * What happened, for notifications: a window going over 80 % (warning) or 95 % (critical), and a
 * window that had gone over 80 % and has reset (info, so a person who stopped working hears
 * that the room is back). A window that resets from a low figure is not news.
 */
export const PULSE_EVENT_TYPES = WINDOWS.flatMap((window) => [
  {
    type: `${window.id}_warning`,
    title: `${window.title.en} over ${WARN_AT} %`,
    severity: "warning",
    entity: "login",
    group: "allowance",
    ttlSec: 3600,
    fields: { used: "number" },
    template: {
      title: t(`{entity}: ${window.name.en} at {used} %`, `{entity}: ${window.name.ru} на {used} %`, `{entity}: ${window.name.uk} на {used} %`),
    },
  },
  {
    type: `${window.id}_critical`,
    title: `${window.title.en} over ${CRITICAL_AT} %`,
    severity: "critical",
    entity: "login",
    group: "allowance",
    ttlSec: 3600,
    fields: { used: "number" },
    template: {
      title: t(`{entity}: ${window.name.en} at {used} %`, `{entity}: ${window.name.ru} на {used} %`, `{entity}: ${window.name.uk} на {used} %`),
      body: t("Not much room left on this login.", "На этом входе почти не осталось места.", "На цьому вході майже не лишилось місця."),
    },
  },
  {
    type: `${window.id}_reset`,
    title: `${window.title.en} reset`,
    severity: "info",
    entity: "login",
    group: "allowance",
    ttlSec: 3600,
    template: {
      title: t(`{entity}: ${window.name.en} has reset`, `{entity}: ${window.name.ru} сброшено`, `{entity}: ${window.name.uk} скинуто`),
      body: t("There is room again.", "Снова есть запас.", "Знову є запас."),
    },
  },
]);

export type PulseManifest = Record<string, unknown> & { schema: typeof PULSE_SCHEMA; manifestRev: string; metrics: ReadonlyArray<{ id: string }> };

/** The manifest, with or without the accounts shown in Pulse. `manifestRev` is the hash of the
 *  rest, so flipping the switch changes it by itself. The event types stay declared when hidden,
 *  so the manifest is never empty; nothing is sent under them. */
export function buildManifest(shown: boolean): PulseManifest {
  const body = {
    schema: PULSE_SCHEMA,
    title: t("Claude Accounts", "Аккаунты Claude", "Акаунти Claude"),
    symbol: "person.2.circle",
    snapshot: { method: pulseSnapshotRpc.name, cost: "local", minIntervalSec: 15, suggestedIntervalSec: 60, supportsIfRev: true },
    events: { method: pulseEventsRpc.name, minIntervalSec: 30 },
    entities: [{ kind: "login", title: t("Claude login", "Вход Claude", "Вхід Claude"), maxCount: 8 }],
    metrics: shown ? PULSE_METRICS : [],
    actions: [],
    eventTypes: PULSE_EVENT_TYPES,
  } as const;
  return { ...body, manifestRev: pulseRev(body) };
}

/** One login as Pulse reads it: everything it needs and nothing that names the person. */
export interface PulseLogin {
  /** Opaque and stable: the hash of the login key, which holds the email. */
  id: string;
  /** "Max 20x", or "" when the plan is not known. */
  plan: string;
  /** New chats open on this login. */
  isDefault: boolean;
  /** Under Auto: this is the login Auto would pick now. */
  autoNow: boolean;
  usage: AccountView["usage"];
  fiveHour: Bar | null;
  sevenDay: Bar | null;
  /** When the numbers were measured, ms since the epoch; null when it is not known. */
  measuredAt: number | null;
}

/** An id that says nothing of the login it stands for. */
export const loginId = (key: string): string => `l${createHash("sha256").update(key, "utf8").digest("hex").slice(0, 12)}`;

/** "Max 20x" from the subscription and the tier (`default_claude_max_20x`); "" when unknown. */
export function planLabel(plan: string, tier: string): string {
  if (plan === "") return "";
  const multiple = /_(\d+)x\b/.exec(tier)?.[1];
  return `${plan[0]!.toUpperCase()}${plan.slice(1)}${multiple === undefined ? "" : ` ${multiple}x`}`;
}

export interface LoginSources {
  /** The registry, for the directory of each account id. */
  registry: Registry;
  /** What the usage cache holds for a directory; null when nothing. Never measures. */
  cached(home: string): UsageResult | null;
  info(home: string): UsageInfo | null;
}

/**
 * The logins of the last overview, with each one's numbers taken from the usage cache where it
 * holds a real reading (the overview is only as new as the last time the Accounts screen was
 * open, the cache as new as the last poll of the pill). Claude logins that are logged in and
 * registered only: a directory not added yet is not an account, and Codex has no meter.
 */
export function pulseLoginsOf(rows: readonly AccountView[], sources: LoginSources): PulseLogin[] {
  const homeOf = (id: string) => accountById(sources.registry, id)?.home ?? null;
  return rows
    .filter((row) => row.registered && row.provider === "claude" && row.loggedIn)
    .map((row) => {
      let usage = row.usage;
      let fiveHour = row.fiveHour;
      let sevenDay = row.sevenDay;
      let measuredAt = row.usageAt;
      for (const home of usageOrder(row, homeOf, null)) {
        const reading = sources.cached(home);
        if (reading === null || (reading.state !== "ok" && reading.state !== "none")) continue;
        ({ state: usage, fiveHour, sevenDay } = reading);
        measuredAt = sources.info(home)?.measuredAt ?? row.usageAt;
        break;
      }
      return {
        id: loginId(row.key),
        plan: planLabel(row.subscriptionType, row.rateLimitTier),
        isDefault: row.isDefault,
        autoNow: row.autoNow,
        usage,
        fiveHour,
        sevenDay,
        measuredAt,
      };
    });
}

export type Reading = Record<string, unknown>;

const empty = (note?: string): Reading => (note === undefined ? { availability: "empty" } : { availability: "empty", note });

const instant = (ms: number) => new Date(ms).toISOString();

/** A window that can still be shown: measured, with the figure of the window it belongs to. A
 *  window whose reset has passed has no figure any more; one with no reset time is shown. */
function liveWindow(login: PulseLogin, window: (typeof WINDOWS)[number], now: number): { bar: Bar; resetsAt: number | null } | null {
  if (login.usage !== "ok") return null;
  const bar = login[window.key];
  if (bar === null) return null;
  const resetsAt = Date.parse(bar.resetsAt);
  if (!Number.isFinite(resetsAt)) return { bar, resetsAt: null };
  return resetsAt > now ? { bar, resetsAt } : null;
}

const percent = (bar: Bar) => Math.max(0, Math.min(100, Math.round(bar.utilization)));

function quotaReading(login: PulseLogin, window: (typeof WINDOWS)[number], now: number): Reading {
  const live = liveWindow(login, window, now);
  if (live === null) {
    if (login.usage === "unauthorised") return { availability: "needs_setup", note: "not authorised yet: open the Accounts screen" };
    if (login.usage === "expired") return { availability: "needs_setup", note: "the login has expired" };
    if (login.usage === "error") return { availability: "error", note: "the last reading failed" };
    if (login[window.key] !== null) return empty("the window has reset; waiting for a new reading");
    return empty(login.usage === "none" ? "no usage limit on this plan" : "this plan has no such window");
  }
  return {
    used: percent(live.bar),
    limit: 100,
    ...(live.resetsAt === null ? {} : { resetsAt: instant(live.resetsAt) }),
    ...(login.measuredAt === null ? {} : { measuredAt: instant(login.measuredAt) }),
  };
}

/** What each metric says. Nothing that ticks on its own goes in, so the snapshot's `rev` only
 *  moves when something worth showing does: figures are whole percents, and a window's own
 *  expiry is the one change that comes with the clock. */
export function pulseValues(logins: readonly PulseLogin[], now: number): Record<string, Reading | Record<string, Reading>> {
  const byLogin = (read: (login: PulseLogin) => Reading) => Object.fromEntries(logins.map((login) => [login.id, read(login)]));
  let fullest: { used: number; resetsAt: number | null; measuredAt: number | null } | null = null;
  for (const login of logins) {
    for (const window of WINDOWS) {
      const live = liveWindow(login, window, now);
      if (live !== null && (fullest === null || percent(live.bar) > fullest.used)) {
        fullest = { used: percent(live.bar), resetsAt: live.resetsAt, measuredAt: login.measuredAt };
      }
    }
  }
  const resets = (window: (typeof WINDOWS)[number]) =>
    byLogin((login) => {
      const live = liveWindow(login, window, now);
      return live?.resetsAt == null ? empty() : { at: instant(live.resetsAt) };
    });
  return {
    fullest:
      fullest === null
        ? empty("no readings yet")
        : {
            used: fullest.used,
            limit: 100,
            ...(fullest.resetsAt === null ? {} : { resetsAt: instant(fullest.resetsAt) }),
            ...(fullest.measuredAt === null ? {} : { measuredAt: instant(fullest.measuredAt) }),
          },
    five_hour: byLogin((login) => quotaReading(login, WINDOWS[0], now)),
    week: byLogin((login) => quotaReading(login, WINDOWS[1], now)),
    five_hour_resets: resets(WINDOWS[0]),
    week_resets: resets(WINDOWS[1]),
    in_use: byLogin((login) => ({ state: login.isDefault ? "default" : login.autoNow ? "auto" : "other" })),
    plan: byLogin((login) => (login.plan === "" ? empty() : { text: login.plan })),
  };
}

/** How far two resets of one window may sit apart and still be that window: the same
 *  tolerance the forecast uses (shared/forecast.ts, `SAME_RESET_MS`). */
const SAME_WINDOW_MS = 30 * 60_000;

interface Watched {
  /** The reset time first seen for this window: what its events are told apart by. */
  window: number;
  resetsAt: number;
  /** 0 below 80 %, 1 from 80 %, 2 from 95 %; falls only once clear of the step by CLEAR_BY. */
  level: 0 | 1 | 2;
}

function levelFor(used: number, was: 0 | 1 | 2): 0 | 1 | 2 {
  const up = used >= CRITICAL_AT ? 2 : used >= WARN_AT ? 1 : 0;
  if (up >= was) return up;
  // Falling: held until the figure is clear of the step it was at.
  if (was === 2 && used >= CRITICAL_AT - CLEAR_BY) return 2;
  if (used >= WARN_AT - CLEAR_BY) return 1;
  return 0;
}

export interface PulseDeps {
  ring: EventRing;
  /** The logins as they are now, from what the plugin holds. */
  logins(): Promise<PulseLogin[]>;
  now?: () => number;
  /** How long the manifest and the snapshot wait for the first read of the settings. */
  settleMs?: number;
}

export interface Pulse {
  manifest(): Promise<PulseManifest>;
  snapshot(input: { ifRev?: string }): Promise<{ schema: typeof PULSE_SCHEMA; rev: string; [key: string]: unknown }>;
  events(input: { after?: string | null; limit?: number }): Promise<{ schema: typeof PULSE_SCHEMA; [key: string]: unknown } & EventsPage>;
  /** The "Show in Pulse" switch, whenever the settings are read. */
  setShown(shown: boolean): void;
  /** No settings to wait for: the accounts stay shown. */
  settingsUnavailable(): void;
}

export function createPulse(deps: PulseDeps): Pulse {
  const now = deps.now ?? Date.now;
  let shown = true;
  const manifests = new Map<boolean, PulseManifest>();
  const manifestFor = (value: boolean) => {
    let manifest = manifests.get(value);
    if (!manifest) manifests.set(value, (manifest = buildManifest(value)));
    return manifest;
  };

  // Right after a restart the switch is not read yet: without the wait, hidden accounts would
  // show for a moment.
  let settle: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => (settle = resolve));
  setTimeout(() => settle(), deps.settleMs ?? 1000).unref?.();

  /** Each window as the last look saw it, to tell what changed. The first look of a window only
   *  records it: something over 80 % when this process started is not a crossing. */
  const watched = new Map<string, Watched>();

  /** Looks at every window and turns a change into events. */
  function observe(logins: readonly PulseLogin[]): void {
    const at = now();
    for (const login of logins) {
      for (const window of WINDOWS) {
        const live = liveWindow(login, window, at);
        if (live === null || live.resetsAt === null) continue;
        const used = percent(live.bar);
        const mapKey = `${login.id}:${window.id}`;
        const before = watched.get(mapKey);
        const when = instant(login.measuredAt ?? at);
        const about = { entity: login.id, at: when };
        if (before === undefined) {
          watched.set(mapKey, { window: live.resetsAt, resetsAt: live.resetsAt, level: levelFor(used, 0) });
          continue;
        }
        // A reset that is a new window: the old one ended, and said so if it had gone over 80 %.
        const renewed = live.resetsAt - before.resetsAt > SAME_WINDOW_MS;
        if (renewed && before.level > 0) deps.ring.push(`${window.id}_reset`, {}, { ...about, key: `${mapKey}:reset:${before.window}` });
        const from = renewed ? 0 : before.level;
        const level = levelFor(used, from);
        if (level > from) {
          deps.ring.push(`${window.id}_${level === 2 ? "critical" : "warning"}`, { used }, { ...about, key: `${mapKey}:${level}:${renewed ? live.resetsAt : before.window}` });
        }
        watched.set(mapKey, { window: renewed ? live.resetsAt : before.window, resetsAt: live.resetsAt, level });
      }
    }
  }

  /** The logins, or none when they cannot be read: an error here must not reach Pulse as a
   *  failed poll that hides the last good numbers, nor stop the events. */
  const read = async (): Promise<PulseLogin[] | null> => deps.logins().catch(() => null);

  return {
    async manifest() {
      await settled;
      return manifestFor(shown);
    },

    async snapshot({ ifRev }) {
      await settled;
      const manifest = manifestFor(shown);
      const at = now();
      const logins = shown ? await read() : [];
      if (shown && logins !== null) observe(logins);
      const values =
        !shown
          ? {}
          : logins === null
            ? { fullest: { availability: "error", note: "the logins could not be read" } }
            : pulseValues(logins, at);
      const entities =
        shown && logins !== null
          ? { login: logins.map((login, index) => ({ id: login.id, title: `Account ${index + 1}`, ...(login.plan === "" ? {} : { subtitle: login.plan }) })) }
          : undefined;
      const body = { schema: PULSE_SCHEMA as typeof PULSE_SCHEMA, manifestRev: manifest.manifestRev, events: { head: deps.ring.head() }, entities, values };
      const rev = pulseRev(body);
      const asOf = instant(at);
      if (ifRev === rev) return { schema: PULSE_SCHEMA as typeof PULSE_SCHEMA, unchanged: true, rev, manifestRev: manifest.manifestRev, asOf };
      return { ...body, rev, asOf };
    },

    async events(input) {
      await settled;
      if (shown) {
        const logins = await read();
        if (logins !== null) observe(logins);
      }
      // Hidden: nothing was recorded while it was, and what was before is not handed over.
      const page = shown ? deps.ring.read(input) : { events: [], cursor: input.after ?? "", head: deps.ring.head(), gap: false };
      return { schema: PULSE_SCHEMA as typeof PULSE_SCHEMA, ...page };
    },

    setShown(value) {
      // Back on, the windows are looked at afresh: what went over 80 % meanwhile is not news.
      if (value !== shown) watched.clear();
      shown = value;
      settle();
    },

    settingsUnavailable: () => settle(),
  };
}
