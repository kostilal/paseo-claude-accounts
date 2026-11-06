import { test } from "node:test";
import assert from "node:assert/strict";
import { t } from "../shared/i18n.ts";
import type { PillAccount, PillState } from "../shared/switch.ts";
import { exhaustedResetIn, formatWait, hasSpare, pillFigure, pillPercent, tightestOf, usageLine, weekLine } from "./format.ts";

const strings = t("ru");
const now = Date.parse("2026-09-16T12:00:00Z");
/** A reset time this many minutes after `now`. */
const later = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

function account(over: Partial<PillAccount> = {}): PillAccount {
  return {
    label: "work",
    provider: "claude",
    home: "/w/work",
    key: "k",
    email: "alice@example.com",
    orgName: "",
    plan: "max",
    accountIds: ["work"],
    switchTo: "work",
    loggedIn: true,
    current: false,
    usage: "ok",
    fiveHour: { utilization: 18, resetsAt: "2026-09-16T13:00:00Z" },
    sevenDay: { utilization: 62, resetsAt: "2026-09-18T00:00:00Z" },
    ...over,
  };
}

test("the tightest window is the higher one, and unknown is null rather than zero", () => {
  assert.equal(tightestOf({ utilization: 18, resetsAt: "" }, { utilization: 62, resetsAt: "" }), 62);
  assert.equal(tightestOf(null, null), null);
});

test("an exhausted window reports the time until it resets", () => {
  const wait = exhaustedResetIn({ utilization: 100, resetsAt: "2026-09-16T12:47:00Z" }, null, now);
  assert.equal(wait, 47 * 60_000);
  assert.equal(exhaustedResetIn({ utilization: 94, resetsAt: "2026-09-16T12:47:00Z" }, null, now), null);
});

test("with both windows exhausted the wait is until the account can be used again", () => {
  const both = account({
    fiveHour: { utilization: 100, resetsAt: "2026-09-16T12:47:00Z" },
    sevenDay: { utilization: 100, resetsAt: "2026-09-19T12:00:00Z" },
  });
  assert.equal(pillFigure(both, now, strings), "3д 100%");
  assert.equal(usageLine(both, now, strings), `Claude · ${strings.limitExhausted} · ${strings.resetIn} 3 д`);
  // The later reset can be the 5 hours', and 99.7% is as spent as 100%.
  const weekFirst = account({
    fiveHour: { utilization: 99.7, resetsAt: later(180) },
    sevenDay: { utilization: 100, resetsAt: later(60) },
  });
  assert.equal(pillFigure(weekFirst, now, strings), "3ч 100%");
  const fromSpent = account({
    fiveHour: { utilization: 99.5, resetsAt: later(180) },
    sevenDay: { utilization: 100, resetsAt: later(60) },
  });
  assert.equal(pillFigure(fromSpent, now, strings), "3ч 100%");
});

test("an exhausted window with no reset time promises no wait", () => {
  const both = account({
    fiveHour: { utilization: 100, resetsAt: "2026-09-16T12:47:00Z" },
    sevenDay: { utilization: 100, resetsAt: "" },
  });
  assert.equal(exhaustedResetIn(both.fiveHour, both.sevenDay, now), null);
  assert.equal(pillFigure(both, now, strings), "100%");
  const fiveUnread = account({
    fiveHour: { utilization: 100, resetsAt: "" },
    sevenDay: { utilization: 100, resetsAt: later(72 * 60) },
  });
  assert.equal(pillFigure(fiveUnread, now, strings), "100%");
});

test("a wait is shown in the coarsest unit that still says something", () => {
  assert.equal(formatWait(47 * 60_000, strings), "47 мин");
  assert.equal(formatWait(3 * 3_600_000, strings), "3 ч");
  assert.equal(formatWait(3 * 86_400_000, strings), "3 д");
  assert.equal(formatWait(10_000, strings), "1 мин");
});

test("the pill reads the fuller window: the time until it resets, then how full it is", () => {
  // The week at 62% is fuller than the 5 hours at 18%, and resets in 36 hours.
  assert.equal(pillFigure(account(), now, strings), "2д 62%");
  assert.equal(pillPercent(account()), 62);
  const busy = account({ fiveHour: { utilization: 70, resetsAt: later(120) } });
  assert.equal(pillFigure(busy, now, strings), "2ч 70%");
  assert.equal(pillPercent(busy), 70);
});

test("the pill's wait is in days from 24 hours, in hours below that, in minutes under an hour", () => {
  const weekIn = (minutes: number) =>
    pillFigure(account({ fiveHour: null, sevenDay: { utilization: 62, resetsAt: later(minutes) } }), now, strings);
  assert.equal(weekIn(77 * 60), "3д 62%");
  assert.equal(weekIn(24 * 60), "1д 62%");
  // Rounded to the hour first, so half an hour short of a day already reads as one.
  assert.equal(weekIn(23 * 60 + 30), "1д 62%");
  assert.equal(weekIn(23 * 60), "23ч 62%");
  assert.equal(weekIn(90), "2ч 62%");
  assert.equal(weekIn(47), "47мин 62%");
  // Minutes round up: a reset 46.5 minutes away is a 47-minute wait.
  assert.equal(weekIn(46.5), "47мин 62%");
  assert.equal(pillFigure(account({ fiveHour: null, sevenDay: { utilization: 62.6, resetsAt: "" } }), now, strings), "63%");
});

