import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountView } from "./accounts.ts";
import { type Forecast, type ForecastHint, type Sample, computeForecast, fiveHourShare, forecast, onTrack, paceOf, planMultiple } from "./forecast.ts";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 8, 12);
const h = (hours: number) => NOW + hours * HOUR;
const iso = (at: number) => new Date(at).toISOString();

function row(key: string, over: Partial<AccountView> = {}): AccountView {
  return {
    id: key,
    name: key,
    home: `/home/${key}`,
    provider: "claude",
    registered: true,
    key,
    loggedIn: true,
    email: `${key}@example.com`,
    orgName: "",
    subscriptionType: "max",
    rateLimitTier: "default_claude_max_20x",
    accountIds: [key],
    switchTo: key,
    isDefault: false,
    autoNow: false,
    usage: "ok",
    fiveHour: null,
    sevenDay: { utilization: 0, resetsAt: iso(h(72)) },
    usageErrorCode: "",
    usageError: "",
    usageAt: NOW,
    heldUntil: null,
    ...over,
  } as AccountView;
}

/** Readings every ten minutes over `hours` up to `to`, the week burning `perHour` and ending at
 *  `usedNow`; the 5-hour figure, if asked for, rises with it at `share` of the week per point. */
function history(options: {
  hours: number;
  usedNow: number;
  perHour: number;
  resetsAt: number;
  to?: number;
  five?: { share: number; resetsAt: number };
}): Sample[] {
  const to = options.to ?? NOW;
  const samples: Sample[] = [];
  for (let at = to - options.hours * HOUR; at <= to; at += 10 * 60_000) {
    const used = options.usedNow - options.perHour * ((to - at) / HOUR);
    samples.push({
      t: at,
      week: { used: Math.max(0, used), resetsAt: options.resetsAt },
      five:
        options.five === undefined
          ? null
          : { used: Math.max(0, used / options.five.share - (options.usedNow / options.five.share - 50)), resetsAt: options.five.resetsAt },
    });
  }
  return samples;
}

function run(
  rows: AccountView[],
  samples: Record<string, Sample[]> = {},
  extra: { unchecked?: string[]; capacity?: Record<string, number>; columns?: number } = {},
): Forecast {
  // The host parses every answer with this schema; a NaN that gets past it fails the whole call.
  return forecast.parse(
    computeForecast({
      rows,
      samples: (account) => samples[account.key] ?? [],
      unchecked: extra.unchecked ?? [],
      capacity: extra.capacity ?? {},
      columns: extra.columns ?? 48,
      now: NOW,
    }),
  );
}

function hintOf<K extends ForecastHint["kind"]>(result: Forecast, kind: K): Extract<ForecastHint, { kind: K }> {
  const found = result.hints.find((hint) => hint.kind === kind);
  assert.ok(found, `expected a ${kind} hint, got ${JSON.stringify(result.hints)}`);
  return found as Extract<ForecastHint, { kind: K }>;
}

function near(actual: number, expected: number, within: number) {
  assert.ok(Math.abs(actual - expected) <= within, `${actual} is not within ${within} of ${expected}`);
}

test("a plan's multiple comes from its tier, and Pro is the unit", () => {
  assert.equal(planMultiple("default_claude_max_20x", "max"), 20);
  assert.equal(planMultiple("default_claude_max_5x", "max"), 5);
  assert.equal(planMultiple("", "pro"), 1);
  assert.equal(planMultiple("", "max"), null);
  assert.equal(planMultiple("default_raven", "team"), null);
});

test("a full day of readings is the recent pace", () => {
  const resetsAt = h(100);
  const pace = paceOf(history({ hours: 24, usedNow: 30, perHour: 0.5, resetsAt }), { used: 30, resetsAt }, NOW);
  assert.equal(pace.source, "history");
  near(pace.perHour, 0.5, 0.001);
});

test("a stretch containing a reset says nothing about the pace", () => {
  const before: Sample[] = [
    { t: h(-30), week: { used: 95, resetsAt: h(-6) }, five: null },
    { t: h(-20), week: { used: 99, resetsAt: h(-6) }, five: null },
  ];
  const after: Sample[] = [
    { t: h(-4), week: { used: 1, resetsAt: h(162) }, five: null },
    { t: h(0), week: { used: 3, resetsAt: h(162) }, five: null },
  ];
  const pace = paceOf([...before, ...after], { used: 3, resetsAt: h(162) }, NOW);
  // Four hours of the old window fall inside the day and four of the new; the sixteen across
  // the reset do not count.
  near(pace.recentHours, 8, 0.001);
  near(pace.historyHours, 14, 0.001);
});

