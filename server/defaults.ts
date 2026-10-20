import type { DefaultOption, DefaultProblem } from "../shared/defaults.ts";
import { type ProviderId, isProviderId } from "../shared/providers.ts";
import { AUTO, type Account, type Registry, accountById } from "../shared/registry.ts";

export interface DefaultDeps {
  directoryExists(path: string): Promise<boolean>;
}

export type DefaultCheck =
  | { state: "unset" }
  /** Pick by allowance as each chat opens; see shared/auto.ts. */
  | { state: "auto" }
  | { state: "ok"; account: Account }
  | { state: "broken"; problem: Exclude<DefaultProblem, "">; id: string; label: string };

/**
 * Whether the provider's default account can open a chat right now. An account is a config
 * directory; it is usable while that directory exists, and its own login (read fresh when the
 * session opens) decides what the chat runs on.
 */
export async function checkDefault(registry: Registry, provider: string, deps: DefaultDeps): Promise<DefaultCheck> {
  const id = registry.defaults?.[provider];
  if (id === undefined || id === "") return { state: "unset" };
  if (id === AUTO) return { state: "auto" };
  const account = accountById(registry, id);
  if (account === null || account.provider !== provider) return { state: "broken", problem: "unknown-account", id, label: id };
  if (!(await deps.directoryExists(account.home))) {
    return { state: "broken", problem: "missing-directory", id, label: account.label };
  }
  return { state: "ok", account };
}

/** The accounts the settings offer as a default: every account of the provider. */
export function defaultOptions(registry: Registry, provider: string): DefaultOption[] {
  if (!isProviderId(provider)) return [];
  return registry.accounts
    .filter((account) => account.provider === (provider as ProviderId))
    .map((account) => ({ id: account.id, label: account.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
