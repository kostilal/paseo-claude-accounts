import type { Account } from "../shared/registry.ts";
import { bounded } from "./bounded.ts";
import { type LimitsView, type UsageInfo, viewLimits } from "./limits.ts";
import type { UsageResult } from "./usage.ts";

/** The part of the usage cache (server/usage.ts) these reads need. */
export interface LimitsUsage {
  cached(dir: string): UsageResult | null;
  stale(dir: string, force?: boolean): boolean;
  measure(dir: string, defaultDir: string, manual: boolean): Promise<UsageResult>;
  info(dir: string): UsageInfo | null;
}

export interface ChatLimitsDeps {
  usage: LimitsUsage;
  defaultDir(): string;
  /** Other registered directories logged in to the same account (same email and organisation). */
  siblings(account: Account): Promise<Account[]>;
  /** How long one reading, and the look at other directories, may take before the answer is
   *  given with what there is. A plugin call is abandoned at 30 s. */
  readMs?: number;
  now?(): number;
  /** How long a reading stands, from the auto-refresh setting; ten minutes when absent. */
  freshForMs?(): number;
}

/** How many other directories are tried when the account's own cannot answer. */
const SIBLINGS_TRIED = 2;

const usable = (reading: UsageResult | null) => reading !== null && (reading.state === "ok" || reading.state === "none");

/**
 * The allowance of the account a chat runs on, as the listener reads it. The account's own
 * directory is read first: its login is the one the chat bills. When that login cannot answer
 * (expired, never allowed), another directory logged in to the same account may, since the
 * allowance belongs to the account and not to the directory; the numbers then carry that
 * reading's own age. A reading is measured only when the cached one is due, and never with a
 * Keychain dialog that nobody is there to answer.
 */
export function createChatLimits(deps: ChatLimitsDeps) {
  const readMs = deps.readMs ?? 9_000;
  const view = (reading: { result: UsageResult | null; info: UsageInfo | null }) =>
    viewLimits(reading.result, reading.info, (deps.now ?? Date.now)(), deps.freshForMs?.());

  async function read(home: string, force: boolean) {
    const cached = deps.usage.cached(home);
    const result =
      cached !== null && !deps.usage.stale(home, force)
        ? cached
        : await bounded(deps.usage.measure(home, deps.defaultDir(), false), readMs, cached);
    return { result, info: deps.usage.info(home) };
  }

  return async function limitsOf(account: Account, force: boolean): Promise<LimitsView> {
    const own = await read(account.home, force);
    if (usable(own.result)) return view(own);
    const best = await bounded(
      (async () => {
        for (const sibling of (await deps.siblings(account)).slice(0, SIBLINGS_TRIED)) {
          const next = await read(sibling.home, force);
          if (usable(next.result)) return next;
        }
        return own;
      })(),
      readMs,
      own,
    );
    return view(best);
  };
}