test("with a few hours of history the pace leans on the week's average", () => {
  const resetsAt = h(84); // 84 hours into the week
  const samples = history({ hours: 6, usedNow: 42, perHour: 4, resetsAt });
  const pace = paceOf(samples, { used: 42, resetsAt }, NOW);
  assert.equal(pace.source, "blend");
  // A quarter of a day: a quarter of the 4 %/h burst and three quarters of the 0.5 %/h average.
  near(pace.perHour, 0.25 * 4 + 0.75 * 0.5, 0.05);
});

test("with no history the pace is the week's average so far", () => {
  const resetsAt = h(84);
  const pace = paceOf([], { used: 42, resetsAt }, NOW);
  assert.equal(pace.source, "window-average");
  near(pace.perHour, 0.5, 0.01);
});

test("a week that has barely begun gives no pace at all", () => {
  const pace = paceOf([], { used: 2, resetsAt: NOW + 7 * 24 * HOUR - 10 * 60_000 }, NOW);
  assert.equal(pace.source, "none");
  assert.equal(pace.perHour, 0);
});

test("what a 5-hour window costs is measured when both windows moved enough", () => {
  const samples: Sample[] = [
    { t: h(-3), five: { used: 10, resetsAt: h(2) }, week: { used: 20, resetsAt: h(90) } },
    { t: h(-2), five: { used: 30, resetsAt: h(2) }, week: { used: 22, resetsAt: h(90) } },
    { t: h(-1), five: { used: 60, resetsAt: h(2) }, week: { used: 25, resetsAt: h(90) } },
  ];
  const { share, measured } = fiveHourShare(samples, { used: 60, resetsAt: h(2) }, { used: 25, resetsAt: h(90) });
  assert.equal(measured, true);
  near(share, 5 / 50, 0.001);
});

test("without enough movement the assumption stands, capped by what today's figures rule out", () => {
  const plain = fiveHourShare([], { used: 5, resetsAt: h(2) }, { used: 40, resetsAt: h(90) });
  assert.deepEqual(plain, { share: 0.15, measured: false });
  // Half a window used while only 3% of the week is: a window costs at most 6% of the week.
  const tight = fiveHourShare([], { used: 50, resetsAt: h(2) }, { used: 3, resetsAt: h(90) });
  assert.equal(tight.measured, false);
  near(tight.share, 3 / 50, 0.001);
});

test("different capacities are weighed: bare percentages are not added up", () => {
  const result = run([
    row("small", { subscriptionType: "pro", rateLimitTier: "", sevenDay: { utilization: 0, resetsAt: iso(h(100)) } }),
    row("big", { rateLimitTier: "default_claude_max_20x", sevenDay: { utilization: 100, resetsAt: iso(h(100)) } }),
  ]);
  // Half of two bare percentages would be 50. The empty Pro is 1/21 of the combined capacity.
  near(result.pool.reserve, (100 * 1) / 21, 0.1);
  assert.ok(result.assumptions.includes("plan-multiple-capacity"));
  assert.equal(result.accuracy.level, "low");
});

test("accounts on one plan weigh the same, with nothing assumed about the plan", () => {
  const result = run([
    row("a", { sevenDay: { utilization: 20, resetsAt: iso(h(100)) } }),
    row("b", { sevenDay: { utilization: 60, resetsAt: iso(h(100)) } }),
  ]);
  near(result.pool.reserve, 60, 0.001);
  assert.ok(result.assumptions.includes("same-plan-capacity"));
  assert.ok(!result.assumptions.includes("plan-multiple-capacity"));
  assert.deepEqual(result.accounts.map((account) => account.capacitySource), ["same-plan", "same-plan"]);
});

