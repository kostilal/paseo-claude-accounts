import type { PaseoApi } from "./paseo.ts";
import { type Registry, applyBinding } from "../shared/registry.ts";
import type { SwitchCode } from "../shared/switch.ts";
import type { ReloadCode } from "./reload.ts";
import { type SwitchDeps, switchTarget } from "./switchAccount.ts";

/** One chat as the switch-all needs it. */
export interface Chat {
  id: string;
  provider: string;
  status: string;
}

export interface SwitchAllDeps extends Pick<SwitchDeps, "readRegistry" | "writeRegistry" | "exists" | "identify" | "readMintedToken"> {
  /** Every chat that is not archived, in every workspace. */
  chats(): Promise<Chat[]>;
  reload(agentId: string): Promise<{ code: ReloadCode; error: string }>;
}

export interface SwitchAllResult {
  code: SwitchCode;
  /** Chats now bound to the account. */
  moved: number;
  /** Of those, open chats restarted on it now. Closed ones switch when they next open. */
  restarted: number;
  /** Open chats whose restart failed. Their bindings were put back. */
  failed: number;
  /** Chats in the middle of a turn, left on their account so their work is not cut off. */
  skipped: number;
  /** The first failed restart's message, or "". */
  error: string;
}

/** A chat in one of these states is working; a restart would cut its turn off. */
const BUSY = new Set(["running", "initializing"]);

/** What `paseo agent reload` says about a chat the daemon lists but has not loaded: it is
 *  not running, so like a closed chat it takes the account when it next opens. */
const NOT_LOADED = /Agent not found/;

/** Restarts run this many at a time: one by one would outlast the RPC with a few dozen
 *  open chats, all at once would start every Claude Code process together. */
const RELOAD_CONCURRENCY = 6;

/** Every chat that is not archived, page by page. */
export async function listChats(paseo: PaseoApi): Promise<Chat[]> {
  const chats: Chat[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({ filter: { includeArchived: false }, page: { limit: 100, cursor } });
    for (const { agent } of page.entries) {
      if (agent.archivedAt) continue;
      chats.push({ id: agent.id, provider: agent.provider, status: agent.status });
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return chats;
}

/**
 * Moves every chat of the account's provider onto it, in every workspace, except chats in
 * the middle of a turn: those are left alone rather than cut off. Same order as a single
 * switch: refuse before writing, write every binding at once, then restart the idle chats.
 * A closed chat (not archived, just not running) only needs its binding; the session-open
 * hook applies it when the chat opens again. A chat whose restart fails gets its previous
 * binding back, so the pill never names an account it is not on.
 */
export async function switchAll(accountId: string, deps: SwitchAllDeps): Promise<SwitchAllResult> {
  const none = { moved: 0, restarted: 0, failed: 0, skipped: 0, error: "" };
  const registry = await deps.readRegistry();
  const checked = await switchTarget(registry, accountId, deps);
  if ("code" in checked) return { code: checked.code, ...none };
  const { target } = checked;

  const mine = (await deps.chats()).filter((chat) => chat.provider === target.provider);
  const chats = mine.filter((chat) => !BUSY.has(chat.status));
  const skipped = mine.length - chats.length;
  if (chats.length === 0) return { code: "", ...none, skipped };
  let bound: Registry = registry;
  for (const chat of chats) bound = applyBinding(bound, { agentId: chat.id, account: target.id });
  await deps.writeRegistry(bound);

  const open = chats.filter((chat) => chat.status !== "closed");
  const failures: Array<{ id: string; error: string }> = [];
  let notLoaded = 0;
  let next = 0;
  const worker = async () => {
    while (next < open.length) {
      const chat = open[next++]!;
      const reloaded = await deps.reload(chat.id);
      if (reloaded.code === "") continue;
      if (NOT_LOADED.test(reloaded.error)) notLoaded += 1;
      else failures.push({ id: chat.id, error: reloaded.error || reloaded.code });
    }
  };
  await Promise.all(Array.from({ length: Math.min(RELOAD_CONCURRENCY, open.length) }, worker));

  if (failures.length > 0) {
    // Re-read rather than reuse `bound`: a single switch may have landed meanwhile.
    let restored = await deps.readRegistry();
    for (const { id } of failures) restored = applyBinding(restored, { agentId: id, account: registry.agents[id] ?? null });
    await deps.writeRegistry(restored).catch(() => {});
  }

  return {
    code: "",
    moved: chats.length - failures.length,
    restarted: open.length - failures.length - notLoaded,
    failed: failures.length,
    skipped,
    error: failures[0]?.error ?? "",
  };
}
