import { canonical } from "../shared/path.ts";
import type { Identity } from "../shared/parse.ts";
import { PROVIDERS, isProviderId } from "../shared/providers.ts";
import { type Account, type Registry, accountById } from "../shared/registry.ts";
import type { ChatAccountAnswer } from "./capabilities.ts";
import { type LimitsView, viewLimits } from "./limits.ts";
import { type CliProvider, type SessionDir, liveLoginDir } from "./sessionDir.ts";
import type { OpenRecord } from "./sessionLedger.ts";

/** One chat as the account questions need it. */
export interface ChatFacts {
  id: string;
  provider: string;
  cwd: string;
  title: string;
  /** The chat's project, or its working directory's name when it has none. */
  project: string;
  status: string;
  /** A turn is in progress, so a restart would cut it off. */
  busy: boolean;
  archived: boolean;
  /** The provider session Paseo has recorded, or null before the chat ever started. */
  sessionId: string | null;
  createdAt: string | null;
}

/** What Paseo answers about one agent; `paseo.agents.ref(id).refresh()` fits it. */
export interface ChatLookup {
  agent: {
    id: string;
    provider: string;
    cwd: string;
    title: string | null;
    status: string;
    createdAt?: string;
    archivedAt?: string | null;
    activeTurn?: unknown;
    persistence?: { sessionId?: string | null } | null;
  };
  project: { projectName: string } | null;
}

/**
 * The chat with exactly this id. Paseo also answers for a unique prefix of an id or for a title,
 * but a binding is keyed by the full id and the session-open hook looks a chat up by it, so
 * anything else would report success and leave the chat on its account.
 */
export function toChatFacts(found: ChatLookup | null, agentId: string): ChatFacts | null {
  if (found === null || found.agent.id !== agentId) return null;
  const { agent, project } = found;
  return {
    id: agent.id,
    provider: agent.provider,
    cwd: agent.cwd,
    title: agent.title ?? "",
    project: project?.projectName || agent.cwd.slice(agent.cwd.lastIndexOf("/") + 1),
    status: agent.status,
    busy: agent.status === "running" || agent.status === "initializing" || (agent.activeTurn !== undefined && agent.activeTurn !== null),
    archived: Boolean(agent.archivedAt),
    sessionId: agent.persistence?.sessionId ?? null,
    createdAt: agent.createdAt ?? null,
  };
}

/**
 * The same, with the chat's provider told by `family`. A profile's chat runs the same CLI on the
 * same accounts as the provider it extends, so every account question treats it as that
 * provider's own: resolving it, moving it, guarding its first turn.
 */
export async function chatFactsOf(
  found: ChatLookup | null,
  agentId: string,
  family: (provider: string) => Promise<string>,
): Promise<ChatFacts | null> {
  const chat = toChatFacts(found, agentId);
  return chat === null ? null : { ...chat, provider: await family(chat.provider) };
}

/** What the chat is doing, as a listener hears it. */
export function turnOf(chat: ChatFacts): "running" | "idle" | "closed" {
  if (chat.busy) return "running";
  return chat.status === "closed" ? "closed" : "idle";
}

export const NO_SUCH_CHAT = "no chat has exactly this id; use the chat's full id";

export interface Resolved {
  /** What `account` rests on; see the `accounts.chat` contract. */
  basis: ChatAccountAnswer["basis"];
  /** The account the chat runs on, or null when that cannot be told. */
  account: Account | null;
  /** The account id on record for the chat; "" when there is none. */
  bound: string;
  /** Where the sources disagree, or why nothing could be told. */
  note: string;
}

export interface ResolveDeps {
  readRegistry(): Promise<Registry>;
  /** The chat's CLI process as it is now (see server/sessionDir.ts). */
  live(agentId: string, provider: CliProvider): Promise<SessionDir>;
  /** What the hook did the last time it opened the chat's session. */
  ledger(agentId: string): OpenRecord | undefined;
  defaultDir(): string;
}

/**
 * Which account a chat really runs on, from the strongest evidence there is, and never a guess:
 *
 * 1. its running CLI process, whose environment names the login it uses;
 * 2. the hook's record of how its session was last opened (there is no process yet right after a
 *    restart, since Claude Code starts with the chat's next turn);
 * 3. the account on record for it, which is where its next start will land.
 *
 * Where these differ, the stronger one wins and the note says so. An unbound chat with none of
 * them has no account: the provider's default is for new chats and is never put in its place.
 */