test("an account of unknown size stays out until it is given one", () => {
  const rows = [
    row("known", { sevenDay: { utilization: 50, resetsAt: iso(h(100)) } }),
    row("mystery", { subscriptionType: "team", rateLimitTier: "default_raven", sevenDay: { utilization: 0, resetsAt: iso(h(100)) } }),
  ];
  const first = run(rows);
  assert.deepEqual(first.excluded.map((item) => [item.key, item.reason]), [["mystery", "no-capacity"]]);
  assert.deepEqual(first.accounts.map((account) => account.key), ["known"]);
  const second = run(rows, {}, { capacity: { mystery: 20 } });
  assert.deepEqual(second.excluded, []);
  assert.equal(second.accounts.find((account) => account.key === "mystery")?.capacitySource, "manual");
  assert.ok(second.assumptions.includes("manual-capacity"));
  near(second.pool.reserve, 75, 0.001);
});

test("a failed reading that still carries its last numbers stays in the forecast", () => {
  const result = run([row("a", { usage: "error", usageError: "network down", sevenDay: { utilization: 50, resetsAt: iso(h(100)) } })]);
  assert.deepEqual(result.excluded, []);
  near(result.pool.reserve, 50, 0.001);
});

test("an unticked account is left out and accounts that cannot be measured say why", () => {
  const result = run(
    [
      row("off"),
      row("codex", { usage: "unsupported", sevenDay: null }),
      row("expired", { usage: "expired", sevenDay: null }),
      row("week-less", { fiveHour: { utilization: 10, resetsAt: iso(h(2)) }, sevenDay: null }),
      row("timeless", { sevenDay: { utilization: 40, resetsAt: "" } }),
    ],
    {},
    { unchecked: ["off"] },
  );
  assert.deepEqual(
    result.excluded.map((item) => [item.key, item.reason]),
    [["codex", "no-meter"], ["expired", "no-reading"], ["week-less", "no-week"], ["timeless", "no-reset"]],
  );
  assert.deepEqual(result.accounts, []);
  assert.equal(result.accuracy.level, "insufficient");
  assert.deepEqual(result.columns, []);
});

test("staggered resets: each lands at its exact time and work goes to the soonest first", () => {
  const soon = h(6);
  const late = h(96);
  const samples = {
    a: history({ hours: 30, usedNow: 90, perHour: 1, resetsAt: soon }),
    b: history({ hours: 30, usedNow: 20, perHour: 0, resetsAt: late }),
  };
  const result = run(
    [
      row("a", { sevenDay: { utilization: 90, resetsAt: iso(soon) } }),
      row("b", { sevenDay: { utilization: 20, resetsAt: iso(late) } }),
    ],
    samples,
  );
  assert.deepEqual(
    result.resets.map((reset) => [reset.key, reset.kind, reset.at]),
    [["a", "week", soon], ["b", "week", late]],
  );
  const a = result.accounts.find((account) => account.key === "a")!;
  const b = result.accounts.find((account) => account.key === "b")!;
  // A burns first because it resets first: 90 + 6 h at 1 %/h leaves 3.5 of 99.5.
  near(a.leftAtReset, 3.5, 0.2);
  assert.equal(a.weekEmptyAt, null);
  assert.ok(b.leftAtReset < 79.5, "b takes the work after a's reset moved a's next week past b's");
  // The reserve jumps up at a's reset, and the chart's columns show it.
  const beforeReset = result.columns.find((column) => column.at > h(5) && column.at < soon);
  const afterReset = result.columns.find((column) => column.at > soon);
  if (beforeReset !== undefined && afterReset !== undefined) {
    assert.ok(afterReset.reserve > beforeReset.reserve + 30, `${beforeReset.reserve} -> ${afterReset.reserve}`);
  }
});

test("the short window limits what can really be spent before the reset", () => {
  const weekResets = h(8);
  const fiveResets = h(2);
  const result = run(
    [
      row("a", {
        fiveHour: { utilization: 80, resetsAt: iso(fiveResets) },
        sevenDay: { utilization: 40, resetsAt: iso(weekResets) },
      }),
    ],
    {
      a: history({
        hours: 30,
        usedNow: 40,
        perHour: 1,
        resetsAt: weekResets,
        five: { share: 0.1, resetsAt: fiveResets },
      }),
    },
  );
  const a = result.accounts[0]!;
  // One window costs 10% of the week: what is left of this one (19.5 points, 1.95%), one whole
  // window from its reset, and one more started before the reset; never the 59.5% still free.
  assert.equal(a.fiveHourCostMeasured, true);
  near(a.fiveHourCost!, 10, 0.5);
  near(a.spendableBeforeReset, 1.95 + 9.95 + 9.95, 1.5);
  assert.equal(a.shortWindowLimits, true);
  const speedUp = hintOf(result, "speed-up");
  assert.equal(speedUp.shortWindowLimited, true);
  assert.ok(speedUp.extraPercent < speedUp.lostPercent, "the hint promises only what fits the short windows");
});

