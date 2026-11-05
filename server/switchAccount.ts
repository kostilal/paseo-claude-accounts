import { type Account, type Registry, applyBinding } from "../shared/registry.ts";
import type { SwitchCode } from "../shared/switch.ts";
import { bounded } from "./bounded.ts";
import type { ChatFacts } from "./chatAccount.ts";
import { type MoveDeps, checkMove, switchTarget } from "./moveCheck.ts";
import type { ReloadCode } from "./reload.ts";

// `switchAll` and the tests ask for the target through here, as they always have.
export { switchTarget };

export interface SwitchInput {
  agentId: string;
  accountId: string;
}

export interface SwitchDeps extends MoveDeps {
  writeRegistry(value: Registry): Promise<void>;
  /** Applies `change` to the registry as one step against the hook and every other writer, and
   *  returns what was written. Absent: a plain read, then write, which another writer can
   *  interleave with. */
  update?(change: (registry: Registry) => Registry): Promise<Registry>;
  reload(agentId: string): Promise<{ code: ReloadCode; error: string }>;
  /** Whether the restarted session took the account (see server/applied.ts). Absent: not claimed. */
  verify?(chat: ChatFacts | null, target: Account, since: number): Promise<{ verdict: "match" | "mismatch" | "unknown"; reason: string }>;
  now?(): number;
  /** How long to wait for the restart before answering `pending`. */
  budgetMs?: number;
}

export interface SwitchResult {
  code: SwitchCode;
  error: string;
  /** The account the chat was bound to before; "" when it had none. */
  from: string;
  /** The account it is bound to now because of this call; "" when nothing moved. */
  to: string;
  applied: "" | "verified" | "next-open" | "pending" | "unverified";
  /** A turn was in progress when the restart began and may have been cut off. */
  interrupted: boolean;
}

/** Paseo's plugin RPCs are abandoned by the caller at 30 s and the restart is stopped at 30 s,
 *  so the answer is given a little before. */
export const SWITCH_BUDGET_MS = 25_000;

/** Move one agent (this chat only) onto another account. The order is the error handling:
 *  refuse anything that cannot work before writing, then write the binding, then restart
 *  the session, then check that the session took the account. A failure puts back this chat's
 *  binding and nothing else. Other chats, even in the same project, keep their accounts. */
export async function switchAccount(input: SwitchInput, deps: SwitchDeps): Promise<SwitchResult> {
  const now = deps.now ?? Date.now;
  const from = (await deps.readRegistry()).agents[input.agentId] ?? "";
  const checked = await checkMove(input, deps);
  if (!checked.ok) return { code: checked.code, error: "", from, to: "", applied: "", interrupted: false };
  const { target, chat } = checked;
  const interrupted = chat?.busy === true;
  const since = now();

  // One step against the hook and every other writer, which bind new chats while a restart runs.
  const change = async (apply: (registry: Registry) => Registry) => {
    if (deps.update !== undefined) return deps.update(apply);
    const next = apply(await deps.readRegistry());
    await deps.writeRegistry(next);
    return next;
  };

  // No "already on that account" short-circuit: the binding saying so does not prove the
  // session runs on it, so a retry must always reload.
  let previous: string | undefined;
  await change((registry) => {
    previous = registry.agents[input.agentId];
    return applyBinding(registry, { agentId: input.agentId, account: target.id });
  });

  // Only this chat's binding, and only while it is still the one written here: somebody may have
  // moved the chat again, or bound another one, while the restart ran. Best-effort: the failure
  // that brought us here is the one to report.
  const putBack = () =>
    change((registry) =>
      registry.agents[input.agentId] === target.id
        ? applyBinding(registry, { agentId: input.agentId, account: previous ?? null })
        : registry,
    ).catch(() => {});

  // A chat that is not running has nothing to restart: the hook applies the binding when it opens.
  if (chat !== null && chat.status === "closed") {
    return { code: "", error: "", from, to: target.id, applied: "next-open", interrupted };
  }

  const restart = deps
    .reload(input.agentId)
    .catch((error: unknown) => ({ code: "reload-failed" as const, error: error instanceof Error ? error.message : String(error) }));
  const reloaded = await bounded(restart, deps.budgetMs ?? SWITCH_BUDGET_MS, "pending" as const);
  // The hook ran when the restart began, so the binding stays: if the restart finishes badly, the
  // chat closes and takes the account when it next opens.
  if (reloaded === "pending") return { code: "", error: "", from, to: target.id, applied: "pending", interrupted };

  if (reloaded.code !== "") {
    // The session never restarted, so put the binding back or the pill would show an account the
    // chat is not on.
    await putBack();
    return { code: reloaded.code, error: reloaded.error, from, to: "", applied: "", interrupted };
  }

  if (deps.verify === undefined) return { code: "", error: "", from, to: target.id, applied: "", interrupted };
  const verdict = await deps.verify(chat, target, since).catch(() => ({ verdict: "unknown" as const, reason: "" }));
  if (verdict.verdict === "mismatch") {
    await putBack();
    return { code: "not-applied", error: verdict.reason, from, to: "", applied: "", interrupted };
  }
  return { code: "", error: "", from, to: target.id, applied: verdict.verdict === "match" ? "verified" : "unverified", interrupted };
}