test("equal windows read the one that resets later", () => {
  const even = account({
    fiveHour: { utilization: 40, resetsAt: later(60) },
    sevenDay: { utilization: 40, resetsAt: later(77 * 60) },
  });
  assert.equal(pillFigure(even, now, strings), "3д 40%");
});

test("an exhausted window fills the ring and shows the wait, whatever the other window", () => {
  const fiveGone = account({ fiveHour: { utilization: 100, resetsAt: later(47) } });
  assert.equal(pillFigure(fiveGone, now, strings), "47мин 100%");
  assert.equal(pillPercent(fiveGone), 100);
  const weekGone = account({ sevenDay: { utilization: 100, resetsAt: later(47) } });
  assert.equal(pillFigure(weekGone, now, strings), "47мин 100%");
  assert.equal(pillPercent(weekGone), 100);
});

test("a window with no reset time shows only how full it is, never a roomy other window", () => {
  const weekGone = account({ sevenDay: { utilization: 100, resetsAt: "" } });
  assert.equal(pillPercent(weekGone), 100);
  assert.equal(pillFigure(weekGone, now, strings), "100%");
  const fiveGone = account({ fiveHour: { utilization: 99.7, resetsAt: "" } });
  assert.equal(pillPercent(fiveGone), 100);
  assert.equal(pillFigure(fiveGone, now, strings), "100%");
  assert.equal(pillFigure(account({ fiveHour: null, sevenDay: { utilization: 62, resetsAt: "" } }), now, strings), "62%");
});

test("the pill is empty when nothing is known", () => {
  assert.equal(pillPercent(account({ fiveHour: null, sevenDay: null })), null);
  assert.equal(pillFigure(account({ fiveHour: null, sevenDay: null }), now, strings), "");
  assert.equal(pillFigure(null, now, strings), strings.pillNoAccount);
});

test("an account with one window reads that one", () => {
  const weekOnly = account({ fiveHour: null });
  assert.equal(pillPercent(weekOnly), 62);
  assert.equal(pillFigure(weekOnly, now, strings), "2д 62%");
  const spent = account({ fiveHour: null, sevenDay: { utilization: 100, resetsAt: later(47) } });
  assert.equal(pillPercent(spent), 100);
  assert.equal(pillFigure(spent, now, strings), "47мин 100%");
  assert.equal(pillFigure(account({ sevenDay: null }), now, strings), "1ч 18%");
});

test("the pill's wait is short in every language", () => {
  const busy = account({ fiveHour: { utilization: 70, resetsAt: later(120) } });
  const soon = account({ fiveHour: { utilization: 70, resetsAt: later(47) } });
  assert.equal(pillFigure(account(), now, t("en")), "2d 62%");
  assert.equal(pillFigure(busy, now, t("en")), "2h 70%");
  assert.equal(pillFigure(soon, now, t("en")), "47min 70%");
  assert.equal(pillFigure(account(), now, t("uk")), "2д 62%");
  assert.equal(pillFigure(busy, now, t("uk")), "2год 70%");
  assert.equal(pillFigure(soon, now, t("uk")), "47хв 70%");
});

test("a row's usage line names the provider and the state", () => {
  assert.equal(usageLine(account(), now, strings), `Claude · ${strings.fiveHourUsage} 18% · ${strings.resetIn} 1 ч`);
  assert.equal(
    usageLine(account({ fiveHour: { utilization: 100, resetsAt: "2026-09-16T12:47:00Z" } }), now, strings),
    `Claude · ${strings.limitExhausted} · ${strings.resetIn} 47 мин`,
  );
  assert.equal(usageLine(account({ loggedIn: false }), now, strings), `Claude · ${strings.notLoggedIn}`);
});

test("the week has its own line with its reset, and none when there is nothing to show", () => {
  assert.equal(weekLine(account(), now, strings), `${strings.sevenDayUsage} 62% · ${strings.resetIn} 36 ч`);
  assert.equal(weekLine(account({ sevenDay: { utilization: 62, resetsAt: "" } }), now, strings), `${strings.sevenDayUsage} 62%`);
  assert.equal(weekLine(account({ sevenDay: null }), now, strings), "");
  assert.equal(weekLine(account({ loggedIn: false }), now, strings), "");
});

test("an account with no 5-hour window has one line, with the week and its reset", () => {
  const weekOnly = account({ fiveHour: null });
  assert.equal(usageLine(weekOnly, now, strings), `Claude · ${strings.sevenDayUsage} 62% · ${strings.resetIn} 36 ч`);
  assert.equal(weekLine(weekOnly, now, strings), "");
  const spent = account({ fiveHour: null, sevenDay: { utilization: 100, resetsAt: "2026-09-16T12:47:00Z" } });
  assert.equal(usageLine(spent, now, strings), `Claude · ${strings.limitExhausted} · ${strings.resetIn} 47 мин`);
  assert.equal(weekLine(spent, now, strings), "");
});

test("a spare is another logged-in account with room left", () => {
  const state = (accounts: PillAccount[]): PillState => ({ currentId: "x", tightest: 100, accounts, error: "", overridingVar: "" });
  assert.equal(hasSpare(state([account({ current: true }), account({ loggedIn: true })])), true);
  assert.equal(hasSpare(state([account({ current: true }), account({ loggedIn: false })])), false);
  assert.equal(
    hasSpare(state([account({ current: true }), account({ fiveHour: { utilization: 95, resetsAt: "" } })])),
    false,
  );
});