test("too fast: an idle spell is forecast, with when and how much to slow down", () => {
  const resetsAt = h(40);
  const result = run(
    [row("a", { sevenDay: { utilization: 80, resetsAt: iso(resetsAt) } })],
    { a: history({ hours: 30, usedNow: 80, perHour: 1, resetsAt }) },
  );
  assert.equal(result.idle.length, 1);
  const spell = result.idle[0]!;
  near(spell.from, h(19.5), HOUR * 0.1);
  assert.equal(spell.to, resetsAt);
  assert.equal(spell.cause, "weekly");
  const slowDown = hintOf(result, "slow-down");
  assert.equal(slowDown.startAt, NOW);
  assert.equal(slowDown.untilAt, resetsAt);
  // 19.5 points left over 40 hours is 0.4875 %/h against 1 %/h now.
  near(slowDown.cutPercent, 51.25, 1);
  near(slowDown.targetPerHour, 0.4875, 0.02);
  // Later is harder: halfway to the spell, the same reset needs a much bigger cut.
  assert.ok(slowDown.laterCutPercent! > slowDown.cutPercent + 10);
  assert.equal(result.accounts[0]!.weekEmptyAt !== null, true);
});

test("plenty left: the account resetting soonest is the one to use first, faster", () => {
  const soon = h(10);
  const late = h(120);
  const result = run(
    [
      row("late", { sevenDay: { utilization: 10, resetsAt: iso(late) } }),
      row("soon", { sevenDay: { utilization: 50, resetsAt: iso(soon) } }),
    ],
    {
      late: history({ hours: 30, usedNow: 10, perHour: 0.1, resetsAt: late }),
      soon: history({ hours: 30, usedNow: 50, perHour: 0.5, resetsAt: soon }),
    },
  );
  const speedUp = hintOf(result, "speed-up");
  assert.equal(speedUp.key, "soon");
  assert.equal(speedUp.untilAt, soon);
  assert.ok(speedUp.lostPercent > 30, `lost ${speedUp.lostPercent}`);
  assert.equal(speedUp.startAt, NOW);
  assert.ok(speedUp.extraPercent >= 1);
  assert.ok(speedUp.boostPercent !== null && speedUp.boostPercent > 0);
  assert.equal(speedUp.servedNow, null, "the account at risk is the one to work on, so nobody else is named");
  assert.equal(result.hints.some((hint) => hint.kind === "slow-down"), false);
});

test("when the account at risk is not the one being worked on, the hint says who is", () => {
  // The pace fills the sooner week in time, so what is lost is the other account's.
  const soon = h(120);
  const late = h(135);
  const result = run(
    [
      row("late", { sevenDay: { utilization: 0, resetsAt: iso(late) } }),
      row("soon", { sevenDay: { utilization: 22, resetsAt: iso(soon) } }),
    ],
    {
      late: history({ hours: 30, usedNow: 0, perHour: 0, resetsAt: late }),
      soon: history({ hours: 30, usedNow: 22, perHour: 0.7, resetsAt: soon }),
    },
  );
  const speedUp = hintOf(result, "speed-up");
  assert.equal(speedUp.key, "late");
  assert.equal(speedUp.servedNow, "soon@example.com");
});

test("an account that cannot take work yet is not named as the one to work on now", () => {
  const soon = h(20);
  const late = h(120);
  const result = run(
    [
      row("soon", { fiveHour: { utilization: 100, resetsAt: iso(h(2)) }, sevenDay: { utilization: 10, resetsAt: iso(soon) } }),
      row("late", { fiveHour: { utilization: 0, resetsAt: iso(h(3)) }, sevenDay: { utilization: 10, resetsAt: iso(late) } }),
    ],
    {
      soon: history({ hours: 30, usedNow: 10, perHour: 0.2, resetsAt: soon }),
      late: history({ hours: 30, usedNow: 10, perHour: 0.2, resetsAt: late }),
    },
  );
  const speedUp = hintOf(result, "speed-up");
  assert.equal(speedUp.key, "soon");
  assert.equal(speedUp.startAt, h(2));
  assert.equal(speedUp.servedNow, "late@example.com");
});

