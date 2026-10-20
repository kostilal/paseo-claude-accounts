import { z } from "zod";
import { canonical } from "./path.ts";
import { type ProviderId, isProviderId } from "./providers.ts";

export interface Account {
  /** Stable slug every binding stores. Not the path, which changes when a folder moves. */
  id: string;
  /** What the pill and the screen show. Seeded from the directory name. */
  label: string;
  provider: ProviderId;
  /** The config directory: `CLAUDE_CONFIG_DIR` for Claude, `CODEX_HOME` for Codex. Its login
   *  is the account: usage is read from it and a switched session runs on it. */
  home: string;
}

export interface Registry {
  version: 2;
  accounts: Account[];
  /** agentId -> account id. A switch applies to one chat. */
  agents: Record<string, string>;
  /** Directories the user removed from the list. Removing only forgets an account, the
   *  directory and its login stay, so discovery would offer it straight back without this. */
  hidden?: string[];
  /** provider -> account id, set by "Move all chats here". A chat with no binding of its own
   *  is bound to it when its session opens, so new chats follow the last move. `AUTO` instead
   *  of an id picks the account by its allowance each time; see shared/auto.ts. */
  defaults?: Record<string, string>;
  /** workspaceId -> provider -> account id. A new chat in the workspace opens on it, so every
   *  chat of one task runs on one account. Set by the workspace's header button, and by the
   *  first chat an automatic pick placed in the workspace. */
  workspaces?: Record<string, Record<string, string>>;
  /** The workspace accounts an automatic pick set rather than a person (`pinKey`). Changing
   *  the default clears these, so new chats everywhere follow it; a person's choice stays. */
  autoPins?: string[];
}

/** One workspace account's key in `autoPins`. Neither id can hold a newline. */
export function pinKey(workspaceId: string, provider: string): string {
  return `${workspaceId}\n${provider}`;
}

/** The default that is not an account: pick one by its allowance when each chat opens. Account
 *  ids come from directory names, so a new account is never given this one (see `connectAccount` in
 *  index.server.ts). */
export const AUTO = "@auto";

export function emptyRegistry(): Registry {
  return { version: 2, accounts: [], agents: {}, hidden: [] };
}

// Unknown keys are dropped, so a state file from 0.1.x (with `tokenLogin`/`tokenOrg`) parses
// and loses those fields on the next write; see `migrateRegistry` in server/store.ts.
export const accountSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  provider: z.string().refine(isProviderId),
  home: z.string().min(1),
});

const stored = z.object({
  version: z.literal(2),
  accounts: z.array(accountSchema).default([]),
  agents: z.record(z.string(), z.string()).default({}),
  hidden: z.array(z.string()).default([]),
  defaults: z.record(z.string(), z.string()).optional(),
  workspaces: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  autoPins: z.array(z.string()).optional(),
});

/**
 * The registry in a parsed state file, or null when this version cannot read it. Null is
 * deliberately not an empty registry: every writer is a read-modify-write, and treating an
 * unreadable file as empty would let the next write erase it. See `server/store.ts`.
 */
export function parseRegistry(raw: unknown): Registry | null {
  const parsed = stored.safeParse(raw);
  return parsed.success ? (parsed.data as Registry) : null;
}

export function accountById(registry: Registry, id: string): Account | null {
  return registry.accounts.find((account) => account.id === id) ?? null;
}

/** The account this chat is bound to, or null when it is not bound (or the account is gone). */
export function resolveAccount(registry: Registry, context: { agentId: string }): Account | null {
  const bound = registry.agents[context.agentId];
  return bound === undefined ? null : accountById(registry, bound);
}

/** The account new chats of this provider are bound to, or null when none was chosen (or it
 *  is gone, or belongs to another provider). */
export function defaultAccount(registry: Registry, provider: string): Account | null {
  const id = registry.defaults?.[provider];
  if (id === undefined) return null;
  const account = accountById(registry, id);
  return account?.provider === provider ? account : null;
}

/** The provider's default set to an account id, or cleared with `account: null`. Bindings
 *  are untouched: a default only decides where chats opened from now on land. */
export function setDefault(registry: Registry, provider: string, account: string | null): Registry {
  const defaults = { ...registry.defaults };
  if (account === null) delete defaults[provider];
  else defaults[provider] = account;
  return { ...registry, defaults };
}

/** The account new chats of `provider` in this workspace open on, or null when none is set (or
 *  it is gone, or belongs to another provider). */
export function workspaceAccount(registry: Registry, workspaceId: string, provider: string): Account | null {
  const id = registry.workspaces?.[workspaceId]?.[provider];
  if (id === undefined) return null;
  const account = accountById(registry, id);
  return account?.provider === provider ? account : null;
}

/** A workspace's account for one provider set, or cleared with `account: null`. Chats already
 *  open in it keep theirs. */
export function bindWorkspace(
  registry: Registry,
  request: { workspaceId: string; provider: string; account: string | null; auto?: boolean },
): Registry {
  const workspaces = { ...registry.workspaces };
  const own = { ...workspaces[request.workspaceId] };
  if (request.account === null) delete own[request.provider];
  else own[request.provider] = request.account;
  if (Object.keys(own).length === 0) delete workspaces[request.workspaceId];
  else workspaces[request.workspaceId] = own;
  const key = pinKey(request.workspaceId, request.provider);
  const autoPins = (registry.autoPins ?? []).filter((pin) => pin !== key);
  if (request.account !== null && request.auto === true) autoPins.push(key);
  return { ...registry, workspaces, autoPins };
}

