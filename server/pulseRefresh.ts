import type { AccountView } from "../shared/accounts.ts";
import { accountById, type Registry } from "../shared/registry.ts";
import { chooseUsageHome } from "./groupLogins.ts";
import { usageForLogin, usageOrder } from "./groupUsage.ts";
import type { UsageReader } from "./overview.ts";
import { loginId, shownInPulse } from "./pulse.ts";
import type { UsageResult } from "./usage.ts";

export interface PulseRefreshDeps {
  /** The rows Pulse shows (the last overview) and the registry, for each login's directories. */
  rows(): Promise<{ rows: readonly AccountView[]; registry: Registry }>;
  usage: Pick<UsageReader, "authorised" | "stale" | "cached" | "measure" | "info">;
  defaultDir(): string;
  /** The auto-refresh interval from the settings (`refreshMinutes`), in ms. */
  intervalMs(): number;
  now?(): number;
  log?(line: string): void;
}

const usable = (result: UsageResult) => result.state === "ok" || result.state === "none";

/**
 * Keeps the usage Pulse shows fresh while nothing else asks for it: with no Paseo window on the
 * pill or the Accounts screen, nothing measures, and Pulse would grey the numbers out. Each read
 * of the snapshot calls `kick()`, which starts, in the background, the same per-login read the
 * Accounts screen polls with (server/overview.ts): `usageForLogin` over the login's directories,
 * each measured only when its cached reading is due (`usage.stale`, which keeps the interval and
 * a 429's wait) through `usage.measure`, which joins a reading already under way.
 *
 * A login is left alone while a rate limit holds any of its directories, while a refresh of it
 * runs, and within the interval of the last refresh started here, whatever came of it: an expired
 * token stands only 25 s in the usage cache, and Pulse polls far more often than the interval.
 * Only `authorised` directories are read, the check every background read makes (server/usage.ts):
 * with no window open, a Keychain prompt must never come from here.
 */
export function createPulseRefresh(deps: PulseRefreshDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.error(line));
  /** Logins (by login key) with a refresh under way. */
  const running = new Set<string>();
  /** When a refresh of each login was last started here. */
  const attempted = new Map<string, number>();

  /** What the auto-refresh path does with one directory: the cached reading, or a new one when due. */
  const read = (home: string): Promise<UsageResult> => {
    const cached = deps.usage.cached(home);
    return cached === null || deps.usage.stale(home) ? deps.usage.measure(home, deps.defaultDir(), false) : Promise.resolve(cached);
  };

  /** Whether `usageForLogin` would measure anything: it stops at the first usable reading. */
  function due(homes: readonly string[]): boolean {
    for (const home of homes) {
      const cached = deps.usage.cached(home);
      if (cached === null || deps.usage.stale(home)) return true;
      if (usable(cached)) return false;
    }
    return false;
  }

  /** Starts the refreshes that are due and resolves once they are started, never with their
   *  result and never with an error. */
  async function kick(): Promise<void> {
    let source: Awaited<ReturnType<PulseRefreshDeps["rows"]>>;
    try {
      source = await deps.rows();
    } catch {
      return;
    }
    // No await from here on: concurrent kicks see each other's marks.
    const at = now();
    const homeOf = (id: string) => accountById(source.registry, id)?.home ?? null;
    for (const row of source.rows.filter(shownInPulse)) {
      try {
        if (running.has(row.key) || at - (attempted.get(row.key) ?? -Infinity) < deps.intervalMs()) continue;
        const homes = usageOrder(row, homeOf, chooseUsageHome(row, homeOf, deps.usage.authorised)).filter((home) => deps.usage.authorised(home));
        if (homes.length === 0) continue;
        if (homes.some((home) => (deps.usage.info(home)?.heldUntil ?? -Infinity) > at)) continue;
        if (!due(homes)) continue;
        running.add(row.key);
        attempted.set(row.key, at);
        const id = loginId(row.key);
        log(`accounts: a Pulse read refreshes the usage of login ${id}`);
        void usageForLogin(homes, read)
          .catch((error: unknown) => log(`accounts: the Pulse refresh of login ${id} failed: ${error instanceof Error ? error.message : String(error)}`))
          .finally(() => running.delete(row.key));
      } catch (error) {
        // One login's trouble never stops the others, nor reaches the snapshot.
        log(`accounts: a Pulse refresh could not start: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { kick };
}
