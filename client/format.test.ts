import { test } from "node:test";
import assert from "node:assert/strict";
import { t } from "../shared/i18n.ts";
import type { PillAccount, PillState } from "../shared/switch.ts";
import { exhaustedResetIn, formatReset, formatWait, hasSpare, pillFigure, pillLabel, pillPercent, pillTag, planName, refreshNotice, rowAgeText, savedAtText, shortLogins, tightestOf, updatedAgoText, usageLine, weekLine } from "./format.ts";

const strings = t("ru");
const now = Date.parse("2026-09-16T12:00:00Z");
/** A reset time this many minutes after `now`. */
const later = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

function account(over: Partial<PillAccount> = {}): PillAccount {
  return {
    usageAt: null,
    heldUntil: null,
    label: "work",
    provider: "claude",
    home: "/w/work",
    key: "k",
    email: "alice@example.com",
    orgName: "",
    plan: "max",
    tier: "",
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

// --- what the popover's Refresh says -------------------------------------------------------

const en = t("en");
const answered = (over: Partial<Parameters<typeof refreshNotice>[0]>): Parameters<typeof refreshNotice>[0] => ({
  outcome: "updated",
  usage: "ok",
  fiveHour: { utilization: 18.4, resetsAt: later(120) },
  sevenDay: { utilization: 62, resetsAt: later(2880) },
  measuredAt: now,
  heldUntil: null,
  error: "",
  code: "",
  ...over,
});

test("an updated or recent reading adds nothing: the row's corner says when it was measured", () => {
  assert.equal(refreshNotice(answered({}), now, en), null);
  assert.equal(refreshNotice(answered({ outcome: "recent", measuredAt: now - 20_000 }), now, en), null);
});

test("a row's corner says how long ago it was measured", () => {
  assert.equal(updatedAgoText(now - 3_000, now, en), "just now");
  assert.equal(updatedAgoText(now - 26_000, now, en), "26 s ago");
  assert.equal(updatedAgoText(now - 3 * 60_000, now, en), "3 min ago");
  assert.equal(updatedAgoText(now - 61_000, now, en), "1 min ago");
  assert.equal(updatedAgoText(now - 2 * 3_600_000, now, en), "2 h ago");
  assert.equal(updatedAgoText(now - 3 * 60_000, now, t("ru")), "3 мин назад");
});

test("while the usage service makes a row wait, its corner says for how long instead", () => {
  const measured = now - 3 * 60_000;
  assert.equal(rowAgeText(measured, now + 15 * 60_000, now, en), "paused 15 min");
  assert.equal(rowAgeText(measured, now + 15 * 60_000, now, t("ru")), "пауза 15 мин");
  assert.equal(rowAgeText(measured, now - 1, now, en), "3 min ago");
  assert.equal(rowAgeText(measured, null, now, en), "3 min ago");
});

test("two logins in one line lose their domains, unless that is all that tells them apart", () => {
  assert.deepEqual(shortLogins("devxypro@gmail.com", "sapfotanya@gmail.com"), ["devxypro", "sapfotanya"]);
  assert.deepEqual(shortLogins("kain@evodev.pro", "kain@gmail.com"), ["kain@evodev.pro", "kain@gmail.com"]);
  assert.deepEqual(shortLogins("account-1", "me@example.com"), ["account-1", "me"]);
});

test("two titles that start with whose they are keep just that, when it tells them apart", () => {
  assert.deepEqual(shortLogins("Личный · me@example.com", "Acme LLC · me@example.com"), ["Личный", "Acme LLC"]);
  // One owner for both: the addresses tell them apart.
  assert.deepEqual(shortLogins("Личный · devxypro@gmail.com", "Личный · sapfotanya@gmail.com"), ["devxypro", "sapfotanya"]);
  assert.deepEqual(shortLogins("Acme · kain@evodev.pro", "kain@gmail.com"), ["Acme · kain@evodev.pro", "kain@gmail.com"]);
  // Different owners on different addresses: the owners still say it shortest.
  assert.deepEqual(shortLogins("Личный · me@example.com", "Evodev · kain@evodev.pro"), ["Личный", "Evodev"]);
});

test("numbers held through a rate limit say how long the wait is", () => {
  const notice = refreshNotice(answered({ outcome: "held", heldUntil: now + 25 * 60_000 }), now, en)!;
  assert.equal(notice.text, "The usage service asked to wait 25 min");
  assert.equal(notice.tone, "warn");
});

test("a plan with no windows says so instead of an empty figure", () => {
  assert.equal(refreshNotice(answered({ usage: "none", fiveHour: null, sevenDay: null }), now, en)!.text, en.noUsageAllowance);
});

test("a failure says why", () => {
  assert.equal(refreshNotice(answered({ outcome: "failed", code: "unknown-account" }), now, en)!.text, en.usageUnknownAccount);
  assert.equal(refreshNotice(answered({ outcome: "failed", usage: "expired" }), now, en)!.text, en.usageExpired);
  assert.equal(refreshNotice(answered({ outcome: "failed", usage: "error", error: "boom" }), now, en)!.text, `${en.usageReadFailed} boom`);
  assert.equal(refreshNotice(answered({ outcome: "failed", usage: "unauthorised" }), now, en)!.text, en.usageReadFailed);
  assert.equal(refreshNotice(answered({ outcome: "failed", usage: "expired" }), now, en)!.tone, "bad");
});

test("saved data shows the time alone today and the date on another day", () => {
  const today = savedAtText(now - 60_000, now, "en");
  const earlier = savedAtText(now - 3 * 24 * 60 * 60_000, now, "en");
  assert.notEqual(today, "");
  assert.ok(earlier.length > today.length, `${earlier} should carry a date beyond ${today}`);
});

test("a plan reads by its name, and a Max plan by its multiple too", () => {
  assert.equal(planName("max", "default_claude_max_20x"), "Max 20x");
  assert.equal(planName("max", ""), "Max");
  assert.equal(planName("pro", ""), "Pro");
  assert.equal(planName("", "default_claude_max_5x"), "");
});

test("a Team seat is Team, though its tier names a Max multiple", () => {
  assert.equal(planName("team", "default_claude_max_5x"), "Team");
});

/** One address logged in twice: the person's own plan and a company seat. */
function twins(currentKey: "own" | "work"): PillState {
  const email = "me@example.com";
  return {
    currentId: currentKey,
    tightest: null,
    error: "",
    overridingVar: "",
    accounts: [
      account({ key: "own", email, orgName: `${email}'s Organization`, plan: "max", current: currentKey === "own" }),
      account({ key: "work", email, orgName: "Acme LLC", plan: "team", current: currentKey === "work" }),
    ],
  };
}

test("the pill names the account when another login has the same address", () => {
  assert.equal(pillTag(twins("own"), strings), strings.personalAccount);
  assert.equal(pillTag(twins("work"), strings), "Acme");
});

test("a login of another provider on the same address is no twin: the pill cannot switch to it", () => {
  const state = twins("work");
  const codex: PillState = { ...state, accounts: [{ ...state.accounts[0]!, provider: "codex", orgName: "Personal" }, state.accounts[1]!] };
  assert.equal(pillTag(codex, strings), "");
});

test("the pill leaves a company's legal form off its name", () => {
  const named = (orgName: string) => {
    const state = twins("work");
    return pillTag({ ...state, accounts: [state.accounts[0]!, { ...state.accounts[1]!, orgName }] }, strings);
  };
  assert.equal(named("UAPROM LLC"), "UAPROM");
  assert.equal(named("Acme, Inc."), "Acme");
  assert.equal(named("ТОВ «Юапром»"), "Юапром");
  assert.equal(named("Smith & Co."), "Smith");
  // Nothing but a legal form is still a name.
  assert.equal(named("LLC"), "LLC");
});

test("the pill names nothing when the address alone tells the accounts apart", () => {
  const state = twins("own");
  const unique: PillState = { ...state, accounts: [state.accounts[0]!, account({ key: "kain", email: "kain@example.com", orgName: "Evodev" })] };
  assert.equal(pillTag(unique, strings), "");
});

test("a twin that is not logged in does not count, and neither does a chat on no account", () => {
  const state = twins("own");
  const loggedOut: PillState = { ...state, accounts: [state.accounts[0]!, { ...state.accounts[1]!, loggedIn: false }] };
  assert.equal(pillTag(loggedOut, strings), "");
  const none: PillState = { ...state, accounts: state.accounts.map((row) => ({ ...row, current: false })) };
  assert.equal(pillTag(none, strings), "");
});

test("addresses that differ only in case are the same address", () => {
  const state = twins("work");
  const shouted: PillState = { ...state, accounts: [{ ...state.accounts[0]!, email: "ME@example.com" }, state.accounts[1]!] };
  assert.equal(pillTag(shouted, strings), "Acme");
});

test("a long organisation is cut short, so the pill still fits a phone", () => {
  const state = twins("work");
  const long: PillState = { ...state, accounts: [state.accounts[0]!, { ...state.accounts[1]!, orgName: "International Widget Holdings LLC" }] };
  const tag = pillTag(long, strings);
  assert.ok(tag.endsWith("…"));
  assert.ok([...tag].length <= 12, tag);
  assert.ok("International Widget Holdings LLC".startsWith(tag.slice(0, -1)));
});

test("twins with no org to tell them apart are named by their plans", () => {
  const state = twins("work");
  const blank: PillState = { ...state, accounts: state.accounts.map((row) => ({ ...row, orgName: "" })) };
  assert.equal(pillTag(blank, strings), "Team");
});

test("the pill's label puts the figure first, where the host's cut cannot reach it, and keeps a placeholder for an unread one", () => {
  assert.equal(pillLabel("", "2ч 23%", strings), "2ч 23%");
  assert.equal(pillLabel("Acme", "2ч 23%", strings), "2ч 23% · Acme");
  assert.equal(pillLabel("", "", strings), strings.pillUnread);
  assert.equal(pillLabel("Acme", "", strings), `${strings.pillUnread} · Acme`);
});

test("formatReset counts days and hours from a day on", () => {
  const hour = 3_600_000;
  assert.equal(formatReset(47 * 60_000, strings), "47 мин");
  assert.equal(formatReset(5 * hour, strings), "5 ч");
  assert.equal(formatReset(23 * hour + 29 * 60_000, strings), "23 ч");
  assert.equal(formatReset(23 * hour + 40 * 60_000, strings), "1 д");
  assert.equal(formatReset(24 * hour, strings), "1 д");
  assert.equal(formatReset(36 * hour, strings), "1 д 12 ч");
  assert.equal(formatReset(77 * hour, strings), "3 д 5 ч");
  assert.equal(formatReset(71 * hour + 40 * 60_000, strings), "3 д");
  assert.equal(formatReset(86 * hour + 20 * 60_000, strings), "3 д 14 ч");
  assert.equal(formatReset(47 * hour + 50 * 60_000, strings), "2 д");
  assert.equal(formatReset(77 * hour, t("en")), "3 d 5 h");
});
