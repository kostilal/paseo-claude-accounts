import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AccountView } from "../shared/accounts.ts";
import type { Registry } from "../shared/registry.ts";
import { createEventRing } from "./pulse-events.ts";
import {
  PULSE_EVENT_TYPES,
  PULSE_METRICS,
  PULSE_SCHEMA,
  type PulseLogin,
  WINDOWS,
  buildManifest,
  createPulse,
  loginId,
  planLabel,
  pulseEventsRpc,
  pulseLoginsOf,
  pulseManifestRpc,
  pulseRev,
  pulseSnapshotRpc,
  pulseValues,
} from "./pulse.ts";
import type { UsageResult } from "./usage.ts";

/**
 * What Paseo Pulse sees of this plugin is the manifest, the snapshot and the events feed, so
 * these tests hold them to the contract (paseo.pulse/1) and to the plugin itself: the readings
 * come from what the plugin already holds, no email reaches them, and the revisions move only
 * when something worth showing does. Where the Pulse repository sits next to this one, its own
 * parsers are used too.
 */

const PULSE_CONTRACT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "paseo-pulse-plugin", "contract");
const pulseMissing = existsSync(join(PULSE_CONTRACT, "src", "manifest.ts")) ? false : "the Pulse repository is not next to this one";

type ParseManifest = (raw: unknown, pluginId: string) =>
  | { manifest: { metrics: unknown[]; actions: unknown[]; eventTypes: unknown[] }; dropped: unknown[] }
  | { fatal: string };
type ParseSnapshot = (raw: unknown, manifest: unknown) => { unchanged: boolean; snapshot?: { entities: Record<string, unknown[]> }; notes?: string[]; failed?: string };

const load = async (file: string) => (await import(pathToFileURL(join(PULSE_CONTRACT, "src", file)).href)) as Record<string, unknown>;

/** The declarations as plain data, for checks that do not care how they were built. */
interface MetricDecl {
  id: string;
  type: string;
  glance?: boolean;
  title: unknown;
  short?: unknown;
  thresholds?: { above: unknown[][] };
  states?: Record<string, { title: unknown; short?: unknown }>;
}
interface EventDecl {
  type: string;
  severity: string;
  fields?: Record<string, string>;
  template: { title: unknown; body?: unknown };
}
const METRICS = PULSE_METRICS as unknown as MetricDecl[];
const EVENT_TYPES = PULSE_EVENT_TYPES as unknown as EventDecl[];