test("no speed-up is promised when the short window already takes all the soonest account can give", () => {
  // One account resets in 4 h with most of its week left, but its 5-hour window is worth 5% of
  // the week and the forecast pace fills that; the other runs dry long before its own reset.
  const soon = h(4);
  const late = h(60);
  const result = run(
    [
      row("soon", { fiveHour: { utilization: 0, resetsAt: "" }, sevenDay: { utilization: 20, resetsAt: iso(soon) } }),
      row("late", { fiveHour: { utilization: 0, resetsAt: "" }, sevenDay: { utilization: 90, resetsAt: iso(late) } }),
    ],
    {
      soon: history({ hours: 30, usedNow: 20, perHour: 2.5, resetsAt: soon, five: { share: 0.05, resetsAt: h(5) } }),
      late: history({ hours: 30, usedNow: 90, perHour: 2.5, resetsAt: late, five: { share: 0.05, resetsAt: h(5) } }),
    },
  );
  assert.ok(result.hints.some((hint) => hint.kind === "slow-down"), JSON.stringify(result.hints));
  assert.equal(result.hints.some((hint) => hint.kind === "speed-up"), false);
  const soonAccount = result.accounts.find((account) => account.key === "soon")!;
  assert.ok(soonAccount.leftAtReset > 70, "most of its week is lost, and nothing can be done about it");
  assert.equal(soonAccount.shortWindowLimits, true);
});

test("spent 5-hour windows make idle spells of their own, and the hint says so", () => {
  const weekResets = h(70);
  const fiveResets = h(1);
  const result = run(
    [row("a", { fiveHour: { utilization: 97, resetsAt: iso(fiveResets) }, sevenDay: { utilization: 60, resetsAt: iso(weekResets) } })],
    { a: history({ hours: 24, usedNow: 60, perHour: 2.5, resetsAt: weekResets, five: { share: 0.1, resetsAt: fiveResets } }) },
  );
  assert.ok(result.idle.length >= 1);
  assert.equal(result.idle[0]!.cause, "short");
  assert.equal(result.idle[0]!.to, fiveResets);
  // 2.5 points of the window left, a quarter of a percent of the week: six minutes at 2.5 %/h.
  near(result.idle[0]!.from, h(0.1), 60_000);
});

test("an account spent now is unavailable until its reset, and the chart shows it", () => {
  const fiveResets = h(3);
  const weekResets = h(50);
  const result = run(
    [
      row("spent", {
        fiveHour: { utilization: 100, resetsAt: iso(fiveResets) },
        sevenDay: { utilization: 30, resetsAt: iso(weekResets) },
      }),
    ],
    {},
    { columns: 96 },
  );
  const account = result.accounts[0]!;
  const firstUp = account.up.findIndex((flag) => flag);
  assert.ok(firstUp > 0, "not available at the start");
  assert.ok(result.columns[firstUp]!.at >= fiveResets - 30 * 60_000);
  // It is back for the column after the reset.
  assert.equal(account.up[firstUp + 1], true);
  assert.equal(result.columns[0]!.available, 0);
});

test("no account with room right now is reported as an idle spell already under way", () => {
  const fiveResets = h(2);
  const result = run(
    [row("a", { fiveHour: { utilization: 100, resetsAt: iso(fiveResets) }, sevenDay: { utilization: 40, resetsAt: iso(h(90)) } })],
    { a: history({ hours: 30, usedNow: 40, perHour: 1, resetsAt: h(90), five: { share: 0.2, resetsAt: fiveResets } }) },
  );
  assert.deepEqual(hintOf(result, "idle-now"), { kind: "idle-now", until: fiveResets });
});

test("short history is called what it is, and the band says how little to trust it", () => {
  const result = run([row("a", { sevenDay: { utilization: 42, resetsAt: iso(h(84)) } })]);
  assert.equal(result.accounts[0]!.paceSource, "window-average");
  assert.equal(result.accuracy.level, "low");
  assert.equal(result.accuracy.basis, "history-length");
  assert.equal(result.accuracy.historyHoursMin, 0);
  assert.ok(result.accuracy.errorPercent >= 50);
  assert.ok(result.assumptions.includes("no-history"));
  // A band of real width around the forecast.
  const middle = result.columns[Math.floor(result.columns.length / 2)]!;
  assert.ok(middle.high > middle.low + 1, `${middle.low} .. ${middle.high}`);
});

