import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { AccountView } from "./accounts.ts";

/**
 * How long the selected accounts' allowance will last, and what to do about it.
 *
 * The provider reports each window as a percentage and a reset time: no tokens or any other
 * absolute unit anywhere. So nothing here is ever called tokens, and percentages of accounts that
 * may differ in size are not added up as they stand. The shared unit is the "capacity" of a week:
 * an account's weekly percentages are weighed by what its plan is worth relative to the others,
 * and the pool's reserve is the share of the selected accounts' combined capacity still unused.
 *
 * Work is modelled as a steady burn at the recent rate, served by whichever account has room and
 * resets its week soonest, the order that loses the least at resets. Each reset happens at its
 * exact time, so accounts that reset days apart are told apart, and an account blocked by either
 * window is out of the running until that window resets.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FIVE_HOURS = 5 * HOUR;
const WEEK = 7 * DAY;

/** Utilization at or above which a window counts as spent, the same as the pill's. */
const EXHAUSTED_AT = 99.5;

/** Readings of one window can name slightly different reset times; a real reset moves it by hours. */
const SAME_RESET_MS = 30 * 60_000;

/** The recent rate is taken over one full day, so that a night's rest counts against a day's work. */
const LOOKBACK = DAY;

/** A full day of readings, short of the gap to the newest one: it is the last reading, not now. */
const FULL_DAY_HOURS = 23;

/** Below this much of a reading history the recent rate is noise and is not used at all. */
const MIN_RECENT_HOURS = 1;

/** Enough 5-hour and weekly movement to tell what one costs in the other, given readings that
 *  arrive rounded: a point of error on either side stays small against these. */
const MIN_FIVE_POINTS = 30;
const MIN_WEEK_POINTS = 2;

/**
 * The share of a week one percent of a 5-hour window costs, while nothing has been measured.
 * Anthropic publishes no such figure and says the two limits are independent, so this is a plain
 * assumption, shown as one, and only ever used until an account's own history gives its figure.
 */
const ASSUMED_SHARE = 0.15;

/** The least of an account's week that is worth a hint: below it, forecast noise. */
const MIN_LOST_PERCENT = 2;
const MIN_EXTRA_PERCENT = 1;

/** Closer to a reset than this there is no time left to act on a hint. */
const MIN_TIME_TO_ACT_MS = 30 * 60_000;

/** An idle spell shorter than this is within the model's own error. */
const MIN_IDLE_MS = 15 * 60_000;

/** A reading older than this no longer describes the moment the forecast starts from. */
const OLD_READING_MS = 2 * HOUR;

/** One window as it stood at a reading: percent used and the reset, ms since the epoch. A window
 *  with no reset time has not started, or the endpoint did not say. */
export interface SampleWindow {
  used: number;
  resetsAt: number | null;
}

/** One reading of an account's two windows; a window it does not have is null. */
export interface Sample {
  t: number;
  five: SampleWindow | null;
  week: SampleWindow | null;
}

const windowState = z.object({ used: z.number(), resetsAt: z.number().nullable() });

const accountForecast = z.object({
  key: z.string(),
  title: z.string(),
  /** Weight of this account's week among the selected, in multiples of a Pro plan. Meaningless
   *  as a size in itself; only the ratios between accounts are used. */
  capacity: z.number(),
  capacitySource: z.enum(["same-plan", "plan", "manual"]),
  week: windowState,
  five: windowState.nullable(),
  /** Percent of the week one full 5-hour window costs; null with no 5-hour window. */
  fiveHourCost: z.number().nullable(),
  fiveHourCostMeasured: z.boolean(),
  /** Burn on this account at the recent rate: percent of its own week per hour. */
  pacePerHour: z.number(),
  paceSource: z.enum(["history", "blend", "window-average", "none"]),
  historyHours: z.number(),
  samples: z.number(),
  readingAgeMs: z.number().nullable(),
  /** When its week runs out at the forecast pace, before the reset; null if it does not. */
  weekEmptyAt: z.number().nullable(),
  /** Percent of its own week forecast to be left unused at the reset. */
  leftAtReset: z.number(),
  /** Percent of its own week that can really be spent by the reset, given the 5-hour windows. */
  spendableBeforeReset: z.number(),
  /** Whether the short window, not the time left, is what limits that. */
  shortWindowLimits: z.boolean(),
  /** One flag per chart column: can this account take work then? */
  up: z.array(z.boolean()),
});

const chartColumn = z.object({
  at: z.number(),
  /** The pool's weekly reserve at the forecast pace, percent of combined capacity. */
  reserve: z.number(),
  /** At a faster and a slower pace than forecast. */
  low: z.number(),
  high: z.number(),
  /** Of the reserve, what the 5-hour windows allow right then. */
  available: z.number(),
  idle: z.boolean(),
});

