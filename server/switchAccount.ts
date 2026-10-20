import type { Identity } from "../shared/parse.ts";
import { PROVIDERS, type ProviderSpec } from "../shared/providers.ts";
import { type Account, type Registry, accountById, applyBinding } from "../shared/registry.ts";
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
  /** Who the target directory is logged in as: a switch binds the session to that directory,
   *  so a logged-out one is refused up front rather than opening an empty session. */
  identify(home: string): Promise<Identity>;
  reload(agentId: string): Promise<{ code: ReloadCode; error: string }>;
  /** Whether restarting this chat now would lose it (see server/transcript.ts). Absent: never. */
  unsaved?(agentId: string): Promise<boolean>;
}

/** The account a switch would land on, or why the session-open hook could not act on it.
 *  Only reads, so a refusal leaves everything as it was. */
export async function switchTarget(
  registry: Registry,
  accountId: string,
  deps: Pick<SwitchDeps, "exists" | "identify">,
): Promise<{ target: Account } | { code: Exclude<SwitchCode, ""> }> {
  const target = accountById(registry, accountId);
  if (target === null) return { code: "unknown-account" };
  // Defensive: a hand-edited state file must be refused, not throw.
  const spec = PROVIDERS[target.provider] as ProviderSpec | undefined;
  if (spec === undefined || !spec.supported) return { code: "unsupported-provider" };
  if (!(await deps.exists(target.home))) return { code: "missing-directory" };
  if (!(await deps.identify(target.home)).loggedIn) return { code: "not-logged-in" };
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
  if (await deps.unsaved?.(input.agentId)) return { code: "first-turn", error: "" };

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