const T0 = Date.parse("2026-11-08T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 3_600_000;

const EMAIL = "roman.secret@example.com";

function login(key: string, over: Partial<PulseLogin> = {}): PulseLogin {
  return {
    id: loginId(key),
    plan: "Max 20x",
    isDefault: false,
    autoNow: false,
    usage: "ok",
    fiveHour: { utilization: 42.4, resetsAt: iso(T0 + 2 * HOUR) },
    sevenDay: { utilization: 61, resetsAt: iso(T0 + 72 * HOUR) },
    measuredAt: T0 - 60_000,
    ...over,
  };
}

function rig(initial: PulseLogin[] = [login("a"), login("b", { isDefault: true })], options: { settleMs?: number } = {}) {
  let clock = T0;
  let current = initial;
  let broken = false;
  const ring = createEventRing({ now: () => clock });
  const pulse = createPulse({
    ring,
    logins: async () => {
      if (broken) throw new Error("unreadable");
      return current;
    },
    now: () => clock,
    settleMs: options.settleMs ?? 0,
  });
  return {
    pulse,
    ring,
    set: (next: PulseLogin[]) => void (current = next),
    advance: (ms: number) => void (clock += ms),
    breakReads: () => void (broken = true),
  };
}

/** A login whose 5-hour window is at `used` percent, resetting at `resetsAt`. */
const at = (key: string, used: number, resetsAt = T0 + 2 * HOUR, over: Partial<PulseLogin> = {}) =>
  login(key, { fiveHour: { utilization: used, resetsAt: iso(resetsAt) }, ...over });

const row = (key: string, over: Partial<AccountView> = {}): AccountView => ({
  id: key,
  name: key,
  home: "",
  provider: "claude",
  registered: true,
  key: JSON.stringify(["login", EMAIL, "Org"]),
  loggedIn: true,
  email: EMAIL,
  orgName: "Org",
  subscriptionType: "max",
  accountIds: [key],
  switchTo: key,
  isDefault: false,
  autoNow: false,
  usage: "ok",
  fiveHour: { utilization: 10, resetsAt: iso(T0 + HOUR) },
  sevenDay: null,
  usageErrorCode: "",
  usageError: "",
  usageAt: T0 - 120_000,
  heldUntil: null,
  rateLimitTier: "default_claude_max_20x",
  ...over,
});

test("the manifest is plain JSON that the daemon's shell lets through whole", () => {
  for (const shown of [true, false]) {
    const manifest = buildManifest(shown);
    assert.equal(manifest.schema, PULSE_SCHEMA);
    assert.deepEqual(JSON.parse(JSON.stringify(manifest)), manifest);
    assert.deepEqual(pulseManifestRpc.output.parse(manifest), manifest);
    assert.ok(new TextEncoder().encode(JSON.stringify(manifest)).length < 64 * 1024, "under 64 KiB");
  }
  assert.equal(pulseManifestRpc.name, "meta.pulse");
  assert.ok(!pulseSnapshotRpc.name.startsWith("meta.") && !pulseEventsRpc.name.startsWith("meta."));
});

test("manifestRev is the hash of the rest: the same on every build, another one with the accounts hidden", () => {
  const { manifestRev, ...body } = buildManifest(true);
  assert.equal(manifestRev, pulseRev(body));
  assert.match(manifestRev, /^r[A-Za-z0-9_-]{22}$/);
  assert.equal(buildManifest(true).manifestRev, manifestRev);
  assert.notEqual(buildManifest(false).manifestRev, manifestRev);
  // Key order and undefined keys do not matter, as for Pulse.
  assert.equal(pulseRev({ b: 1, a: [{ d: 2, c: undefined }] }), pulseRev({ a: [{ d: 2 }], b: 1 }));
});

test("this version offers no actions, and hidden it offers no readings", () => {
  assert.deepEqual(buildManifest(true).actions, []);
  assert.deepEqual(buildManifest(false).actions, []);
  assert.deepEqual(buildManifest(false).metrics, []);
  assert.equal((buildManifest(false).eventTypes as unknown[]).length, PULSE_EVENT_TYPES.length, "never an empty manifest");
});

test("Pulse's own parser keeps every metric and event type, shown or hidden", { skip: pulseMissing }, async () => {
  const parse = (await load("manifest.ts")).parseManifest as ParseManifest;
  for (const shown of [true, false]) {
    const parsed = parse(JSON.parse(JSON.stringify(buildManifest(shown))), "claude-accounts");
    assert.ok("manifest" in parsed, `not fatal: ${"fatal" in parsed ? parsed.fatal : ""}`);
    assert.deepEqual(parsed.dropped, [], `shown=${shown}`);
    assert.equal(parsed.manifest.metrics.length, shown ? PULSE_METRICS.length : 0);
    assert.equal(parsed.manifest.actions.length, 0);
    assert.equal(parsed.manifest.eventTypes.length, PULSE_EVENT_TYPES.length);
  }
});

test("ids, short labels and counts fit the contract's limits", () => {
  const local = /^[a-z][a-z0-9_]*$/;
  const texts = (text: unknown) => (typeof text === "string" ? [text] : Object.values(text as Record<string, string>));
  assert.ok(PULSE_METRICS.length <= 64 && PULSE_EVENT_TYPES.length <= 32);
  for (const metric of METRICS) {
    assert.match(metric.id, local);
    for (const title of texts(metric.title)) assert.ok([...title].length <= 40, `${metric.id}: ${title}`);
    if (metric.short !== undefined) for (const short of texts(metric.short)) assert.ok([...short].length <= 6, `${metric.id}: ${short}`);
    if (metric.states !== undefined) {
      for (const [id, state] of Object.entries(metric.states)) {
        assert.match(id, local);
        for (const title of texts(state.title)) assert.ok([...title].length <= 24, `${metric.id}.${id}: ${title}`);
        if (state.short !== undefined) for (const short of texts(state.short)) assert.ok([...short].length <= 6, `${metric.id}.${id}: ${short}`);
      }
    }
  }
  assert.equal(new Set(PULSE_METRICS.map((metric) => metric.id)).size, PULSE_METRICS.length);
  assert.deepEqual(
    PULSE_METRICS.filter((metric) => "glance" in metric && metric.glance).map((metric) => metric.id),
    ["fullest"],
    "the hero is the fullest window",
  );
  for (const type of PULSE_EVENT_TYPES) assert.match(type.type, local);
  assert.deepEqual(
    PULSE_EVENT_TYPES.map((type) => type.type),
    WINDOWS.flatMap((window) => [`${window.id}_warning`, `${window.id}_critical`, `${window.id}_reset`]),
  );
});

test("the loud levels are the ones the meters turn warning and critical at", () => {
  const meter = METRICS.find((metric) => metric.id === "five_hour");
  assert.deepEqual(meter?.thresholds?.above, [[80, "warning"], [95, "critical"]]);
  const severities = Object.fromEntries(EVENT_TYPES.map((type) => [type.type, type.severity]));
  assert.deepEqual(severities, {
    five_hour_warning: "warning",
    five_hour_critical: "critical",
    five_hour_reset: "info",
    week_warning: "warning",
    week_critical: "critical",
    week_reset: "info",
  });
});

test("a login is an opaque id; the plan reads as Max 20x, and no email or path gets through", () => {
  const key = JSON.stringify(["login", EMAIL, "Org"]);
  assert.match(loginId(key), /^l[0-9a-f]{12}$/);
  assert.ok(!loginId(key).includes("roman"));
  assert.equal(loginId(key), loginId(key));
  assert.notEqual(loginId(key), loginId(JSON.stringify(["login", "other@example.com", "Org"])));
  assert.equal(planLabel("max", "default_claude_max_20x"), "Max 20x");
  assert.equal(planLabel("pro", ""), "Pro");
  assert.equal(planLabel("", "default_claude_max_5x"), "");

  const registry: Registry = {
    version: 2,
    agents: {},
    accounts: [
      { id: "main", label: EMAIL, provider: "claude", home: `/Users/${EMAIL}/.claude` },
      { id: "second", label: "second", provider: "claude", home: "/h/second" },
    ],
  };
  const rows = [
    row("main", { home: `/Users/${EMAIL}/.claude`, isDefault: true }),
    row("codex", { provider: "codex" }),
    row("suggestion", { registered: false }),
    row("out", { loggedIn: false }),
  ];
  const logins = pulseLoginsOf(rows, { registry, cached: () => null, info: () => null });
  assert.deepEqual(logins.map((entry) => entry.id), [loginId(rows[0]!.key)], "one registered Claude login, signed in");
  assert.ok(!JSON.stringify(logins).includes("@") && !JSON.stringify(logins).includes("/Users"));
  assert.deepEqual([logins[0]?.plan, logins[0]?.isDefault], ["Max 20x", true]);
});

test("the usage cache is laid over the overview, and a directory with no real reading changes nothing", () => {
  const registry: Registry = {
    version: 2,
    agents: {},
    accounts: [
      { id: "a", label: "a", provider: "claude", home: "/h/a" },
      { id: "b", label: "b", provider: "claude", home: "/h/b" },
    ],
  };
  const fresh: UsageResult = { state: "ok", fiveHour: { utilization: 77, resetsAt: iso(T0 + HOUR) }, sevenDay: { utilization: 50, resetsAt: iso(T0 + 48 * HOUR) }, error: "" };
  const expired: UsageResult = { state: "expired", fiveHour: null, sevenDay: null, error: "" };
  const rows = [row("a", { accountIds: ["a", "b"] })];
  const measuredAt = T0 - 30_000;
  const overlaid = pulseLoginsOf(rows, {
    registry,
    cached: (home) => (home === "/h/a" ? expired : fresh),
    info: (home) => (home === "/h/b" ? { measuredAt, heldUntil: null } : null),
  })[0];
  assert.deepEqual([overlaid?.fiveHour?.utilization, overlaid?.sevenDay?.utilization, overlaid?.measuredAt], [77, 50, measuredAt]);
  // Nothing real in the cache: the overview's own numbers stand.
  const kept = pulseLoginsOf(rows, { registry, cached: () => expired, info: () => null })[0];
  assert.deepEqual([kept?.fiveHour?.utilization, kept?.measuredAt], [10, T0 - 120_000]);
});

test("the readings: whole percents, resets, who new chats open on, and nothing personal", () => {
  const logins = [login("a", { autoNow: true }), login("b", { isDefault: true, fiveHour: null, plan: "" }), login("c")];
  const values = pulseValues(logins, T0);
  assert.deepEqual(Object.keys(values), PULSE_METRICS.map((metric) => metric.id));
  const [a, b, c] = logins.map((entry) => entry.id) as [string, string, string];
  assert.deepEqual(values.five_hour, {
    [a]: { used: 42, limit: 100, resetsAt: iso(T0 + 2 * HOUR), measuredAt: iso(T0 - 60_000) },
    [b]: { availability: "empty", note: "this plan has no such window" },
    [c]: { used: 42, limit: 100, resetsAt: iso(T0 + 2 * HOUR), measuredAt: iso(T0 - 60_000) },
  });
  assert.deepEqual((values.week as Record<string, unknown>)[a], { used: 61, limit: 100, resetsAt: iso(T0 + 72 * HOUR), measuredAt: iso(T0 - 60_000) });
  assert.deepEqual(values.five_hour_resets, { [a]: { at: iso(T0 + 2 * HOUR) }, [b]: { availability: "empty" }, [c]: { at: iso(T0 + 2 * HOUR) } });
  assert.deepEqual(values.in_use, { [a]: { state: "auto" }, [b]: { state: "default" }, [c]: { state: "other" } });
  assert.deepEqual(values.plan, { [a]: { text: "Max 20x" }, [b]: { availability: "empty" }, [c]: { text: "Max 20x" } });
  for (const metric of METRICS) {
    if (metric.states === undefined) continue;
    for (const reading of Object.values(values[metric.id] as Record<string, { state: string }>)) assert.ok(reading.state in metric.states);
  }
});

test("the hero is the fullest live window of any login", () => {
  const values = pulseValues([login("a", { fiveHour: { utilization: 30, resetsAt: iso(T0 + HOUR) }, sevenDay: { utilization: 91.6, resetsAt: iso(T0 + 50 * HOUR) } }), at("b", 88)], T0);
  assert.deepEqual(values.fullest, { used: 92, limit: 100, resetsAt: iso(T0 + 50 * HOUR), measuredAt: iso(T0 - 60_000) });
  assert.deepEqual(pulseValues([], T0).fullest, { availability: "empty", note: "no readings yet" });
  // A window that has reset has no figure: it cannot be the fullest.
  const reset = pulseValues([at("a", 99, T0 - 1_000, { sevenDay: null })], T0);
  assert.equal((reset.fullest as { availability: string }).availability, "empty");
  assert.deepEqual(Object.values(reset.five_hour as object)[0], { availability: "empty", note: "the window has reset; waiting for a new reading" });
});

test("a login with no numbers says why, and a week-only plan has no 5-hour window", () => {
  const none = { fiveHour: null, sevenDay: null };
  const values = pulseValues(
    [login("unauth", { usage: "unauthorised", ...none }), login("expired", { usage: "expired", ...none }), login("failed", { usage: "error", ...none }), login("nolimit", { usage: "none", ...none }), login("week", { fiveHour: null })],
    T0,
  );
  const byKey = (metric: string, key: string) => (values[metric] as Record<string, { availability?: string; note?: string; used?: number }>)[loginId(key)];
  assert.equal(byKey("five_hour", "unauth")?.availability, "needs_setup");
  assert.equal(byKey("week", "expired")?.availability, "needs_setup");
  assert.equal(byKey("week", "failed")?.availability, "error");
  assert.equal(byKey("week", "nolimit")?.note, "no usage limit on this plan");
  assert.equal(byKey("five_hour", "week")?.availability, "empty");
  assert.equal(byKey("week", "week")?.used, 61);
});

test("the snapshot: entities are Account N with the plan, values are keyed by login, and the real parser takes it", async () => {
  const r = rig();
  r.pulse.setShown(true);
  const manifest = await r.pulse.manifest();
  const snapshot = await r.pulse.snapshot({});
  assert.deepEqual(pulseSnapshotRpc.output.parse(snapshot), snapshot, "the daemon's shell lets it through whole");
  assert.equal(snapshot.asOf, iso(T0));
  assert.deepEqual(snapshot.events, { head: "" });
  assert.deepEqual(snapshot.entities, {
    login: [
      { id: loginId("a"), title: "Account 1", subtitle: "Max 20x" },
      { id: loginId("b"), title: "Account 2", subtitle: "Max 20x" },
    ],
  });
  assert.ok(!JSON.stringify(snapshot).includes("@"));
  if (pulseMissing) return;
  const parse = (await load("snapshot.ts")).parseSnapshot as ParseSnapshot;
  const parsed = parse(JSON.parse(JSON.stringify(snapshot)), (await (async () => {
    const parseManifest = (await load("manifest.ts")).parseManifest as ParseManifest;
    const result = parseManifest(JSON.parse(JSON.stringify(manifest)), "claude-accounts");
    assert.ok("manifest" in result);
    return result.manifest;
  })()));
  assert.equal(parsed.failed, undefined);
  assert.deepEqual(parsed.notes, []);
  assert.equal(parsed.snapshot?.entities.login?.length, 2);
});

test("rev moves with what is shown, not with the clock; ifRev answers unchanged", async () => {
  const r = rig();
  r.pulse.setShown(true);
  const first = await r.pulse.snapshot({});
  const { rev } = first;
  r.advance(30_000);
  const later = await r.pulse.snapshot({});
  assert.equal(later.rev, rev);
  assert.notEqual(later.asOf, first.asOf);
  assert.deepEqual(await r.pulse.snapshot({ ifRev: rev }), { schema: PULSE_SCHEMA, unchanged: true, rev, manifestRev: first.manifestRev, asOf: iso(T0 + 30_000) });

  // A figure that moves a fraction within the same whole percent shows nothing new.
  r.set([login("a", { fiveHour: { utilization: 42.1, resetsAt: iso(T0 + 2 * HOUR) } }), login("b", { isDefault: true })]);
  assert.equal((await r.pulse.snapshot({})).rev, rev);
  // A new figure does, and so does a new default.
  r.set([at("a", 50), login("b", { isDefault: true })]);
  const moved = await r.pulse.snapshot({ ifRev: rev });
  assert.notEqual(moved.rev, rev);
  assert.equal(moved.unchanged, undefined);
  r.set([at("a", 50), login("b")]);
  assert.notEqual((await r.pulse.snapshot({})).rev, moved.rev);

  // Hidden: no readings, no entities, another manifest.
  r.pulse.setShown(false);
  const hidden = await r.pulse.snapshot({});
  assert.deepEqual(hidden.values, {});
  assert.equal(hidden.entities, undefined);
  assert.equal(hidden.manifestRev, buildManifest(false).manifestRev);
});

test("logins that cannot be read are an error reading, not a throw", async () => {
  const r = rig();
  r.breakReads();
  const snapshot = await r.pulse.snapshot({});
  assert.deepEqual(snapshot.values, { fullest: { availability: "error", note: "the logins could not be read" } });
  assert.deepEqual((await r.pulse.events({})).events, []);
});

test("the manifest waits for the first read of the settings, so hidden accounts never show", async () => {
  const r = rig(undefined, { settleMs: 60_000 });
  let answered = false;
  const pending = r.pulse.manifest().then((manifest) => ((answered = true), manifest));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answered, false);
  r.pulse.setShown(false);
  assert.equal((await pending).manifestRev, buildManifest(false).manifestRev);
  const unread = rig(undefined, { settleMs: 60_000 });
  unread.pulse.settingsUnavailable();
  assert.equal((await unread.pulse.manifest()).manifestRev, buildManifest(true).manifestRev, "no settings: shown");
  const late = rig(undefined, { settleMs: 5 });
  assert.equal((await late.pulse.manifest()).manifestRev, buildManifest(true).manifestRev, "no read in time: shown");
});