const idleWindow = z.object({
  from: z.number(),
  to: z.number(),
  /** `weekly`: every account's week is spent. `short`: 5-hour windows are what stands in the way. */
  cause: z.enum(["weekly", "short"]),
});

const hint = z.discriminatedUnion("kind", [
  z.object({
    /** Nothing can be done: there is no room in any selected account right now. */
    kind: z.literal("idle-now"),
    until: z.number(),
  }),
  z.object({
    kind: z.literal("slow-down"),
    idleFrom: z.number(),
    idleTo: z.number(),
    /** Slow down from this moment until the reset that ends the idle spell. */
    startAt: z.number(),
    untilAt: z.number(),
    cutPercent: z.number(),
    /** The pool's pace now and the pace that avoids the idle spell, percent of capacity per hour. */
    pacePerHour: z.number(),
    targetPerHour: z.number(),
    /** The same if the slowdown is put off to this moment. */
    laterStartAt: z.number().nullable(),
    laterCutPercent: z.number().nullable(),
  }),
  z.object({
    kind: z.literal("speed-up"),
    key: z.string(),
    title: z.string(),
    /** The account work goes to right now, when that is another: this one's turn comes after it. */
    servedNow: z.string().nullable(),
    /** That account's login key, so the client can name it as it names every account. */
    servedNowKey: z.string().nullable().default(null),
    /** From when this account can take more work, until its week resets. */
    startAt: z.number(),
    untilAt: z.number(),
    /** Percent of its own week forecast to be lost at the reset. */
    lostPercent: z.number(),
    /** How much of that can really be spent in time. */
    extraPercent: z.number(),
    /** How much faster the pool may burn to spend it; null when there is no pace to compare with. */
    boostPercent: z.number().nullable(),
    shortWindowLimited: z.boolean(),
  }),
]);

const assumption = z.enum([
  "percent-only",
  "steady-pace",
  "earliest-reset-first",
  "short-window-restarts",
  "model-limits-ignored",
  "spend-ceiling",
  "same-plan-capacity",
  "plan-multiple-capacity",
  "manual-capacity",
  "short-window-assumed",
  "thin-history",
  "no-history",
  "old-readings",
]);

const exclusion = z.enum(["no-meter", "no-reading", "no-week", "no-reset", "no-capacity"]);

const reset = z.object({
  at: z.number(),
  key: z.string(),
  kind: z.enum(["week", "five"]),
});

export const forecast = z.object({
  at: z.number(),
  until: z.number(),
  accounts: z.array(accountForecast),
  excluded: z.array(z.object({ key: z.string(), title: z.string(), reason: exclusion })),
  columns: z.array(chartColumn),
  resets: z.array(reset),
  idle: z.array(idleWindow),
  pool: z.object({
    reserve: z.number(),
    available: z.number(),
    pacePerHour: z.number(),
    reserveAtEnd: z.number(),
  }),
  hints: z.array(hint),
  accuracy: z.object({
    level: z.enum(["high", "medium", "low", "insufficient"]),
    /** ± this much around the forecast pace: the shaded band on the chart. */
    errorPercent: z.number(),
    /** `backtest`: how far yesterday's pace was from the next day's, over the past days.
     *  `history-length`: a rule of thumb from how much history there is. */
    basis: z.enum(["backtest", "history-length"]),
    historyHoursMin: z.number(),
    historyHoursMax: z.number(),
    samples: z.number(),
    oldestReadingMs: z.number().nullable(),
  }),
  assumptions: z.array(assumption),
});

export type Forecast = z.output<typeof forecast>;
export type AccountForecast = z.output<typeof accountForecast>;
export type ForecastHint = z.output<typeof hint>;
export type ForecastAssumption = z.output<typeof assumption>;
export type ForecastExclusion = z.output<typeof exclusion>;

export const forecastRpc = defineRpc({
  name: "accounts.forecast",
  input: z.object({
    /** Row keys of the accounts left out; every other account counts as ticked. */
    unchecked: z.array(z.string()).default([]),
    /** Row key to a capacity set by hand, in multiples of a Pro plan. */
    capacity: z.record(z.string(), z.number().positive()).default({}),
    columns: z.number().int().min(12).max(120).default(48),
  }),
  output: forecast,
});

/** A plan's size relative to Pro, or null when the plan does not say. Anthropic publishes these
 *  multiples for the 5-hour window only; using them for the week is an assumption, stated as
 *  one wherever it is used. */
export function planMultiple(tier: string, plan: string): number | null {
  const named = /_(\d+)x\b/.exec(tier);
  if (named !== null) return Number(named[1]);
  return plan === "pro" ? 1 : null;
}