test("no basis for a pace: no hints are invented and the forecast says it cannot tell", () => {
  const result = run([row("a", { sevenDay: { utilization: 1, resetsAt: iso(NOW + 7 * 24 * HOUR - 10 * 60_000) } })]);
  assert.equal(result.accounts[0]!.paceSource, "none");
  assert.equal(result.accuracy.level, "insufficient");
  assert.deepEqual(result.hints, []);
});

test("a reading from before a reset counts as the fresh window it has become", () => {
  const result = run([
    row("a", {
      fiveHour: { utilization: 80, resetsAt: iso(h(-1)) },
      sevenDay: { utilization: 90, resetsAt: iso(h(-2)) },
      usageAt: h(-10),
    }),
  ]);
  const account = result.accounts[0]!;
  assert.equal(account.week.used, 0);
  assert.equal(account.week.resetsAt, h(-2) + 7 * 24 * HOUR);
  assert.deepEqual(account.five, { used: 0, resetsAt: null });
  assert.ok(result.assumptions.includes("old-readings"));
});

test("past days set the error band once there are enough of them", () => {
  // Seven days at a dead steady pace: yesterday's pace is tomorrow's.
  const resetsAt = h(20);
  const samples = { a: history({ hours: 24 * 6, usedNow: 72, perHour: 0.5, resetsAt }) };
  const result = run([row("a", { sevenDay: { utilization: 72, resetsAt: iso(resetsAt) } })], samples);
  assert.equal(result.accuracy.basis, "backtest");
  assert.ok(result.accuracy.errorPercent < 1, `error ${result.accuracy.errorPercent}`);
  assert.equal(result.accuracy.level, "high");
});

test("an account with no 5-hour window is limited by its week alone", () => {
  const resetsAt = h(30);
  const result = run(
    [row("ultra", { fiveHour: null, sevenDay: { utilization: 60, resetsAt: iso(resetsAt) } })],
    { ultra: history({ hours: 30, usedNow: 60, perHour: 2, resetsAt }) },
  );
  assert.equal(result.accounts[0]!.fiveHourCost, null);
  assert.equal(result.accounts[0]!.five, null);
  assert.ok(!result.assumptions.includes("short-window-assumed"));
  // Exhausted at 60 + 2t = 99.5: about 20 hours in, then idle until the week resets.
  near(result.idle[0]!.from, h(19.75), HOUR * 0.1);
  assert.equal(result.idle[0]!.to, resetsAt);
});

test("with every ticked account left out the answer is zeros and reasons, not a failed call", () => {
  const result = run([
    row("one", { subscriptionType: "team", rateLimitTier: "default_raven", sevenDay: { utilization: 10, resetsAt: iso(h(70)) } }),
    row("two", { subscriptionType: "enterprise", rateLimitTier: "", sevenDay: { utilization: 20, resetsAt: iso(h(70)) } }),
  ]);
  assert.deepEqual(result.excluded.map((item) => item.reason), ["no-capacity", "no-capacity"]);
  assert.deepEqual(result.pool, { reserve: 0, available: 0, pacePerHour: 0, reserveAtEnd: 0 });
  assert.deepEqual(result.idle, []);
});

test("an empty list of accounts is an answer too", () => {
  const result = run([]);
  assert.deepEqual(result.accounts, []);
  assert.equal(result.pool.reserve, 0);
});

test("a spent account with no recent burn is idle, not on track: nobody burns what is not there", () => {
  const resetsAt = h(48);
  const result = run(
    [row("a", { sevenDay: { utilization: 100, resetsAt: iso(resetsAt) } })],
    { a: history({ hours: 25, usedNow: 100, perHour: 0, resetsAt }) },
  );
  assert.equal(result.accounts[0]!.pacePerHour, 0);
  assert.equal(result.idle.length, 1);
  assert.equal(result.idle[0]!.from, NOW);
  assert.equal(result.idle[0]!.to, resetsAt);
  assert.deepEqual(hintOf(result, "idle-now"), { kind: "idle-now", until: resetsAt });
});

