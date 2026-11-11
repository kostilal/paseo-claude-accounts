import type { RefreshAccountAnswer } from "../shared/accounts.ts";
import { type Strings, usageErrorText } from "../shared/i18n.ts";
import { loginOwner } from "../shared/identity.ts";
import type { PillAccount, PillState } from "../shared/switch.ts";

/** Same shape as `Bar` in shared/accounts.ts, redeclared so the pill does not import Zod. */
export interface Window {
  utilization: number;
  resetsAt: string;
}

/** Utilization (0–100) at or above which an allowance counts as exhausted. */
export const EXHAUSTED_AT = 99.5;

/** The higher of the two windows (0–100), or null when neither is known. */
export function tightestOf(fiveHour: Window | null, sevenDay: Window | null): number | null {
  const values = [fiveHour?.utilization, sevenDay?.utilization].filter(
    (value): value is number => typeof value === "number",
  );
  return values.length === 0 ? null : Math.max(...values);
}

/** Milliseconds until an exhausted account can be used again: the latest reset among its
 *  exhausted windows. Null when nothing is exhausted, or when an exhausted window has no readable
 *  reset time, so no wait can be promised. A reset already in the past returns 0. */
export function exhaustedResetIn(fiveHour: Window | null, sevenDay: Window | null, now: number): number | null {
  const resets = [fiveHour, sevenDay]
    .filter((bar): bar is Window => bar !== null && bar.utilization >= EXHAUSTED_AT)
    .map((bar) => Date.parse(bar.resetsAt));
  if (resets.length === 0 || resets.some((at) => !Number.isFinite(at))) return null;
  return Math.max(0, Math.max(...resets) - now);
}

/** The coarsest useful unit, counting in hours while the wait, rounded to the hour, is below
 *  `daysFrom` hours. Rounds up to at least one minute, since a reset seconds away is still a
 *  wait. */
function waitParts(ms: number, daysFrom: number, strings: Strings): [number, string] {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return [minutes, strings.unitMin];
  const hours = Math.round(minutes / 60);
  if (hours < daysFrom) return [hours, strings.unitHour];
  return [Math.round(hours / 24), strings.unitDay];
}

/** A wait in a line of text: "47 мин", "36 ч", "3 д". */
export function formatWait(ms: number, strings: Strings): string {
  const [count, unit] = waitParts(ms, 48, strings);
  return `${count} ${unit}`;
}

/** When a card's window resets: days and hours from a day on ("3 д 5 ч", "1 д 12 ч", "3 д"),
 *  as `formatWait` below that ("5 ч", "47 мин"). Hours are rounded, so 23 h 40 min reads "1 д". */
export function formatReset(ms: number, strings: Strings): string {
  const hours = Math.round(Math.max(1, Math.ceil(ms / 60_000)) / 60);
  if (hours < 24) return formatWait(ms, strings);
  const days = `${Math.floor(hours / 24)} ${strings.unitDay}`;
  return hours % 24 === 0 ? days : `${days} ${hours % 24} ${strings.unitHour}`;
}

/** A wait on the pill, which has room for one short figure: "47мин", "5ч", "3д". */
function shortWait(ms: number, strings: Strings): string {
  const [count, unit] = waitParts(ms, 24, strings);
  return `${count}${unit}`;
}

/** How full a window is, 0–100, and 100 once it is exhausted. */
function fullness(bar: Window): number {
  return bar.utilization >= EXHAUSTED_AT ? 100 : bar.utilization;
}

/** When a window resets, in epoch milliseconds; Infinity when its reset time cannot be read. */
function resetTime(bar: Window): number {
  const at = Date.parse(bar.resetsAt);
  return Number.isFinite(at) ? at : Infinity;
}

/**
 * The window the pill reads: the fuller of the two, as on the popover's rows, or the only one
 * (the usage endpoint sends only the week for a plan with no 5-hour window). A tie, most often
 * both windows exhausted, goes to the window that resets later: that is when the account can be
 * used again. A reset time that cannot be read counts as the later one, so no wait is promised
 * that might not hold. Null when neither window is known.
 */
function pillWindow({ fiveHour, sevenDay }: PillAccount): Window | null {
  if (fiveHour === null || sevenDay === null) return fiveHour ?? sevenDay;
  if (fullness(fiveHour) !== fullness(sevenDay)) return fullness(fiveHour) > fullness(sevenDay) ? fiveHour : sevenDay;
  return resetTime(fiveHour) > resetTime(sevenDay) ? fiveHour : sevenDay;
}

/** What the pill's ring fills to: the window it reads, and full once that one is exhausted. */
export function pillPercent(current: PillAccount): number | null {
  const window = pillWindow(current);
  return window === null ? null : fullness(window);
}