/** Whether two readings of a window belong to one and the same window. */
function sameWindow(a: SampleWindow, b: SampleWindow): boolean {
  if (b.used < a.used - 1) return false;
  // A window that had not started when first read, and has since.
  if (a.resetsAt === null) return b.resetsAt === null || a.used <= 1;
  if (b.resetsAt === null) return false;
  return Math.abs(a.resetsAt - b.resetsAt) <= SAME_RESET_MS;
}

/** The burn on the weekly window between two moments, from the readings falling inside. A gap
 *  between readings counts at its average; a gap containing a reset says nothing and is skipped. */
function burn(samples: readonly Sample[], from: number, to: number) {
  let points = 0;
  let span = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (b.t <= from || a.t >= to || b.t <= a.t || a.week === null || b.week === null || !sameWindow(a.week, b.week)) continue;
    const inside = Math.min(b.t, to) - Math.max(a.t, from);
    const gained = Math.max(0, b.week.used - a.week.used) * (inside / (b.t - a.t));
    points += gained;
    span += inside;
  }
  return { points, hours: span / HOUR };
}

interface Pace {
  perHour: number;
  source: "history" | "blend" | "window-average" | "none";
  /** Hours of readings the pace is taken from, at most a day. */
  recentHours: number;
  /** Hours of readings there are in all. */
  historyHours: number;
  points: number;
}

/** The account's burn, averaged over the calendar. A day of readings gives the recent rate
 *  outright; with less, it is blended with the average since the week began, weighted by how
 *  much of a day there is, so a morning's burst is not taken for the whole week's pace. */
export function paceOf(samples: readonly Sample[], week: SampleWindow, now: number): Pace {
  const recent = burn(samples, now - LOOKBACK, now);
  const lastSeen = samples[samples.length - 1]?.t ?? now;
  const started = week.resetsAt === null ? null : week.resetsAt - WEEK;
  const elapsed = started === null ? 0 : (lastSeen - started) / HOUR;
  const average = elapsed >= MIN_RECENT_HOURS ? week.used / elapsed : null;
  const rate = recent.hours >= MIN_RECENT_HOURS ? recent.points / recent.hours : null;
  const base = { recentHours: recent.hours, historyHours: burn(samples, -Infinity, now).hours, points: recent.points };
  if (rate === null) {
    return average === null ? { ...base, perHour: 0, source: "none" } : { ...base, perHour: average, source: "window-average" };
  }
  const weight = Math.min(1, recent.hours / FULL_DAY_HOURS);
  if (average === null || weight === 1) return { ...base, perHour: rate, source: "history" };
  return { ...base, perHour: weight * rate + (1 - weight) * average, source: "blend" };
}

/** What one percent of the 5-hour window costs in percent of the week, from readings where both
 *  windows moved. Without enough of those, the assumption above, tightened by what today's
 *  figures rule out: this window cannot have cost more of the week than has been used of it. */
export function fiveHourShare(samples: readonly Sample[], five: SampleWindow, week: SampleWindow): { share: number; measured: boolean } {
  let fivePoints = 0;
  let weekPoints = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (a.five === null || b.five === null || a.week === null || b.week === null) continue;
    if (!sameWindow(a.five, b.five) || !sameWindow(a.week, b.week)) continue;
    const gained = b.five.used - a.five.used;
    if (gained <= 0) continue;
    fivePoints += gained;
    weekPoints += Math.max(0, b.week.used - a.week.used);
  }
  if (fivePoints >= MIN_FIVE_POINTS && weekPoints >= MIN_WEEK_POINTS) {
    return { share: Math.min(1, Math.max(0.01, weekPoints / fivePoints)), measured: true };
  }
  // A window begun before the week did may have cost more of it than this week has used.
  const insideWeek = five.resetsAt !== null && week.resetsAt !== null && five.resetsAt - FIVE_HOURS >= week.resetsAt - WEEK;
  const bound = insideWeek && five.used >= 20 ? Math.max(0.01, week.used / five.used) : ASSUMED_SHARE;
  return { share: Math.min(ASSUMED_SHARE, bound), measured: false };
}

/** A window as it stands now, given a reading that may predate its reset. */
function windowNow(read: SampleWindow | null, now: number, period: number): SampleWindow | null {
  if (read === null || read.resetsAt === null || read.resetsAt > now) return read;
  if (period === FIVE_HOURS) return { used: 0, resetsAt: null };
  return { used: 0, resetsAt: read.resetsAt + Math.max(1, Math.ceil((now - read.resetsAt) / period)) * period };
}

interface SimAccount {
  index: number;
  capacity: number;
  /** Percent of the week per percent of the 5-hour window; 0 with no 5-hour window. */
  share: number;
  week: SampleWindow;
  five: SampleWindow | null;
}

interface Point {
  t: number;
  reserve: number;
  available: number;
  up: boolean[];
}