const kinds = async (r: ReturnType<typeof rig>) => (await r.pulse.events({})).events.map((event) => [event.type, event.fields, event.entity]);

test("a window going over 80 and then 95 is a warning and then a critical, once each, however often it is seen", async () => {
  const r = rig([at("a", 50)]);
  await r.pulse.snapshot({});
  assert.deepEqual(await kinds(r), [], "the first look only records");
  for (const used of [79, 80, 82, 82, 90]) {
    r.set([at("a", used)]);
    await r.pulse.snapshot({});
  }
  r.set([at("a", 96)]);
  await r.pulse.snapshot({});
  r.set([at("a", 97)]);
  await r.pulse.snapshot({});
  assert.deepEqual(await kinds(r), [
    ["five_hour_warning", { used: 80 }, loginId("a")],
    ["five_hour_critical", { used: 96 }, loginId("a")],
  ]);
  const page = await r.pulse.events({});
  assert.deepEqual(pulseEventsRpc.output.parse(page), page, "the daemon's shell lets it through whole");
  assert.equal(page.events[0]?.at, iso(T0 - 60_000), "when it was measured");
});

test("a jump straight over 95 is one critical, and the week is told apart from the 5 hours", async () => {
  const r = rig([login("a")]);
  await r.pulse.snapshot({});
  r.set([at("a", 97, T0 + 2 * HOUR, { sevenDay: { utilization: 85, resetsAt: iso(T0 + 72 * HOUR) } })]);
  await r.pulse.snapshot({});
  assert.deepEqual(await kinds(r), [
    ["five_hour_critical", { used: 97 }, loginId("a")],
    ["week_warning", { used: 85 }, loginId("a")],
  ]);
});