/** The figure beside the pill's ring: the time until the window it reads resets, then how full
 *  that window is ("3д 62%", "40мин 70%"); only the percentage when the reset time cannot be
 *  read; or "" when usage is unknown (never a reassuring 0%). */
export function pillFigure(current: PillAccount | null, now: number, strings: Strings): string {
  if (current === null) return strings.pillNoAccount;
  const window = pillWindow(current);
  if (window === null) return "";
  const usage = `${Math.round(fullness(window))}%`;
  const at = resetTime(window);
  return at === Infinity ? usage : `${shortWait(Math.max(0, at - now), strings)} ${usage}`;
}

/** The longest name the pill gives an account, in characters: the pill has to fit a phone. */
const PILL_TAG_MAX = 12;

/** A company's legal form, which says nothing about whose an account is and takes room the pill
 *  has not got: "Acme LLC" and "ТОВ «Acme»" are both "Acme" there. */
const LEGAL_FORM = /^(?:ТОВ|ООО|ПП)\s+|[\s,]+(?:LLC|L\.L\.C\.|Inc\.?|Ltd\.?|Limited|GmbH|LLP|Corp\.?|Co\.)$/giu;

function withoutLegalForm(org: string): string {
  const bare = org.replace(LEGAL_FORM, "").replace(/[\s,&]+$/u, "").replace(/^[«"“](.+)[»"”]$/u, "$1").trim();
  return bare === "" ? org : bare;
}

/** A plan as it is sold: "Max 20x", "Team", "Pro". Only Max carries its multiple: a Team seat's
 *  tier names a Max multiple too, and "Team 5x" reads as a plan nobody bought. The multiple is
 *  read as `planMultiple` in shared/forecast.ts reads it, so this module stays clear of Zod, as
 *  `Window` above does. "" when the plan is unknown. */
export function planName(plan: string, tier: string): string {
  if (plan === "") return "";
  const name = plan.charAt(0).toUpperCase() + plan.slice(1);
  const multiple = plan === "max" ? /_(\d+)x\b/.exec(tier)?.[1] : undefined;
  return multiple === undefined ? name : `${name} ${multiple}x`;
}

/** The pill's name for the chat's account, given only when the figure alone cannot say which
 *  account that is: another logged-in account of the same provider has the same address. The
 *  owner without its legal form, or the plan when the owner is unknown; cut short for the pill.
 *  "" when no name is needed. */
export function pillTag(state: PillState, strings: Strings): string {
  const current = currentOf(state);
  if (current === null || !current.loggedIn || current.email === "") return "";
  const address = current.email.toLowerCase();
  const twin = state.accounts.some(
    (row) => row.loggedIn && row.provider === current.provider && row.key !== current.key && row.email.toLowerCase() === address,
  );
  if (!twin) return "";
  const owner = loginOwner(current, strings.personalAccount);
  const name = [...(owner !== "" ? withoutLegalForm(owner) : planName(current.plan, current.tier))];
  return name.length <= PILL_TAG_MAX ? name.join("") : `${name.slice(0, PILL_TAG_MAX - 1).join("").trimEnd()}…`;
}

/** The pill's text: the figure, then the account's name when it has one. The figure goes first
 *  because the host cuts a long label at its end. The host refuses an empty label, so an unread
 *  figure keeps a placeholder. */
export function pillLabel(tag: string, figure: string, strings: Strings): string {
  const shown = figure === "" ? strings.pillUnread : figure;
  return tag === "" ? shown : `${shown} · ${tag}`;
}

export function providerName(provider: string): string {
  return provider === "codex" ? "Codex" : provider === "claude" ? "Claude" : provider;
}

/** "<label> <percent>% · resets in <wait>"; the wait is left out when the reset time is unknown. */
export function windowText(label: string, bar: Window, now: number, strings: Strings): string {
  const usage = `${label} ${Math.round(bar.utilization)}%`;
  const at = Date.parse(bar.resetsAt);
  return Number.isFinite(at) ? `${usage} · ${strings.resetIn} ${formatWait(Math.max(0, at - now), strings)}` : usage;
}

/** The second line of an account row, e.g. "Claude · 5 hours 18% · resets in 3 h". The week
 *  has its own line, `weekLine`, unless it is the account's only window: then it stands here. */
export function usageLine(account: PillAccount, now: number, strings: Strings): string {
  const parts = [providerName(account.provider)];
  if (!account.loggedIn) {
    parts.push(strings.notLoggedIn);
    return parts.join(" · ");
  }
  // Said plainly so it does not read as a meter still loading; the provider has no usage endpoint.
  if (account.usage === "unsupported") {
    parts.push(strings.usageUnsupported);
    return parts.join(" · ");
  }
  const wait = exhaustedResetIn(account.fiveHour, account.sevenDay, now);
  if (wait !== null) {
    parts.push(strings.limitExhausted, `${strings.resetIn} ${formatWait(wait, strings)}`);
    return parts.join(" · ");
  }
  if (account.fiveHour !== null) parts.push(windowText(strings.fiveHourUsage, account.fiveHour, now, strings));
  else if (account.sevenDay !== null) parts.push(windowText(strings.sevenDayUsage, account.sevenDay, now, strings));
  return parts.join(" · ");
}

