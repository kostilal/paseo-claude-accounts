import { createHash } from "node:crypto";
import type { DefaultOption, DefaultProblem } from "../shared/defaults.ts";
import { PROVIDERS, type ProviderId, isProviderId } from "../shared/providers.ts";
import { type Account, type Registry, accountById, tokenKey } from "../shared/registry.ts";

export interface DefaultDeps {
  /** The token filed under a Keychain account (`tokenKey`), or null. */
  readMintedToken(login: string): Promise<string | null>;
  /** Anthropic's answer to the token; see `tokenStatus` in mint.ts. */
  checkToken(token: string): Promise<"ok" | "rejected" | "unknown">;
  directoryExists(path: string): Promise<boolean>;
}

export type DefaultCheck =
  | { state: "unset" }
  | { state: "ok"; account: Account; token: string | null }
  | { state: "broken"; problem: Exclude<DefaultProblem, "">; id: string; label: string };

/**
 * Whether the provider's default account can open a chat right now. A token the network
 * could not confirm counts as usable: only a definite 401 calls it broken, so an outage
 * never blocks every new chat. The token is returned for the caller to inject and is never
 * logged.
 */
export async function checkDefault(registry: Registry, provider: string, deps: DefaultDeps): Promise<DefaultCheck> {
  const id = registry.defaults?.[provider];
  if (id === undefined || id === "") return { state: "unset" };
  const account = accountById(registry, id);
  if (account === null || account.provider !== provider) return { state: "broken", problem: "unknown-account", id, label: id };
  const problem = (p: Exclude<DefaultProblem, "">) => ({ state: "broken" as const, problem: p, id, label: account.label });
  const mechanism = PROVIDERS[account.provider].switch;
  if (mechanism.kind === "home") {
    return (await deps.directoryExists(account.home)) ? { state: "ok", account, token: null } : problem("missing-directory");
  }
  const key = tokenKey(account);
  if (key === null) return problem("no-token");
  const token = await deps.readMintedToken(key);
  if (token === null) return problem("no-token");
  if ((await deps.checkToken(token)) === "rejected") return problem("token-rejected");
  return { state: "ok", account, token };
}

/** The accounts the settings offer as a default: the provider's own, and for a token switch
 *  only those with a switching key recorded (the Keychain is read when one is chosen). */
export function defaultOptions(registry: Registry, provider: string): DefaultOption[] {
  if (!isProviderId(provider)) return [];
  const tokenSwitch = PROVIDERS[provider as ProviderId].switch.kind === "token";
  return registry.accounts
    .filter((account) => account.provider === provider && (!tokenSwitch || tokenKey(account) !== null))
    .map((account) => ({ id: account.id, label: account.label, login: account.tokenLogin ?? "" }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Caches a positive token check, so opening chats in a row asks Anthropic once. A rejected
 * or unknown answer is asked again next time: the user may have just renewed the key.
 */
export function cachedTokenCheck(
  check: (token: string) => Promise<"ok" | "rejected" | "unknown">,
  ttlMs = 10 * 60_000,
  now: () => number = Date.now,
): (token: string) => Promise<"ok" | "rejected" | "unknown"> {
  // Keyed on a digest, so the cache holds no token.
  const okAt = new Map<string, number>();
  const digest = (token: string) => createHash("sha256").update(token).digest("hex");
  return async (token) => {
    const key = digest(token);
    const at = okAt.get(key);
    if (at !== undefined && now() - at < ttlMs) return "ok";
    const answer = await check(token);
    if (answer === "ok") okAt.set(key, now());
    else okAt.delete(key);
    return answer;
  };
}