test("a figure wobbling around 80 does not repeat the warning", async () => {
  const r = rig([at("a", 70)]);
  await r.pulse.snapshot({});
  for (const used of [81, 78, 81, 79, 82, 76, 83]) {
    r.set([at("a", used)]);
    await r.pulse.snapshot({});
  }
  // Even after clearing 77 and coming back: one window, one warning.
  assert.equal((await kinds(r)).filter(([type]) => type === "five_hour_warning").length, 1);
});

test("something already over 80 when this process starts is not news", async () => {
  const r = rig([at("a", 90)]);
  await r.pulse.snapshot({});
  r.set([at("a", 91)]);
  await r.pulse.snapshot({});
  assert.deepEqual(await kinds(r), []);
});

test("a window that had gone over 80 and resets is told; one that resets from a low figure is not", async () => {
  const r = rig([at("hot", 85), at("cool", 20)]);
  await r.pulse.snapshot({});
  // Same reset time seen a little differently is the same window; a new window is 5 hours on.
  r.set([at("hot", 86, T0 + 2 * HOUR + 60_000), at("cool", 21)]);
  await r.pulse.snapshot({});
  assert.deepEqual(await kinds(r), []);
  r.advance(3 * HOUR);
  r.set([at("hot", 3, T0 + 8 * HOUR), at("cool", 4, T0 + 8 * HOUR)]);
  await r.pulse.snapshot({});
  assert.deepEqual(await kinds(r), [["five_hour_reset", {}, loginId("hot")]]);
  // Over 80 again in the new window: a new warning, not a repeat of the old one.
  r.set([at("hot", 83, T0 + 8 * HOUR), at("cool", 4, T0 + 8 * HOUR)]);
  await r.pulse.snapshot({});
  assert.deepEqual((await kinds(r)).map(([type]) => type), ["five_hour_reset", "five_hour_warning"]);
});

