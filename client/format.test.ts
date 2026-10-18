import { test } from "node:test";
import assert from "node:assert/strict";
import { t } from "../shared/i18n.ts";
import type { PillAccount, PillState } from "../shared/switch.ts";
import { exhaustedResetIn, formatWait, hasSpare, pillFigure, tightestOf, usageLine, weekLine } from "./format.ts";

const strings = t("ru");
const now = Date.parse("2026-09-16T12:00:00Z");

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

test("a wait is shown in the coarsest unit that still says something", () => {
  assert.equal(formatWait(47 * 60_000, strings), "47 мин");
  assert.equal(formatWait(3 * 3_600_000, strings), "3 ч");
  assert.equal(formatWait(3 * 86_400_000, strings), "3 д");
  assert.equal(formatWait(10_000, strings), "1 мин");
});

test("the pill figure is a percentage until the wall, then the wait, and a dash when unread", () => {
  assert.equal(pillFigure(account(), now, strings), "62%");
  assert.equal(
    pillFigure(account({ fiveHour: { utilization: 100, resetsAt: "2026-09-16T12:47:00Z" } }), now, strings),
    "47 мин",
  );
  assert.equal(pillFigure(account({ fiveHour: null, sevenDay: null }), now, strings), "");
  assert.equal(pillFigure(null, now, strings), strings.pillNoAccount);
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

test("a spare is another logged-in account with room left", () => {
  const state = (accounts: PillAccount[]): PillState => ({ currentId: "x", tightest: 100, accounts, error: "", overridingVar: "" });
  assert.equal(hasSpare(state([account({ current: true }), account({ loggedIn: true })])), true);
  assert.equal(hasSpare(state([account({ current: true }), account({ loggedIn: false })])), false);
  assert.equal(
    hasSpare(state([account({ current: true }), account({ fiveHour: { utilization: 95, resetsAt: "" } })])),
    false,
  );
});