interface Simulation {
  points: Point[];
  idle: z.output<typeof idleWindow>[];
  leftAtReset: (number | null)[];
  emptyAt: (number | null)[];
  spentBeforeReset: number[];
}

const NOTHING = 1e-6;

/** Percent of its week an account can take right now, in view of both windows. */
function room(account: SimAccount): number {
  const byWeek = EXHAUSTED_AT - account.week.used;
  const byFive = account.five === null ? Infinity : (EXHAUSTED_AT - account.five.used) * account.share;
  return Math.max(0, Math.min(byWeek, byFive));
}

/** Who takes the work now: of the accounts with room, the one whose week resets soonest. */
function firstUp(accounts: readonly SimAccount[]): SimAccount | undefined {
  return accounts
    .filter((account) => room(account) > NOTHING)
    .sort((a, b) => (a.week.resetsAt ?? Infinity) - (b.week.resetsAt ?? Infinity) || a.index - b.index)[0];
}

/** Runs the pool forward at `ratePerHour` (capacity units per hour) from `from` to `to`, from one
 *  reset or exhaustion to the next, so every reset lands at its exact time. A cut multiplies the
 *  rate for a stretch of time; that is how a slowdown is tried out. */
function simulate(
  start: readonly SimAccount[],
  ratePerHour: number,
  from: number,
  to: number,
  cut?: { from: number; to: number; factor: number },
): Simulation {
  if (start.length === 0) return { points: [{ t: from, reserve: 0, available: 0, up: [] }], idle: [], leftAtReset: [], emptyAt: [], spentBeforeReset: [] };
  const accounts = start.map((account) => ({ ...account, week: { ...account.week }, five: account.five && { ...account.five } }));
  const total = accounts.reduce((sum, account) => sum + account.capacity, 0);
  const points: Point[] = [];
  const idle: Simulation["idle"] = [];
  const leftAtReset: (number | null)[] = accounts.map(() => null);
  const emptyAt: (number | null)[] = accounts.map(() => null);
  const spentBeforeReset = accounts.map(() => 0);

  const applyResets = (t: number) => {
    accounts.forEach((account, i) => {
      if (account.week.resetsAt !== null && account.week.resetsAt <= t) {
        if (leftAtReset[i] === null) leftAtReset[i] = Math.max(0, EXHAUSTED_AT - account.week.used);
        account.week.used = 0;
        account.week.resetsAt += WEEK;
      }
      if (account.five !== null && account.five.resetsAt !== null && account.five.resetsAt <= t) {
        account.five.used = 0;
        account.five.resetsAt = null;
      }
    });
  };
  const record = (t: number) => {
    points.push({
      t,
      reserve: accounts.reduce((sum, account) => sum + account.capacity * Math.max(0, 100 - account.week.used), 0) / total,
      available: accounts.reduce((sum, account) => sum + account.capacity * room(account), 0) / total,
      up: accounts.map((account) => room(account) > NOTHING),
    });
  };
  const rateAt = (t: number) => (cut !== undefined && t >= cut.from && t < cut.to ? ratePerHour * cut.factor : ratePerHour);

  let t = from;
  for (;;) {
    applyResets(t);
    record(t);
    if (t >= to) break;
    const first = firstUp(accounts);
    const rate = rateAt(t);
    if (first !== undefined && rate > 0) {
      // Work starts a window that has not started: its reset is counted from here.
      first.week.resetsAt ??= t + WEEK;
      if (first.five !== null) first.five.resetsAt ??= t + FIVE_HOURS;
    }
    const boundary = Math.min(
      to,
      ...accounts.flatMap((account) => [account.week.resetsAt, account.five?.resetsAt ?? null]).filter((at): at is number => at !== null && at > t),
      ...(cut === undefined ? [] : [cut.from, cut.to].filter((at) => at > t)),
    );
    if (first === undefined) {
      const cause = accounts.every((account) => EXHAUSTED_AT - account.week.used <= NOTHING) ? "weekly" : "short";
      const last = idle[idle.length - 1];
      if (last !== undefined && last.to === t && last.cause === cause) last.to = boundary;
      else idle.push({ from: t, to: boundary, cause });
      t = boundary;
      record(t);
      continue;
    }
    if (rate <= 0) {
      t = boundary;
      record(t);
      continue;
    }
    const perHour = rate / first.capacity;
    const end = Math.max(t + 1, Math.min(boundary, t + (room(first) / perHour) * HOUR));
    const spent = Math.min(room(first), perHour * ((end - t) / HOUR));
    first.week.used += spent;
    if (first.five !== null) first.five.used += spent / first.share;
    if (leftAtReset[first.index] === null) spentBeforeReset[first.index]! += spent;
    if (leftAtReset[first.index] === null && emptyAt[first.index] === null && EXHAUSTED_AT - first.week.used <= NOTHING) emptyAt[first.index] = end;
    t = end;
    record(t);
  }
  return { points, idle, leftAtReset, emptyAt, spentBeforeReset };
}

