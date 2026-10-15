import type { UsageResult } from "./usage.ts";

/** One login's usage, read off whichever of its directories can still answer. Each directory
 *  keeps its own credential and an idle one may have expired, while the allowance is shared,
 *  so members are tried in order and the first real reading wins. `read` is expected to be
 *  cached, so trying another member costs one bounded Keychain read per freshness window. */
export async function usageForLogin(
  homes: readonly string[],
  read: (home: string) => Promise<UsageResult>,
): Promise<UsageResult> {
  let fallback: UsageResult | null = null;
  for (const home of homes) {
    const result = await read(home);
    if (result.state === "ok" || result.state === "none") return result;
    if (fallback === null || rank(result) > rank(fallback)) fallback = result;
  }
  return fallback ?? { state: "unauthorised", fiveHour: null, sevenDay: null, error: "" };
}

/** Ranks non-answers. An expired token says something about one stale directory, not the
 *  login, so it ranks last; an error beats "nothing read". */
function rank(result: UsageResult): number {
  return result.state === "error" ? 2 : result.state === "expired" ? 0 : 1;
}

/** The order to try: the preferred directory first, then the rest of the login sorted. */
export function usageOrder(
  group: { accountIds: readonly string[]; switchTo: string },
  homeOf: (accountId: string) => string | null,
  preferred: string | null,
): string[] {
  const homes = [...group.accountIds]
    .sort()
    .map((id) => homeOf(id))
    .filter((home): home is string => home !== null);
  if (preferred !== null && homes.includes(preferred)) return [preferred, ...homes.filter((home) => home !== preferred)];
  return homes;
}
