import type { UsageState } from "../shared/accounts.ts";
import type { Strings } from "../shared/i18n.ts";
import type { Bar } from "../shared/parse.ts";
import type { UsageResult } from "./usage.ts";

/** How long a usage reading stands before it is measured again, and so how long the numbers
 *  may be called current. */
export const FRESH_FOR_MS = 10 * 60 * 1000;

/** When a reading was taken, and until when it is held through a rate limit. */
export interface UsageInfo {
  /** When the numbers were measured, ms since the epoch. Kept through a 429, which answers with
   *  the old numbers: they keep their own age. */
  measuredAt: number;
  /** While the usage endpoint rate-limits, when it may be asked again; null otherwise. */
  heldUntil: number | null;
}

/** One window as a listener hears it. */
export interface WindowView {
  /** Percent used, 0 to 100. */
  utilization: number;
  /** Percent left, 0 to 100. */
  left: number;
  resetsAt: string;
  /** Seconds until the window resets; 0 once it has; null when the endpoint gave no time. */
  resetsInSeconds: number | null;
  resetsIn: string;
}

/** What `usage` says when nothing was measured at all: a reading is never invented as zero. */
export type LimitsUsage = UsageState | "not-measured";

export interface LimitsView {
  usage: LimitsUsage;
  fiveHour: WindowView | null;
  sevenDay: WindowView | null;
  /** When the numbers were measured, ISO; empty when nothing was. */
  usageAt: string;
  usageAgeSeconds: number | null;
  /** The numbers are old, held through a rate limit, or belong to a window that has reset. */
  usageStale: boolean;
  /** Seconds the endpoint keeps answering with these old numbers; 0 when it does not. */
  usageHeldSeconds: number;
  usageError: string;
}

/** A duration the way a person says it: "under a minute", "59 min", "2 h 10 min", "2 d 17 h". */
export function humanDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return "under a minute";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`;
}

/** One line of what an account has used. An account with only a week names only the week: a
 *  "5 hours –" there would read as a figure not read yet, not as a window it does not have. */
export function usedSummary(fiveHour: Bar | null, sevenDay: Bar | null, strings: Strings): string {
  const used = (bar: Bar | null) => (bar === null ? "–" : `${Math.round(bar.utilization)}%`);
  const week = `${strings.sevenDayUsage} ${used(sevenDay)}`;
  return fiveHour === null && sevenDay !== null ? week : `${strings.fiveHourUsage} ${used(fiveHour)} · ${week}`;
}

function windowView(bar: Bar | null, now: number): WindowView | null {
  if (bar === null) return null;
  const resetAt = Date.parse(bar.resetsAt);
  const known = !Number.isNaN(resetAt);
  const seconds = known ? Math.max(0, Math.floor((resetAt - now) / 1000)) : null;
  return {
    utilization: bar.utilization,
    left: Math.min(100, Math.max(0, 100 - bar.utilization)),
    resetsAt: bar.resetsAt,
    resetsInSeconds: seconds,
    resetsIn: seconds === null ? "" : seconds === 0 ? "already passed" : humanDuration(seconds),
  };
}

/**
 * One account's allowance as the listener reads it: percent used and left, when each window
 * resets, and how old the numbers are. `reading` is null when nothing was measured, which is not
 * the same as a measured zero.
 */
export function viewLimits(reading: UsageResult | null, info: UsageInfo | null, now: number = Date.now()): LimitsView {
  if (reading === null) {
    return {
      usage: "not-measured",
      fiveHour: null,
      sevenDay: null,
      usageAt: "",
      usageAgeSeconds: null,
      usageStale: false,
      usageHeldSeconds: 0,
      usageError: "",
    };
  }
  const fiveHour = windowView(reading.fiveHour, now);
  const sevenDay = windowView(reading.sevenDay, now);
  const held = info?.heldUntil != null && info.heldUntil > now ? Math.ceil((info.heldUntil - now) / 1000) : 0;
  const hasNumbers = fiveHour !== null || sevenDay !== null;
  // A window that has reset no longer has the percentage it was measured with.
  const reset = [fiveHour, sevenDay].some((window) => window !== null && window.resetsInSeconds === 0);
  const old = info === null || now - info.measuredAt > FRESH_FOR_MS;
  return {
    usage: reading.state,
    fiveHour,
    sevenDay,
    usageAt: info === null ? "" : new Date(info.measuredAt).toISOString(),
    usageAgeSeconds: info === null ? null : Math.max(0, Math.floor((now - info.measuredAt) / 1000)),
    usageStale: hasNumbers && (old || held > 0 || reset),
    usageHeldSeconds: held,
    usageError: reading.error,
  };
}