/**
 * How much of a week can really be spent between now and `until`: what is left of the current
 * 5-hour window, then a whole new window from each reset, up to what is left of the week. Only
 * the windows limit it, not how fast a person works: promising a little too much costs nothing,
 * since what is not spent is lost at the reset anyway. `limitedByShort`: the windows are what
 * caps it, and some of the week will be lost however hard the account is used.
 */
function spendable(account: SimAccount, now: number, until: number) {
  const left = Math.max(0, EXHAUSTED_AT - account.week.used);
  if (account.five === null) return { amount: left, limitedByShort: false };
  let amount = 0;
  let t = now;
  let windowRoom = Math.max(0, EXHAUSTED_AT - account.five.used);
  let windowEnd = account.five.resetsAt ?? now + FIVE_HOURS;
  while (t < until && amount < left) {
    amount = Math.min(left, amount + windowRoom * account.share);
    t = Math.min(until, windowEnd);
    windowEnd = t + FIVE_HOURS;
    windowRoom = EXHAUSTED_AT;
  }
  return { amount, limitedByShort: amount < left };
}

/** The part of the error band that comes from how little there is to go on. Not statistics: a
 *  rule of thumb, used only until there are past days to measure the error against. */
function ruleOfThumbError(hours: number, points: number): number {
  const base = hours >= 48 ? 0.2 : hours >= 24 ? 0.3 : hours >= 12 ? 0.4 : 0.6;
  return Math.min(1, base + (points > 0 ? 0.5 / points : 0));
}

/** How far each past day's rate was from the following day's, relative to what was burned: what
 *  "use yesterday's pace" has been worth lately. Null without at least two such pairs of days. */
function backtestError(all: readonly { capacity: number; samples: readonly Sample[] }[], now: number): number | null {
  const oldest = Math.min(...all.map((row) => row.samples[0]?.t ?? Infinity));
  let wrong = 0;
  let burned = 0;
  let pairs = 0;
  for (let end = now - DAY; end - DAY >= oldest; end -= DAY) {
    let before = 0;
    let after = 0;
    let covered = true;
    for (const row of all) {
      const earlier = burn(row.samples, end - DAY, end);
      const later = burn(row.samples, end, end + DAY);
      if (earlier.hours < 20 || later.hours < 20) {
        covered = false;
        break;
      }
      before += row.capacity * (earlier.points / earlier.hours);
      after += row.capacity * (later.points / later.hours);
    }
    if (!covered) continue;
    wrong += Math.abs(before - after);
    burned += after;
    pairs += 1;
  }
  return pairs >= 2 && burned > 0 ? wrong / burned : null;
}

interface Capacity {
  capacity: number;
  source: AccountForecast["capacitySource"];
}

/** What settles an account's size: its tier, or Pro, which comes in one size. "Max" alone does
 *  not: it may be 5x or 20x. Empty when the size is not settled. */
const sizeOf = (row: AccountView) => (row.rateLimitTier !== "" ? row.rateLimitTier : row.subscriptionType === "pro" ? "pro" : "");

/** A shape of limits: accounts of one size with the same windows have the same capacity. */
const planOf = (row: AccountView) => `${sizeOf(row)}|${row.fiveHour === null ? "week" : "both"}`;

/**
 * What each ticked account weighs. Accounts on one plan weigh the same with nothing assumed about
 * that plan. Otherwise each needs a size: set by hand, or the plan's multiple of Pro. An account
 * with neither has no size to weigh, and adding its percentages to the others' would be exactly
 * the sum this forecast refuses to make, so it stays out until it is given one.
 */
function capacities(rows: readonly AccountView[], manual: Readonly<Record<string, number>>): Map<string, Capacity | null> {
  const untouched = rows.filter((row) => manual[row.key] === undefined);
  const samePlan =
    untouched.length === rows.length &&
    (rows.length === 1 || (new Set(rows.map(planOf)).size === 1 && sizeOf(rows[0]!) !== ""));
  return new Map(
    rows.map((row): [string, Capacity | null] => {
      if (samePlan) return [row.key, { capacity: 1, source: "same-plan" }];
      const set = manual[row.key];
      if (set !== undefined) return [row.key, { capacity: set, source: "manual" }];
      const multiple = planMultiple(row.rateLimitTier, row.subscriptionType);
      return [row.key, multiple === null ? null : { capacity: multiple, source: "plan" }];
    }),
  );
}

const reading = (bar: { utilization: number; resetsAt: string } | null): SampleWindow | null => {
  if (bar === null) return null;
  const at = Date.parse(bar.resetsAt);
  return { used: Math.max(0, Math.min(100, bar.utilization)), resetsAt: Number.isFinite(at) ? at : null };
};

