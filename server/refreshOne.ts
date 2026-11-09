import type { RefreshAccountAnswer } from "../shared/accounts.ts";
import { USAGE_NOT_IN_TIME } from "../shared/i18n.ts";
import type { Account } from "../shared/registry.ts";
import { bounded } from "./bounded.ts";
import type { LimitsUsage } from "./chatLimits.ts";
import type { UsageResult } from "./usage.ts";

export interface RefreshOneDeps {
  usage: LimitsUsage & { authorised(dir: string): boolean };
  defaultDir(): string;
  /** The registered account a row's `switchTo` names, or null. */
  account(id: string): Promise<Account | null>;
  /** Other registered directories logged in to the same account (same email and organisation). */
  siblings(account: Account): Promise<Account[]>;
  /** How long the whole call may take. A plugin call is abandoned at 30 s. */
  readMs?: number;
  now?(): number;
}

const READ_MS = 25_000;

const usable = (reading: UsageResult) => reading.state === "ok" || reading.state === "none";

const nothing = { fiveHour: null, sevenDay: null, measuredAt: null, heldUntil: null };

/**
 * One account measured because a person pressed Refresh: the directory the chat runs on, and
 * when that one cannot answer another directory logged in to the same account, as the allowance
 * belongs to the account. The endpoint answers rapid calls with a 429 and a long wait, so a reading
 * still inside the floor or a 429's hold is given back rather than asked for again.
 */
export function createRefreshOne(deps: RefreshOneDeps) {
  const readMs = deps.readMs ?? READ_MS;

  async function read(home: string) {
    const measuredBefore = deps.usage.info(home)?.measuredAt ?? null;
    const cached = deps.usage.cached(home);
    // `unauthorised`: a background read gave up on a Keychain dialog, which a press can answer.
    const due = cached === null || cached.state === "unauthorised" || deps.usage.stale(home, true);
    const result = due ? await deps.usage.measure(home, deps.defaultDir(), true) : cached;
    return { home, measuredBefore, result };
  }

  type Reading = Awaited<ReturnType<typeof read>>;

  function answer(reading: Reading): RefreshAccountAnswer {
    const info = deps.usage.info(reading.home);
    const measuredAt = info?.measuredAt ?? null;
    const heldUntil = info?.heldUntil ?? null;
    const advanced = measuredAt !== null && (reading.measuredBefore === null || measuredAt > reading.measuredBefore);
    const fresh = advanced ? "updated" : heldUntil !== null && heldUntil > (deps.now ?? Date.now)() ? "held" : "recent";
    return {
      outcome: usable(reading.result) ? fresh : "failed",
      usage: reading.result.state,
      fiveHour: reading.result.fiveHour,
      sevenDay: reading.result.sevenDay,
      measuredAt,
      heldUntil,
      error: reading.result.error,
      code: "",
    };
  }

  async function refresh(id: string): Promise<RefreshAccountAnswer> {
    const account = await deps.account(id);
    if (account === null) return { outcome: "failed", usage: "error", ...nothing, error: "", code: "unknown-account" };
    const members = [account, ...(await deps.siblings(account))];
    // The directory the row reads its numbers from (chooseUsageHome), or the press would measure
    // one and leave the row showing another: the first by id allowed the Keychain, else this one.
    const shown = [...members].sort((a, b) => (a.id < b.id ? -1 : 1)).find((member) => deps.usage.authorised(member.home)) ?? account;
    const first = await read(shown.home);
    if (usable(first.result)) return answer(first);
    for (const member of members.filter((item) => item !== shown)) {
      const next = await read(member.home);
      if (usable(next.result)) return answer(next);
    }
    return answer(first);
  }

  const ranOut: RefreshAccountAnswer = { outcome: "failed", usage: "error", ...nothing, error: USAGE_NOT_IN_TIME, code: "" };

  return (id: string): Promise<RefreshAccountAnswer> => bounded(refresh(id), readMs, ranOut);
}