/** The third line of an account row, e.g. "Week 62% · resets in 5 d", or "" when there is
 *  no weekly figure to show or `usageLine` already shows it. */
export function weekLine(account: PillAccount, now: number, strings: Strings): string {
  if (!account.loggedIn || account.usage === "unsupported" || account.sevenDay === null || account.fiveHour === null) return "";
  return windowText(strings.sevenDayUsage, account.sevenDay, now, strings);
}

/** Whether another account could take over now (the green dot on an exhausted pill). */
export function hasSpare(state: PillState): boolean {
  return state.accounts.some((account) => {
    if (account.current || !account.loggedIn) return false;
    const tightest = tightestOf(account.fiveHour, account.sevenDay);
    return tightest === null || tightest < 90;
  });
}

export function currentOf(state: PillState): PillAccount | null {
  return state.accounts.find((account) => account.current) ?? null;
}

/** When a row was last measured, short enough for its corner: "just now", "26 s ago", "3 min ago". */
export function updatedAgoText(at: number, now: number, strings: Strings): string {
  const ms = Math.max(0, now - at);
  if (ms < 10_000) return strings.updatedJustNow;
  // Rounded down: a wait rounds up, an age must not read older than it is.
  const seconds = Math.floor(ms / 1000);
  const ago = seconds < 60 ? `${seconds} ${strings.unitSec}` : seconds < 3600 ? `${Math.floor(seconds / 60)} ${strings.unitMin}` : formatWait(ms, strings);
  return strings.updatedAgo.replace("{ago}", ago);
}

/** What a row's corner says: how long the usage service has asked it to wait, else how old its numbers are. */
export function rowAgeText(at: number, heldUntil: number | null, now: number, strings: Strings): string {
  if (heldUntil !== null && heldUntil > now) return strings.rowPaused.replace("{wait}", formatWait(heldUntil - now, strings));
  return updatedAgoText(at, now, strings);
}

/** Two logins in the one line there is for both: whose each is, when both titles start with
 *  that (`loginName`) and it tells them apart, or else what comes before the @, if that does. */
export function shortLogins(a: string, b: string): [string, string] {
  const owner = (title: string) => (title.includes(" · ") ? title.slice(0, title.indexOf(" · ")) : "");
  const [ownerA, ownerB] = [owner(a), owner(b)];
  if (ownerA !== "" && ownerB !== "" && ownerA !== ownerB) return [ownerA, ownerB];
  const local = (title: string, owned: string) => title.slice(owned === "" ? 0 : owned.length + 3).split("@")[0]!;
  const [first, second] = [local(a, ownerA), local(b, ownerB)];
  return first === second ? [a, b] : [first, second];
}

/** What an account's row says after its refresh, when its corner's time does not say it already. */
export function refreshNotice(
  answer: RefreshAccountAnswer,
  now: number,
  strings: Strings,
): { text: string; tone: "info" | "warn" | "bad" } | null {
  if (answer.outcome === "failed") {
    if (answer.code === "unknown-account") return { text: strings.usageUnknownAccount, tone: "bad" };
    if (answer.usage === "expired") return { text: strings.usageExpired, tone: "bad" };
    return { text: answer.error === "" ? strings.usageReadFailed : `${strings.usageReadFailed} ${usageErrorText(answer.error, strings)}`, tone: "bad" };
  }
  if (answer.fiveHour === null && answer.sevenDay === null) return { text: strings.noUsageAllowance, tone: "info" };
  if (answer.outcome === "updated" || answer.outcome === "recent") return null;
  const wait = formatWait(Math.max(0, (answer.heldUntil ?? now) - now), strings);
  return { text: strings.refreshHeld.replace("{wait}", wait), tone: "warn" };
}

/** A moment in the forecast, in the reader's language: the weekday and the time. */
export function dayTimeText(at: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  } catch {
    // A runtime without Intl data.
    return new Date(at).toLocaleString();
  }
}

/** When saved data was saved, short and in the reader's language: the time alone today, with
 *  the date on another day. */
export function savedAtText(at: number, now: number, locale: string): string {
  const today = new Date(at).toDateString() === new Date(now).toDateString();
  const options: Intl.DateTimeFormatOptions = today ? { timeStyle: "short" } : { dateStyle: "short", timeStyle: "short" };
  try {
    return new Intl.DateTimeFormat(locale, options).format(at);
  } catch {
    // A runtime without Intl data.
    return new Date(at).toLocaleString();
  }
}