const titleOf = (row: AccountView) => (row.email !== "" ? row.email : row.name);

/** The forecast with every account named by `nameOf(key)`, where it gives a name. The daemon
 *  names accounts by address, but one address can be two accounts, and only the client knows the
 *  app's language to say whose each is in. */
export function retitle(forecast: Forecast, nameOf: (key: string) => string | undefined): Forecast {
  const name = (key: string | null, title: string) => (key === null ? title : (nameOf(key) ?? title));
  return {
    ...forecast,
    accounts: forecast.accounts.map((account) => ({ ...account, title: name(account.key, account.title) })),
    excluded: forecast.excluded.map((item) => ({ ...item, title: name(item.key, item.title) })),
    hints: forecast.hints.map((hint) =>
      hint.kind !== "speed-up"
        ? hint
        : {
            ...hint,
            title: name(hint.key, hint.title),
            servedNow: hint.servedNow === null ? null : name(hint.servedNowKey, hint.servedNow),
          },
    ),
  };
}

function whyNot(row: AccountView): ForecastExclusion | null {
  if (row.usage === "unsupported") return "no-meter";
  // A reading that failed may still carry the last good numbers, with their own age.
  if (row.fiveHour === null && row.sevenDay === null) return "no-reading";
  if (row.sevenDay === null) return "no-week";
  const week = reading(row.sevenDay)!;
  // A week with something used in it and no reset time cannot be placed on the timeline.
  if (week.resetsAt === null && week.used > 0) return "no-reset";
  return null;
}

export interface ForecastRequest {
  rows: readonly AccountView[];
  samples(row: AccountView): readonly Sample[];
  unchecked: readonly string[];
  capacity: Readonly<Record<string, number>>;
  columns: number;
  now: number;
}

function columnsOf(
  nominal: Simulation,
  fast: Simulation,
  slow: Simulation,
  from: number,
  to: number,
  count: number,
): z.output<typeof chartColumn>[] {
  const span = (to - from) / count;
  const valueAt = (points: readonly Point[], t: number) => {
    let i = 0;
    while (i + 1 < points.length && points[i + 1]!.t <= t) i += 1;
    const a = points[i]!;
    const b = points[i + 1];
    const ratio = b === undefined || b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    return { reserve: a.reserve + ((b?.reserve ?? a.reserve) - a.reserve) * ratio, available: a.available + ((b?.available ?? a.available) - a.available) * ratio };
  };
  return Array.from({ length: count }, (_, i) => {
    const at = from + (i + 0.5) * span;
    const start = from + i * span;
    const end = start + span;
    const value = valueAt(nominal.points, at);
    return {
      at,
      reserve: value.reserve,
      low: valueAt(fast.points, at).reserve,
      high: valueAt(slow.points, at).reserve,
      available: value.available,
      idle: nominal.idle.some((spell) => spell.from < end && spell.to > start),
    };
  });
}

/** The first idle spell, if it can be avoided, and how much slower to go to avoid it: the mildest
 *  slowdown, held from now until the reset that ends the spell, that leaves no idle before it. */
function slowDownHint(accounts: readonly SimAccount[], rate: number, nominal: Simulation, now: number, to: number, capacity: number): ForecastHint | null {
  const first = nominal.idle.find((spell) => spell.to - spell.from >= MIN_IDLE_MS);
  if (first === undefined) return null;
  if (first.from <= now + 60_000) return { kind: "idle-now", until: first.to };
  const solve = (startAt: number): number => {
    const clear = (factor: number) =>
      !simulate(accounts, rate, now, to, { from: startAt, to: first.to, factor }).idle.some(
        (spell) => spell.from < first.to - 60_000 && spell.to - spell.from >= MIN_IDLE_MS,
      );
    let low = 0;
    let high = 1;
    for (let i = 0; i < 24; i += 1) {
      const middle = (low + high) / 2;
      if (clear(middle)) low = middle;
      else high = middle;
    }
    return low;
  };
  const factor = solve(now);
  const laterStartAt = now + (first.from - now) / 2;
  const later = solve(laterStartAt);
  return {
    kind: "slow-down",
    idleFrom: first.from,
    idleTo: first.to,
    startAt: now,
    untilAt: first.to,
    cutPercent: (1 - factor) * 100,
    pacePerHour: rate / capacity,
    targetPerHour: (rate * factor) / capacity,
    laterStartAt,
    laterCutPercent: (1 - later) * 100,
  };
}

/** The account losing the most soon: the first, by its reset, that the forecast leaves with
 *  something it could still spend. */
