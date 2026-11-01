import type { Identity } from "../shared/parse.ts";
import { PROVIDERS, type ProviderSpec } from "../shared/providers.ts";
import { type Account, type Registry, accountById } from "../shared/registry.ts";
import type { SwitchCode } from "../shared/switch.ts";
import type { MoveCheckAnswer } from "./capabilities.ts";
import { type ChatFacts, NO_SUCH_CHAT, type Resolved, turnOf } from "./chatAccount.ts";

export interface MoveInput {
  agentId: string;
  accountId: string;
}

export interface MoveDeps {
  readRegistry(): Promise<Registry>;
  /** The chat with exactly this id, or null. Absent: only the account is checked. */
  chat?(agentId: string): Promise<ChatFacts | null>;
  exists(path: string): Promise<boolean>;
  /** Who the target directory is logged in as: a switch binds the session to that directory,
   *  so a logged-out one is refused up front rather than opening an empty session. */
  identify(home: string): Promise<Identity>;
  /** Whether restarting this chat now would lose it (see server/transcript.ts). Absent: never. */
  unsaved?(agentId: string, chat: ChatFacts | null): Promise<boolean>;
}

/**
 * The providers whose chats can be moved one at a time. A Codex session keeps its history in the
 * folder it runs in (`CODEX_HOME` is its login and its state at once), so pointing one chat at
 * another account's folder leaves its conversation behind.
 */
const SINGLE_SWITCH: ReadonlySet<string> = new Set(["claude"]);

/** The account a switch would land on, or why the session-open hook could not act on it.
 *  Only reads, so a refusal leaves everything as it was. */
export async function switchTarget(
  registry: Registry,
  accountId: string,
  deps: Pick<MoveDeps, "exists" | "identify">,
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

export type MoveVerdict =
  | { ok: true; target: Account; chat: ChatFacts | null }
  | { ok: false; code: Exclude<SwitchCode, "">; target: Account | null; chat: ChatFacts | null };

/**
 * Whether one chat can be moved to one account, in the order the cheap and fundamental reasons
 * come first: the chat exists, is not archived and is of a provider that can move alone; the
 * account exists and is of the chat's provider; its folder is there and logged in; and the chat's
 * first turn is saved. Reads only. The dry run and the switch itself share it, so what one
 * promises the other does.
 */
export async function checkMove(input: MoveInput, deps: MoveDeps): Promise<MoveVerdict> {
  const chat = deps.chat === undefined ? null : await deps.chat(input.agentId);
  const refuse = (code: Exclude<SwitchCode, "">, target: Account | null = null): MoveVerdict => ({ ok: false, code, target, chat });
  if (deps.chat !== undefined) {
    if (chat === null) return refuse("unknown-chat");
    if (chat.archived) return refuse("archived");
    if (!SINGLE_SWITCH.has(chat.provider)) return refuse("unsupported-provider");
  }

  const registry = await deps.readRegistry();
  const wanted = accountById(registry, input.accountId);
  if (wanted === null) return refuse("unknown-account");
  if (chat !== null && chat.provider !== wanted.provider) return refuse("provider-mismatch", wanted);

  const checked = await switchTarget(registry, input.accountId, deps);
  if ("code" in checked) return refuse(checked.code, wanted);
  if (await deps.unsaved?.(input.agentId, chat)) return refuse("first-turn", wanted);
  return { ok: true, target: checked.target, chat };
}

export interface MoveReadDeps extends MoveDeps {
  /** The account the chat runs on now (see server/chatAccount.ts). */
  current(chat: ChatFacts): Promise<Resolved>;
  /** Whose login an account holds; null when that could not be read in time. */
  identity(account: Account): Promise<Identity | null>;
}

const providerName = (provider: string) => (provider === "claude" ? "Claude" : provider === "codex" ? "Codex" : provider);

/** Why a move cannot happen, in a sentence a listener can be told. */
function explain(code: Exclude<SwitchCode, "">, chat: ChatFacts | null, target: Account | null, asked: string): string {
  switch (code) {
    case "unknown-chat":
      return NO_SUCH_CHAT;
    case "archived":
      return "the chat is archived; restarting it would bring it back from the archive";
    case "unsupported-provider":
      return chat !== null && chat.provider === "codex"
        ? "a Codex chat keeps its history in its account's folder, so one chat cannot be moved without losing it"
        : `the plugin cannot move a single ${chat === null ? "" : `${providerName(chat.provider)} `}chat to another account`;
    case "unknown-account":
      return `no account has the id ${asked}; use switchTo of a row in accounts`;
    case "provider-mismatch":
      return `the chat runs on ${providerName(chat?.provider ?? "")}, but ${target?.id ?? asked} is a ${providerName(target?.provider ?? "")} account`;
    case "missing-directory":
      return `the folder of ${target?.id ?? asked} is gone`;
    case "not-logged-in":
      return `nobody is logged in to ${target?.id ?? asked}`;
    case "first-turn":
      return "the chat's first turn is not saved yet; wait for its first reply";
    default:
      return code;
  }
}

/** The dry run God Mode reads before it asks: the chat, where it is, where it would go, and why
 *  it cannot. Every field is a string, shown or not, so a confirmation is never left without one. */
export async function readMoveCheck(input: MoveInput, deps: MoveReadDeps): Promise<MoveCheckAnswer> {
  const verdict = await checkMove(input, deps);
  const chat = verdict.chat;
  const target = verdict.target ?? accountById(await deps.readRegistry(), input.accountId);
  const named = async (account: Account) => {
    const who = await deps.identity(account).catch(() => null);
    return who !== null && who.email !== "" ? `${account.id} (${who.email})` : account.id;
  };
  const now = chat === null ? null : (await deps.current(chat)).account;
  return {
    title: chat?.title ?? "",
    project: chat?.project ?? "",
    turn: chat === null ? "" : turnOf(chat),
    current: now === null ? "unknown" : await named(now),
    to: target === null ? input.accountId : await named(target),
    code: verdict.ok ? "" : verdict.code,
    error: verdict.ok ? "" : explain(verdict.code, chat, target, input.accountId),
  };
}
