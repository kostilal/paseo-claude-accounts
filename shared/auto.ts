import type { Bar } from "./parse.ts";
import type { Account } from "./registry.ts";

/** A window at or above this share of its allowance is full: an automatic pick passes the
 *  account over while another one has room. */
export const FULL_AT = 95;

/** A window at or above this share is nearly full: the chat still opens on the account, and the
 *  pill says so, so the person can decide whether to move it. */
export const WARN_AT = 90;

/** One account an automatic pick may choose, with what is known of its allowance. */
export interface Candidate {
  account: Account;
  /** False when the allowance could not be read in time (or the provider has no meter). */
  known: boolean;
  fiveHour: Bar | null;
  sevenDay: Bar | null;
}

/** When a window resets, in ms since the epoch; a missing or unreadable time sorts last. */
function resetAt(window: Bar | null): number {
  if (window === null) return Number.POSITIVE_INFINITY;
  const at = Date.parse(window.resetsAt);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

function isFull(window: Bar | null): boolean {
  return window !== null && window.utilization >= FULL_AT;
}

/** When a full account has room again: the latest reset among its full windows. */
function freeAt(candidate: Candidate): number {
  const full = [candidate.fiveHour, candidate.sevenDay].filter(isFull);
  return Math.max(...full.map(resetAt));
}

const byId = (a: Candidate, b: Candidate) => a.account.id.localeCompare(b.account.id);

/**
 * The account a new chat should open on, or null when there is none to choose from.
 *
 * Accounts with room in both windows (and a five-hour window under `WARN_AT`) come first, and
 * among them the one whose weekly allowance resets soonest: what is left of it is lost at the
 * reset, while the others keep theirs. Equal resets go to the emptier five-hour window. Accounts
 * whose allowance could not be read come next, then accounts whose five-hour window is nearly
 * spent (the emptiest first), then full ones, the one that has room again soonest first. A full account is still
 * chosen when nothing else is left: the chat opens and waits for its reset, rather than not
 * opening at all.
 *
 * Deterministic for the same readings, so chats started together land on one account.
 */
export function pickAuto(candidates: readonly Candidate[]): Account | null {
  const open = candidates.filter((c) => c.known && !isFull(c.fiveHour) && !isFull(c.sevenDay));
  // A nearly spent five-hour window would stop the chat (and the workspace it pins) within
  // minutes, whatever its week; it waits behind every account with real room.
  const roomy = open.filter((c) => !nearlyFull(c.fiveHour));
  if (roomy.length > 0) {
    const sorted = [...roomy].sort(
      (a, b) =>
        resetAt(a.sevenDay) - resetAt(b.sevenDay) ||
        (a.fiveHour?.utilization ?? 0) - (b.fiveHour?.utilization ?? 0) ||
        byId(a, b),
    );
    return sorted[0]!.account;
  }
  const unknown = candidates.filter((c) => !c.known);
  if (unknown.length > 0) return [...unknown].sort(byId)[0]!.account;
  if (open.length > 0) {
    const sorted = [...open].sort(
      (a, b) => (a.fiveHour?.utilization ?? 0) - (b.fiveHour?.utilization ?? 0) || byId(a, b),
    );
    return sorted[0]!.account;
  }
  const full = [...candidates].sort((a, b) => freeAt(a) - freeAt(b) || byId(a, b));
  return full[0]?.account ?? null;
}

/** Whether a window is close enough to its allowance that the pill should warn. */
export function nearlyFull(window: Bar | null): boolean {
  return window !== null && window.utilization >= WARN_AT;
}