function speedUpHint(
  accounts: readonly SimAccount[],
  rows: readonly AccountView[],
  nominal: Simulation,
  rate: number,
  now: number,
): ForecastHint | null {
  const candidates = accounts
    .map((account) => {
      const lost = nominal.leftAtReset[account.index] ?? 0;
      const until = account.week.resetsAt;
      return { account, lost, until };
    })
    .filter((candidate): candidate is typeof candidate & { until: number } => candidate.until !== null && candidate.lost >= MIN_LOST_PERCENT && candidate.until - now >= MIN_TIME_TO_ACT_MS)
    .sort((a, b) => a.until - b.until);
  const serving = firstUp(accounts);
  for (const { account, lost, until } of candidates) {
    const room = spendable(account, now, until);
    const extra = Math.min(lost, Math.max(0, room.amount - nominal.spentBeforeReset[account.index]!));
    if (extra < MIN_EXTRA_PERCENT) continue;
    const row = rows[account.index]!;
    const firstFree = roomNow(account) ? now : (account.five?.resetsAt ?? now);
    const hours = (until - firstFree) / HOUR;
    return {
      kind: "speed-up",
      key: row.key,
      title: titleOf(row),
      servedNow: serving === undefined || serving === account ? null : titleOf(rows[serving.index]!),
      servedNowKey: serving === undefined || serving === account ? null : rows[serving.index]!.key,
      startAt: firstFree,
      untilAt: until,
      lostPercent: lost,
      extraPercent: extra,
      boostPercent: rate > 0 && hours > 0 ? ((extra * account.capacity) / hours / rate) * 100 : null,
      shortWindowLimited: room.limitedByShort,
    };
  }
  return null;
}

const roomNow = (account: SimAccount) => room(account) > NOTHING;

/** Nothing to act on and nothing to warn about: no idle spell, no hint, and no account forecast
 *  to lose a share of its week worth a hint, even one it is too late to do anything about. */
export function onTrack(result: Forecast): boolean {
  return result.hints.length === 0 && result.idle.length === 0 && result.accounts.every((account) => account.leftAtReset < MIN_LOST_PERCENT);
}