/** The workspace accounts an automatic pick set for `provider` cleared, so new chats there
 *  follow the default again. Accounts a person chose for a workspace are kept. */
export function unpinAutomatic(registry: Registry, provider: string): Registry {
  let next = registry;
  for (const key of registry.autoPins ?? []) {
    const [workspaceId, pinned] = key.split("\n");
    if (pinned !== provider || workspaceId === undefined) continue;
    next = bindWorkspace(next, { workspaceId, provider, account: null });
  }
  return next;
}

/** Every workspace's account for `provider` cleared, so new chats follow the default again. */
export function unpinWorkspaces(registry: Registry, provider: string): Registry {
  if (registry.workspaces === undefined) return registry;
  const workspaces: Record<string, Record<string, string>> = {};
  for (const [workspaceId, byProvider] of Object.entries(registry.workspaces)) {
    const own = { ...byProvider };
    delete own[provider];
    if (Object.keys(own).length > 0) workspaces[workspaceId] = own;
  }
  const autoPins = (registry.autoPins ?? []).filter((key) => !key.endsWith(`\n${provider}`));
  return { ...registry, workspaces, autoPins };
}

/** Forgets a workspace's accounts, for when the workspace is archived. */
export function forgetWorkspace(registry: Registry, workspaceId: string): Registry {
  if (registry.workspaces?.[workspaceId] === undefined) return registry;
  const workspaces = { ...registry.workspaces };
  delete workspaces[workspaceId];
  const autoPins = (registry.autoPins ?? []).filter((key) => !key.startsWith(`${workspaceId}\n`));
  return { ...registry, workspaces, autoPins };
}

/** One agent binding set, or cleared with `account: null`. */
export function applyBinding(registry: Registry, request: { agentId: string; account: string | null }): Registry {
  const agents = { ...registry.agents };
  if (request.account === null) delete agents[request.agentId];
  else agents[request.agentId] = request.account;
  return { ...registry, accounts: [...registry.accounts], agents };
}

export function hiddenHomes(registry: Registry): Set<string> {
  return new Set(registry.hidden ?? []);
}

/** Adds an account, and takes its directory back out of `hidden`. */
export function registerAccount(registry: Registry, account: Account): Registry {
  const hidden = (registry.hidden ?? []).filter((home) => home !== account.home);
  return { ...registry, accounts: [...registry.accounts, account], hidden };
}

export type RemoveResult =
  | { ok: true; registry: Registry; removed: string[]; hidden: string[] }
  | { ok: false; unknown: string[] };

/**
 * Forgets accounts. Each target is a registry id or an absolute path (how an unregistered
 * suggestion is addressed). Every removed directory is added to `hidden` and every chat
 * binding to a removed account is dropped. Nothing on disk or in the Keychain is touched.
 *
 * All or nothing: one unknown target refuses the whole request, so a row made of several
 * directories is never half removed.
 */
export function removeAccounts(registry: Registry, targets: readonly string[]): RemoveResult {
  const removed = new Set<string>();
  const homes = new Set<string>();
  const unknown: string[] = [];
  for (const target of targets) {
    if (target.startsWith("/")) {
      const home = canonical(target);
      if (home === "") {
        unknown.push(target);
        continue;
      }
      homes.add(home);
      for (const account of registry.accounts) if (account.home === home) removed.add(account.id);
      continue;
    }
    const account = accountById(registry, target);
    if (account === null) {
      unknown.push(target);
      continue;
    }
    removed.add(account.id);
    homes.add(account.home);
  }
  if (unknown.length > 0) return { ok: false, unknown };

  const before = hiddenHomes(registry);
  const added = [...homes].filter((home) => !before.has(home)).sort();
  return {
    ok: true,
    registry: {
      ...registry,
      accounts: registry.accounts.filter((account) => !removed.has(account.id)),
      agents: Object.fromEntries(Object.entries(registry.agents).filter(([, id]) => !removed.has(id))),
      ...(registry.defaults === undefined
        ? {}
        : { defaults: Object.fromEntries(Object.entries(registry.defaults).filter(([, id]) => !removed.has(id))) }),
      ...(registry.workspaces === undefined ? {} : { workspaces: withoutAccounts(registry.workspaces, removed) }),
      hidden: [...before, ...added],
    },
    removed: [...removed].sort(),
    hidden: added,
  };
}

/** Workspace accounts minus the removed ones, dropping workspaces left with none. */
function withoutAccounts(
  workspaces: Record<string, Record<string, string>>,
  removed: ReadonlySet<string>,
): Record<string, Record<string, string>> {
  const kept: Record<string, Record<string, string>> = {};
  for (const [workspaceId, byProvider] of Object.entries(workspaces)) {
    const own = Object.fromEntries(Object.entries(byProvider).filter(([, id]) => !removed.has(id)));
    if (Object.keys(own).length > 0) kept[workspaceId] = own;
  }
  return kept;
}

/** Lets hidden directories back into discovery. Accounts stay removed; the directory comes
 *  back as a suggestion to add again. */
export function unhideHomes(registry: Registry, homes: readonly string[]): { registry: Registry; restored: string[] } {
  const before = registry.hidden ?? [];
  const asked = new Set(homes.map(canonical).filter((home) => home !== ""));
  const restored = before.filter((home) => asked.has(home)).sort();
  return { registry: { ...registry, hidden: before.filter((home) => !asked.has(home)) }, restored };
}