export async function resolveChatAccount(chat: ChatFacts, deps: ResolveDeps): Promise<Resolved> {
  const registry = await deps.readRegistry();
  const bound = registry.agents[chat.id] ?? "";
  const provider = chat.provider;
  if (!isProviderId(provider) || !PROVIDERS[provider].supported) {
    return { basis: "none", account: null, bound, note: `the plugin does not manage ${provider} chats` };
  }

  const defaultDir = deps.defaultDir();
  const accountAt = (dir: string) =>
    registry.accounts.find((account) => account.provider === provider && canonical(account.home) === canonical(dir)) ?? null;
  const dirOfInjected = (injected: string) => (injected === "" ? defaultDir : injected);
  const notes: string[] = [];

  const live = await deps.live(chat.id, provider);
  const record = deps.ledger(chat.id);

  if (live.found) {
    const dir = liveLoginDir(live, provider, defaultDir);
    const account = accountAt(dir);
    if (account === null) {
      notes.push(`the running process uses ${dir}, which is not in the account list`);
    } else if (bound === "") {
      notes.push(`the chat is not bound to an account; its running process uses ${account.id}`);
    } else if (bound !== account.id) {
      notes.push(`the binding says ${bound}, but the running process uses ${account.id}`);
    }
    if (live.ambiguous === true) notes.push("several processes of this chat disagree; the newest is shown");
    if (record?.injected !== undefined && canonical(dirOfInjected(record.injected)) !== canonical(dir)) {
      const given = accountAt(dirOfInjected(record.injected));
      notes.push(`the last time its session opened it was given ${given?.id ?? dirOfInjected(record.injected)}`);
    }
    return { basis: "process", account, bound, note: notes.join("; ") };
  }

  if (record !== undefined) {
    if (record.injected === undefined) {
      const said = bound === "" ? "" : ` (the binding says ${bound})`;
      return {
        basis: "none",
        account: null,
        bound,
        note: `the plugin left the session alone when it last opened${said}, so it runs on its own folder's login, which cannot be told without a running process`,
      };
    }
    const dir = dirOfInjected(record.injected);
    const account = accountAt(dir);
    if (account === null) notes.push(`the session was opened on ${dir}, which is not in the account list`);
    else if (bound === "") notes.push(`the chat is not bound now, but its session was opened on ${account.id}`);
    else if (bound !== account.id) notes.push(`the binding says ${bound}, but the session was opened on ${account.id}`);
    return { basis: "session", account, bound, note: notes.join("; ") };
  }

  if (bound !== "") {
    const account = accountById(registry, bound);
    if (account === null) {
      return { basis: "none", account: null, bound, note: `the binding names ${bound}, which is no longer in the account list` };
    }
    if (account.provider !== provider) {
      return { basis: "none", account: null, bound, note: `the binding names ${account.id}, an account of another provider, which the hook ignores` };
    }
    return { basis: "binding", account, bound, note: `no session of this chat is running; it will open on ${account.id}` };
  }

  return {
    basis: "none",
    account: null,
    bound,
    note: "the chat is not bound to an account and no session of it is running, so its account cannot be told",
  };
}

export interface ChatAccountDeps extends ResolveDeps {
  /** The chat with exactly this id, or null. */
  chat(agentId: string): Promise<ChatFacts | null>;
  /** Whose login the account holds; null when that could not be read in time. */
  identity(account: Account): Promise<Identity | null>;
  /** The account's allowance. `force` measures it now instead of taking the cache. */
  limits(account: Account, force: boolean): Promise<LimitsView>;
}

/** The answer when there is nothing to say about the account: every field present, none invented. */
function blank(overrides: Partial<ChatAccountAnswer>): ChatAccountAnswer {
  return {
    title: "",
    project: "",
    turn: "",
    archived: false,
    provider: "",
    account: "",
    accountName: "",
    bound: "",
    email: "",
    orgName: "",
    subscriptionType: "",
    basis: "none",
    note: "",
    ...viewLimits(null, null),
    error: "",
    ...overrides,
  };
}

/**
 * The account one chat runs on and what is left of its allowance. Only that account is measured:
 * a chat whose account cannot be told gets no numbers, rather than someone else's.
 */
export async function readChatAccount(input: { agentId: string; force: boolean }, deps: ChatAccountDeps): Promise<ChatAccountAnswer> {
  const chat = await deps.chat(input.agentId);
  if (chat === null) return blank({ error: NO_SUCH_CHAT });

  const resolved = await resolveChatAccount(chat, deps);
  const facts = {
    title: chat.title,
    project: chat.project,
    turn: turnOf(chat),
    archived: chat.archived,
    provider: chat.provider,
    bound: resolved.bound,
    basis: resolved.basis,
    note: resolved.note,
  };
  const { account } = resolved;
  if (account === null) return blank(facts);

  const who = await deps.identity(account);
  const named = {
    ...facts,
    account: account.id,
    accountName: account.label,
    email: who?.email ?? "",
    orgName: who?.orgName ?? "",
    subscriptionType: who?.subscriptionType ?? "",
  };
  if (!PROVIDERS[account.provider].meterable) return blank({ ...named, usage: "unsupported" });
  if (who !== null && !who.loggedIn) {
    return blank({ ...named, usage: "unauthorised", usageError: "nobody is logged in to this account's directory" });
  }
  return { ...named, ...(await deps.limits(account, input.force)), error: "" };
}
