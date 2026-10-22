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

/** Milliseconds until the earliest exhausted window resets, or null when nothing is
 *  exhausted. A reset already in the past returns 0. */
export function exhaustedResetIn(fiveHour: Window | null, sevenDay: Window | null, now: number): number | null {
  const waits = [fiveHour, sevenDay]
    .filter((bar): bar is Window => bar !== null && bar.utilization >= EXHAUSTED_AT)
    .map((bar) => Date.parse(bar.resetsAt))
    .filter((at) => Number.isFinite(at))
    .map((at) => Math.max(0, at - now));
  return waits.length === 0 ? null : Math.min(...waits);
}

/** The coarsest useful unit. Rounds up to at least one minute, since a reset seconds away
 *  is still a wait. */
export function formatWait(ms: number, strings: Strings): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} ${strings.unitMin}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${strings.unitHour}`;
  return `${Math.round(hours / 24)} ${strings.unitDay}`;
}

/**
 * What the pill's ring fills to: the 5-hour window, the one that moves while you work. The
 * week has its own line in the list; a ring stuck at the week's 82% says nothing about the
 * next hour. Once either window is exhausted the ring is full, because the account is
 * unusable whichever one ran out. Null when the 5-hour window is unknown.
 */
export function pillPercent(current: PillAccount): number | null {
  // Utilization itself, not exhaustedResetIn: that one skips a window whose reset time is
  // unknown, and an exhausted week without one would read as a roomy 5 hours.
  const exhausted = [current.fiveHour, current.sevenDay].some((bar) => bar !== null && bar.utilization >= EXHAUSTED_AT);
  if (exhausted) return 100;
  return current.fiveHour?.utilization ?? null;
}

/** The figure beside the pill's ring: the 5-hour window as a percentage, the time until
 *  reset once either window is exhausted, or "" when usage is unknown (never a reassuring
 *  0%). */
export function pillFigure(current: PillAccount | null, now: number, strings: Strings): string {
  if (current === null) return strings.pillNoAccount;
  const wait = exhaustedResetIn(current.fiveHour, current.sevenDay, now);
  if (wait !== null) return formatWait(wait, strings);
  const percent = pillPercent(current);
  return percent === null ? "" : `${Math.round(percent)}%`;
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
 *  has its own line, `weekLine`. */
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
  return parts.join(" · ");
}

/** The third line of an account row, e.g. "Week 62% · resets in 5 d", or "" when there is
 *  no weekly figure to show. */
export function weekLine(account: PillAccount, now: number, strings: Strings): string {
  if (!account.loggedIn || account.usage === "unsupported" || account.sevenDay === null) return "";
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