/** The forecast for the ticked accounts, in the shape of `forecastRpc`'s answer. */
export function computeForecast(request: ForecastRequest): Forecast {
  const { now } = request;
  const unchecked = new Set(request.unchecked);
  const candidates = request.rows.filter((row) => row.registered && row.loggedIn && !unchecked.has(row.key));
  const excluded: Forecast["excluded"] = [];
  const readable = candidates.filter((row) => {
    const reason = whyNot(row);
    if (reason !== null) excluded.push({ key: row.key, title: titleOf(row), reason });
    return reason === null;
  });
  const weights = capacities(readable, request.capacity);
  const rows = readable.filter((row) => {
    if (weights.get(row.key) !== null) return true;
    excluded.push({ key: row.key, title: titleOf(row), reason: "no-capacity" });
    return false;
  });

  const prepared = rows.map((row, index) => {
    const samples = request.samples(row);
    // The newest reading is the state the forecast starts from, also when history lost it.
    const week = windowNow(reading(row.sevenDay), now, WEEK)!;
    const five = windowNow(reading(row.fiveHour), now, FIVE_HOURS);
    const pace = paceOf(samples, reading(row.sevenDay)!, now);
    const share = five === null ? { share: 0, measured: false } : fiveHourShare(samples, reading(row.fiveHour)!, reading(row.sevenDay)!);
    const { capacity, source } = weights.get(row.key)!;
    const sim: SimAccount = { index, capacity, share: share.share, week, five };
    return { row, samples, pace, share, sim, source };
  });

  const total = prepared.reduce((sum, item) => sum + item.sim.capacity, 0);
  const sims = prepared.map((item) => item.sim);
  const rate = prepared.reduce((sum, item) => sum + item.sim.capacity * item.pace.perHour, 0);
  const until = Math.max(now + DAY, ...sims.map((sim) => (sim.week.resetsAt ?? now) + 60_000));

  const hours = prepared.map((item) => item.pace.historyHours);
  const historyHoursMin = hours.length === 0 ? 0 : Math.min(...hours);
  const historyHoursMax = hours.length === 0 ? 0 : Math.max(...hours);
  const backtest = rows.length === 0 ? null : backtestError(prepared.map((item) => ({ capacity: item.sim.capacity, samples: item.samples })), now);
  const points = prepared.reduce((sum, item) => sum + item.pace.points, 0);
  const error = backtest ?? ruleOfThumbError(historyHoursMin, points);
  const bounded = Math.min(1, error);

  const nominal = simulate(sims, rate, now, until);
  const fast = simulate(sims, rate * (1 + bounded), now, until);
  const slow = simulate(sims, Math.max(0, rate * (1 - bounded)), now, until);

  const readingAges = prepared.map((item) => (item.row.usageAt === null ? null : Math.max(0, now - item.row.usageAt)));
  const known = readingAges.filter((age): age is number => age !== null);
  const anyPace = prepared.some((item) => item.pace.source !== "none");
  const assumedShares = prepared.some((item) => item.sim.five !== null && !item.share.measured);
  const planWeights = prepared.some((item) => item.source === "plan");

  const accounts: AccountForecast[] = prepared.map((item) => {
    const { sim, row, pace, share, source } = item;
    const room = spendable(sim, now, sim.week.resetsAt ?? until);
    const samples = item.samples.length;
    return {
      key: row.key,
      title: titleOf(row),
      capacity: sim.capacity,
      capacitySource: source,
      week: sim.week,
      five: sim.five,
      fiveHourCost: sim.five === null ? null : share.share * 100,
      fiveHourCostMeasured: share.measured,
      pacePerHour: pace.perHour,
      paceSource: pace.source,
      historyHours: pace.historyHours,
      samples,
      readingAgeMs: readingAges[sim.index]!,
      weekEmptyAt: nominal.emptyAt[sim.index]!,
      leftAtReset: nominal.leftAtReset[sim.index] ?? Math.max(0, EXHAUSTED_AT - sim.week.used),
      spendableBeforeReset: room.amount,
      shortWindowLimits: room.limitedByShort,
      up: [],
    };
  });

  const columns = rows.length === 0 ? [] : columnsOf(nominal, fast, slow, now, until, request.columns);
  const flagsAt = (t: number) => {
    let i = 0;
    while (i + 1 < nominal.points.length && nominal.points[i + 1]!.t <= t) i += 1;
    return nominal.points[i]!.up;
  };
  for (const column of columns) {
    const flags = flagsAt(column.at);
    accounts.forEach((account, i) => account.up.push(flags[i]!));
  }

  const resets: Forecast["resets"] = prepared.flatMap((item) => [
    ...(item.sim.week.resetsAt === null ? [] : [{ at: item.sim.week.resetsAt, key: item.row.key, kind: "week" as const }]),
    ...(item.sim.five === null || item.sim.five.resetsAt === null ? [] : [{ at: item.sim.five.resetsAt, key: item.row.key, kind: "five" as const }]),
  ]);

  const hints: ForecastHint[] = [];
  if (rows.length > 0) {
    // What has no room right now is a fact, whatever is known about the pace; the rest is not.
    const slowDown = slowDownHint(sims, rate, nominal, now, until, total);
    if (slowDown !== null && (anyPace || slowDown.kind === "idle-now")) hints.push(slowDown);
    const speedUp = anyPace ? speedUpHint(sims, rows, nominal, rate, now) : null;
    if (speedUp !== null) hints.push(speedUp);
  }

  const lastPoint = nominal.points[nominal.points.length - 1];
  const assumptions: Forecast["assumptions"] = rows.length === 0 ? [] : ["percent-only", "steady-pace", "earliest-reset-first", "model-limits-ignored", "spend-ceiling"];
  if (prepared.some((item) => item.sim.five !== null)) assumptions.push("short-window-restarts");
  if (prepared.some((item) => item.source === "same-plan") && prepared.length > 1) assumptions.push("same-plan-capacity");
  if (planWeights) assumptions.push("plan-multiple-capacity");
  if (prepared.some((item) => item.source === "manual")) assumptions.push("manual-capacity");
  if (assumedShares) assumptions.push("short-window-assumed");
  if (prepared.some((item) => item.pace.source === "window-average" || item.pace.source === "none")) assumptions.push("no-history");
  else if (prepared.some((item) => item.pace.historyHours < 24)) assumptions.push("thin-history");
  if (known.some((age) => age > OLD_READING_MS)) assumptions.push("old-readings");

  const thin = historyHoursMin < 12 || prepared.some((item) => item.pace.source === "window-average" || item.pace.source === "none");
  const level: Forecast["accuracy"]["level"] = !anyPace
    ? "insufficient"
    : thin || planWeights || bounded >= 0.5
      ? "low"
      : historyHoursMin >= 72 && backtest !== null && bounded < 0.25 && !assumedShares
        ? "high"
        : "medium";

  return {
    at: now,
    until,
    accounts,
    excluded,
    columns,
    resets,
    idle: nominal.idle,
    pool: {
      reserve: nominal.points[0]?.reserve ?? 0,
      available: nominal.points[0]?.available ?? 0,
      pacePerHour: total > 0 ? rate / total : 0,
      reserveAtEnd: lastPoint?.reserve ?? 0,
    },
    hints,
    accuracy: {
      level,
      errorPercent: bounded * 100,
      basis: backtest === null ? "history-length" : "backtest",
      historyHoursMin,
      historyHoursMax,
      samples: prepared.reduce((sum, item) => sum + item.samples.length, 0),
      oldestReadingMs: known.length === 0 ? null : Math.max(...known),
    },
    assumptions,
  };
}