test("no pace at all still says so when nothing has room right now", () => {
  const resetsAt = h(167.5);
  const result = run([row("a", { sevenDay: { utilization: 100, resetsAt: iso(resetsAt) } })]);
  assert.equal(result.accuracy.level, "insufficient");
  assert.deepEqual(hintOf(result, "idle-now"), { kind: "idle-now", until: resetsAt });
});

test("the week running out after its reset is not reported as before the reset", () => {
  const soon = h(2);
  const result = run(
    [
      row("a", { sevenDay: { utilization: 40, resetsAt: iso(soon) } }),
      row("b", { sevenDay: { utilization: 0, resetsAt: iso(h(144)) } }),
    ],
    {
      a: history({ hours: 26, usedNow: 40, perHour: 1.5, resetsAt: soon }),
      b: history({ hours: 26, usedNow: 0, perHour: 0, resetsAt: h(144) }),
    },
  );
  const a = result.accounts.find((account) => account.key === "a")!;
  assert.equal(a.weekEmptyAt, null);
  // 40 + 2 h at 1.5 %/h, of 99.5 usable; the run on b and back onto a comes after a's reset.
  near(a.leftAtReset, 56.5, 0.1);
});

test("two Max accounts with no known tier are not assumed equal: Max comes in 5x and 20x", () => {
  const result = run([
    row("a", { rateLimitTier: "", sevenDay: { utilization: 20, resetsAt: iso(h(100)) } }),
    row("b", { rateLimitTier: "", sevenDay: { utilization: 60, resetsAt: iso(h(100)) } }),
  ]);
  assert.deepEqual(result.excluded.map((item) => item.reason), ["no-capacity", "no-capacity"]);
  assert.deepEqual(result.accounts, []);
});

test("two Pro accounts are equal without a tier: Pro comes in one size", () => {
  const result = run([
    row("a", { subscriptionType: "pro", rateLimitTier: "", sevenDay: { utilization: 20, resetsAt: iso(h(100)) } }),
    row("b", { subscriptionType: "pro", rateLimitTier: "", sevenDay: { utilization: 60, resetsAt: iso(h(100)) } }),
  ]);
  assert.deepEqual(result.accounts.map((account) => account.capacitySource), ["same-plan", "same-plan"]);
  near(result.pool.reserve, 60, 0.001);
});

test("a 5-hour window older than the week is not bounded by the week's own figure", () => {
  // The week reset half an hour ago, inside a 5-hour window begun an hour ago.
  const { share, measured } = fiveHourShare([], { used: 40, resetsAt: h(4) }, { used: 1, resetsAt: h(167.5) });
  assert.equal(measured, false);
  assert.equal(share, 0.15);
});

test("a reset time drifting between readings is still one window", () => {
  const samples: Sample[] = [
    { t: h(-10), week: { used: 10, resetsAt: h(100) }, five: null },
    { t: h(0), week: { used: 20, resetsAt: h(100) + 12 * 60_000 }, five: null },
  ];
  const pace = paceOf(samples, { used: 20, resetsAt: h(100) + 12 * 60_000 }, NOW);
  near(pace.recentHours, 10, 0.001);
  assert.ok(pace.points === 10);
});

test("on track means no idle and nothing lost, not merely no hint", () => {
  // Used up to the last drop by the reset: nothing to say.
  const resetsAt = h(20);
  const steady = run([row("a", { sevenDay: { utilization: 79.5, resetsAt: iso(resetsAt) } })], { a: history({ hours: 30, usedNow: 79.5, perHour: 1, resetsAt }) });
  assert.equal(steady.idle.length, 0);
  assert.equal(onTrack(steady), true);
  // Twenty minutes before the reset, too late for a hint, with most of the week about to be lost.
  const late = h(1 / 3);
  const tooLate = run([row("a", { sevenDay: { utilization: 30, resetsAt: iso(late) } })], { a: history({ hours: 30, usedNow: 30, perHour: 0.5, resetsAt: late }) });
  assert.deepEqual(tooLate.hints, []);
  assert.equal(onTrack(tooLate), false);
  // The week runs out ten minutes before the reset: under a hint's threshold, still idle.
  const near10 = h(10);
  const shortOfIt = run([row("a", { sevenDay: { utilization: 89.5, resetsAt: iso(near10) } })], { a: history({ hours: 30, usedNow: 89.5, perHour: 1.0178, resetsAt: near10 }) });
  assert.ok(shortOfIt.idle.length > 0);
  assert.equal(onTrack(shortOfIt), false);
});
