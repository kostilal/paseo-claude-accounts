import { z } from "zod";
import { canonical } from "./path.ts";
import { type ProviderId, isProviderId } from "./providers.ts";

export interface Account {
  /** Stable slug every binding stores. Not the path, which changes when a folder moves. */
  id: string;
  /** What the pill and the screen show. Seeded from the directory name. */
  label: string;
  provider: ProviderId;
  /** The config directory: `CLAUDE_CONFIG_DIR` for Claude, `CODEX_HOME` for Codex. */
  home: string;
  /**
   * The login a minted token is filed under in the Keychain, i.e. whose subscription the
   * token bills. Absent until a token is minted.
   *
   * Not necessarily who the directory itself is signed in as: `claude setup-token`
   * authorises whoever is signed in to the browser, so the two can differ.
   */
  tokenLogin?: string;
  /**
   * The organisation the minted token bills, from the API's answer when the token was
   * checked. One email can hold several organisations (a personal plan and a Team seat),
   * each with its own allowance, so the Keychain item is keyed on both. Absent for tokens
   * minted before this was recorded, and when the API did not say.
   */
  tokenOrg?: string;
}

export interface Registry {
  version: 2;
  accounts: Account[];
  /** agentId -> account id. A switch applies to one chat. */
  agents: Record<string, string>;
  /** Directories the user removed from the list. Removing only forgets an account, the
   *  directory and its login stay, so discovery would offer it straight back without this. */
  hidden?: string[];
}

export function emptyRegistry(): Registry {
  return { version: 2, accounts: [], agents: {}, hidden: [] };
}

export const accountSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  provider: z.string().refine(isProviderId),
  home: z.string().min(1),
  tokenLogin: z.string().optional(),
  tokenOrg: z.string().optional(),
});

const stored = z.object({
  version: z.literal(2),
  accounts: z.array(accountSchema).default([]),
  agents: z.record(z.string(), z.string()).default({}),
  hidden: z.array(z.string()).default([]),
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

/** The Keychain account an account's minted token is filed under, or null when it has
 *  none: `<login>/<organisation>`, or the bare login for a token minted before the
 *  organisation was recorded. */
export function tokenKey(account: Pick<Account, "tokenLogin" | "tokenOrg">): string | null {
  if (account.tokenLogin === undefined || account.tokenLogin === "") return null;
  return account.tokenOrg ? `${account.tokenLogin}/${account.tokenOrg}` : account.tokenLogin;
}

export function accountById(registry: Registry, id: string): Account | null {
  return registry.accounts.find((account) => account.id === id) ?? null;
}

/** The account this chat is bound to, or null when it is not bound (or the account is gone). */
export function resolveAccount(registry: Registry, context: { agentId: string }): Account | null {
  const bound = registry.agents[context.agentId];
  return bound === undefined ? null : accountById(registry, bound);
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
      hidden: [...before, ...added],
    },
    removed: [...removed].sort(),
    hidden: added,
  };
}

/** Lets hidden directories back into discovery. Accounts stay removed; the directory comes
 *  back as a suggestion to add again. */
export function unhideHomes(registry: Registry, homes: readonly string[]): { registry: Registry; restored: string[] } {
  const before = registry.hidden ?? [];
  const asked = new Set(homes.map(canonical).filter((home) => home !== ""));
  const restored = before.filter((home) => asked.has(home)).sort();
  return { registry: { ...registry, hidden: before.filter((home) => !asked.has(home)) }, restored };
}