test("a window that has reset and is not measured yet is no crossing and no reset until a new reading comes", async () => {
  const r = rig([at("a", 90)]);
  await r.pulse.snapshot({});
  r.advance(3 * HOUR);
  await r.pulse.snapshot({});
  assert.deepEqual(await kinds(r), []);
  r.set([at("a", 2, T0 + 8 * HOUR)]);
  await r.pulse.snapshot({});
  assert.deepEqual((await kinds(r)).map(([type]) => type), ["five_hour_reset"]);
});

test("every event is one of the declared types, with exactly its declared fields and an entity", async () => {
  const r = rig([at("a", 50, T0 + 2 * HOUR, { sevenDay: { utilization: 50, resetsAt: iso(T0 + 72 * HOUR) } })]);
  await r.pulse.snapshot({});
  r.set([at("a", 97, T0 + 2 * HOUR, { sevenDay: { utilization: 85, resetsAt: iso(T0 + 72 * HOUR) } })]);
  await r.pulse.snapshot({});
  r.advance(80 * HOUR);
  r.set([at("a", 1, T0 + 90 * HOUR, { sevenDay: { utilization: 2, resetsAt: iso(T0 + 240 * HOUR) } })]);
  await r.pulse.snapshot({});
  const page = await r.pulse.events({});
  assert.deepEqual(page.events.map((event) => event.type), ["five_hour_critical", "week_warning", "five_hour_reset", "week_reset"]);
  for (const event of page.events) {
    const declared = EVENT_TYPES.find((type) => type.type === event.type);
    assert.ok(declared, event.type);
    const fields = Object.keys(declared.fields ?? {});
    assert.deepEqual(Object.keys(event.fields ?? {}).sort(), fields.sort(), `${event.type} sends its declared fields`);
    assert.equal(event.entity, loginId("a"));
    // A template may use only what the event carries.
    for (const template of [declared.template.title, declared.template.body ?? {}]) {
      for (const text of Object.values(template as Record<string, string>)) for (const [, name] of text.matchAll(/\{(\w+)\}/g)) assert.ok(["entity", "source", "at", ...fields].includes(name!), `${event.type}: {${name}}`);
    }
  }
  assert.ok(!JSON.stringify(page).includes("@"));
});

test("with the accounts hidden nothing is sent, and showing them again does not report what passed meanwhile", async () => {
  const r = rig([at("a", 50)]);
  await r.pulse.snapshot({});
  r.pulse.setShown(false);
  r.set([at("a", 90)]);
  assert.deepEqual(await r.pulse.events({ after: "x" }), { schema: PULSE_SCHEMA, events: [], cursor: "x", head: "", gap: false });
  r.pulse.setShown(true);
  await r.pulse.snapshot({});
  r.set([at("a", 91)]);
  await r.pulse.snapshot({});
  assert.deepEqual(await kinds(r), []);
});
