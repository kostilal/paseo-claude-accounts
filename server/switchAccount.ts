import type { Identity } from "../shared/parse.ts";
import { PROVIDERS, type ProviderSpec } from "../shared/providers.ts";
import { type Account, type Registry, accountById, applyBinding, tokenKey } from "../shared/registry.ts";
import type { SwitchCode } from "../shared/switch.ts";
import type { ReloadCode } from "./reload.ts";

export interface SwitchInput {
  agentId: string;
  accountId: string;
}

export interface SwitchDeps {
  readRegistry(): Promise<Registry>;
  writeRegistry(value: Registry): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** The same read the session-open hook makes, done first so a switch the hook would
   *  silently ignore is refused up front. Only presence is used; the value is dropped.
   *  A rejection (e.g. `KeychainTimeout`) propagates before anything is written. */
  readMintedToken(login: string): Promise<string | null>;
  /** Who the target directory is logged in as. Only the home mechanism asks. */
  identify(home: string): Promise<Identity>;
  reload(agentId: string): Promise<{ code: ReloadCode; error: string }>;
}

/** The account a switch would land on, or why the session-open hook could not act on it.
 *  Only reads, so a refusal leaves everything as it was. */
export async function switchTarget(
  registry: Registry,
  accountId: string,
  deps: Pick<SwitchDeps, "exists" | "identify" | "readMintedToken">,
): Promise<{ target: Account } | { code: Exclude<SwitchCode, ""> }> {
  const target = accountById(registry, accountId);
  if (target === null) return { code: "unknown-account" };
  // Defensive: a hand-edited state file must be refused, not throw.
  const spec = PROVIDERS[target.provider] as ProviderSpec | undefined;
  if (spec === undefined || !spec.supported) return { code: "unsupported-provider" };
  if (!(await deps.exists(target.home))) return { code: "missing-directory" };

  if (spec.switch.kind === "home") {
    if (!(await deps.identify(target.home)).loggedIn) return { code: "not-logged-in" };
  } else {
    // Without a token the hook injects nothing and the session would reopen on the old
    // account while the pill claimed the new one.
    const key = tokenKey(target);
    if (key === null) return { code: "no-token" };
    if ((await deps.readMintedToken(key)) === null) return { code: "no-token" };
  }
  return { target };
}

/** Move one agent (this chat only) onto another account. The order is the error handling:
 *  refuse anything that cannot work before writing, then write the binding, then restart
 *  the session. Any failure leaves the previous state in place. Other chats, even in the
 *  same project, keep their accounts. */
export async function switchAccount(
  input: SwitchInput,
  deps: SwitchDeps,
): Promise<{ code: SwitchCode; error: string }> {
  const registry = await deps.readRegistry();
  const checked = await switchTarget(registry, input.accountId, deps);
  if ("code" in checked) return { code: checked.code, error: "" };

  // No "already on that account" short-circuit: the binding saying so does not prove the
  // session runs on it, so a retry must always reload.

  await deps.writeRegistry(applyBinding(registry, { agentId: input.agentId, account: checked.target.id }));

  const reloaded = await deps.reload(input.agentId);
  if (reloaded.code !== "") {
    // The session never restarted, so roll the binding back or the pill would show an
    // account the chat is not on. Best-effort: the reload's error is the one to report.
    await deps.writeRegistry(registry).catch(() => {});
    return { code: reloaded.code, error: reloaded.error };
  }

  return { code: "" as const, error: "" };
}
