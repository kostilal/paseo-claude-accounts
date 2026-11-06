import type { Strings } from "../shared/i18n.ts";
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
