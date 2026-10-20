import { stat } from "node:fs/promises";
import type { PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import { askedAccount } from "../shared/attach.ts";
import type { RefusalCode } from "../shared/defaults.ts";
import { PROVIDERS, envFor, isProviderId } from "../shared/providers.ts";
import {
  AUTO,
  type Account,
  type Registry,
  accountById,
  applyBinding,
  bindWorkspace,
  resolveAccount,
  workspaceAccount,
} from "../shared/registry.ts";
import { checkDefault, defaultOptions } from "./defaults.ts";

/** The part of the session-open request the hook reads. A `Pick` of the SDK type, so an
 *  upstream shape change fails the typecheck instead of quietly reading undefined. */
export type SessionRequest = Pick<
  PluginSessionOpenRequest,
  "agentId" | "workspaceId" | "provider" | "cwd" | "env"
> &
  // Optional so a caller that predates it (and every older test) reads as an existing chat.
  Partial<Pick<PluginSessionOpenRequest, "reason">>;

export interface HookDeps {
  readRegistry(): Promise<Registry>;
  /** Records the binding of a chat that opened on the provider's default account. */
  writeRegistry(value: Registry): Promise<void>;
  /** Whether a config directory exists. A session is pointed at a directory; a stale binding
   *  to a directory that is gone must not be injected. */
  directoryExists(path: string): Promise<boolean>;
  /** The provider's default config directory, reached with an empty credential variable
   *  (see `envFor`). */
  defaultDir(): string;
  /** Whether the config directory a new chat would run in on its own is logged in, and which
   *  directory that is. Absent, or `loggedIn: null` when it could not be told: the chat is
   *  not refused. */
  ownLogin?(request: SessionRequest): Promise<{ dir: string; loggedIn: boolean | null }>;
  /** The account an automatic pick chooses for a new chat of `provider` now (see
   *  shared/auto.ts), or null when there is none. Absent: an automatic default is treated as
   *  no default. */
  autoPick?(provider: string): Promise<Account | null>;
  /** Applies `change` to the registry as one step against other writers, and returns what was
   *  written. Absent: a plain read, then write. */
  update?(change: (registry: Registry) => Registry): Promise<Registry>;
  /** Whether a config directory is logged in; null when it could not be told. Absent: assumed
   *  logged in. A workspace account that is not is passed over. */
  loggedIn?(home: string): Promise<boolean | null>;
  /** The message a refused chat shows. */
  refusalText?(code: RefusalCode, values: { label?: string; dir?: string }): string;
  log?(line: string): void;
}

/** Names the account a new Claude chat opens on, or `AUTO`, for whoever starts chats by script
 *  (`paseo run --env PASEO_CLAUDE_ACCOUNT=work`). Chats of other providers ignore it. */
export const ACCOUNT_VAR = "PASEO_CLAUDE_ACCOUNT";

/** The workspace-create request with the account its first chat's "Claude account" attachment
 *  asks for put into that chat's environment, where `sessionEnv` reads it; undefined to leave the
 *  request alone. This is how a chat started from the new-workspace screen, which has no
 *  workspace (and so no header button) yet, chooses its account. An environment that already
 *  names an account wins. */
export function withAskedAccount<
  Request extends {
    agent?: { env?: Record<string, string>; attachments?: readonly unknown[] };
    firstAgentContext?: { attachments?: unknown };
  },
>(request: Request): Request | undefined {
  const agent = request.agent;
  if (agent === undefined || (agent.env?.[ACCOUNT_VAR] ?? "") !== "") return undefined;
  const context = request.firstAgentContext?.attachments;
  const asked = askedAccount([...(agent.attachments ?? []), ...(Array.isArray(context) ? context : [])]);
  if (asked === null) return undefined;
  return { ...request, agent: { ...agent, env: { ...agent.env, [ACCOUNT_VAR]: asked } } };
}

/** Thrown to stop a new chat before Claude Code starts without a login. Paseo fails the chat's
 *  creation with this message, so the person sees what to choose instead of an auth error. */
export class SessionRefused extends Error {
  readonly code: RefusalCode;
  constructor(code: RefusalCode, message: string) {
    super(message);
    this.name = "SessionRefused";
    this.code = code;
  }
}

export async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** The environment a session should open with, or undefined to leave it as Paseo built it.
 *  Runs on every session open regardless of `reason`: a switch is a reload, and it must open
 *  on whatever account is bound now.
 *
 *  A chat with no binding is only touched when it is new (`reason: "create"`): it opens on
 *  the account its environment asks for, its workspace's, or the provider's default (an
 *  automatic pick included), and is bound to it, so the pill names it. An existing chat
 *  that was never bound keeps opening the way it always has; a default chosen later does
 *  not move it.
 *
 *  A new chat is refused (`SessionRefused`) rather than started without a login: when the
 *  default is set but cannot be used (removed, no switching key, key rejected, directory
 *  gone), and when no default is set and the chat's own directory is known to be logged
 *  out. Anything else that cannot apply is a no-op: a session on the wrong account is a
 *  nuisance, one that cannot start is worse. */
export async function sessionEnv(
  request: SessionRequest,
  deps: HookDeps,
): Promise<Record<string, string> | undefined> {
  if (!isProviderId(request.provider)) return undefined;
  const provider = request.provider;
  const log = deps.log ?? ((line: string) => console.error(line));
  try {
    const registry = await deps.readRegistry();
    const bound = resolveAccount(registry, { agentId: request.agentId });
    if (bound !== null) return await accountEnv(bound, provider, request, deps);
    if (request.reason !== "create") return undefined;
    return await newChatEnv(registry, provider, request, deps);
  } catch (error) {
    if (error instanceof SessionRefused) {
      log(`accounts: refused to start ${request.agentId} (${error.code})`);
      throw error;
    }
    // Say so once and let Paseo open the session its own way.
    log(`accounts: leaving the session alone: ${String(error)}`);
    return undefined;
  }
}

/** A new, unbound chat, in this order: the account its environment asks for, the workspace's
 *  account, the provider's default (an account, or an automatic pick), or Paseo's own
 *  environment. An account the environment or the default names but cannot be used refuses the
 *  chat; a workspace account that cannot is passed over. */
async function newChatEnv(
  registry: Registry,
  provider: string,
  request: SessionRequest,
  deps: HookDeps,
): Promise<Record<string, string> | undefined> {
  const refuse = (code: RefusalCode, values: { label?: string; dir?: string }) =>
    new SessionRefused(code, deps.refusalText?.(code, values) ?? `no account for this chat (${code})`);
  const log = deps.log ?? ((line: string) => console.error(line));

  const asked = provider === "claude" ? (request.env[ACCOUNT_VAR]?.trim() ?? "") : "";
  if (asked !== "" && asked !== AUTO) {
    const account = accountById(registry, asked);
    if (account === null || account.provider !== provider) throw refuse("asked-unknown", { label: asked });
    const env = await accountEnv(account, provider, request, deps);
    if (env === undefined) throw refuse("asked-missing-directory", { label: account.label });
    await bindNewChat(account, provider, request, deps, "explicit");
    return env;
  }

  // `AUTO` asks for no account in particular, so a workspace that has one keeps it.
  // A workspace account that cannot open the chat; an automatic pick replaces it.
  let stale: string | null = null;
  if (request.workspaceId !== null) {
    const shared = workspaceAccount(registry, request.workspaceId, provider);
    if (shared !== null) stale = shared.id;
    const env = shared === null ? undefined : await usableEnv(shared, provider, request, deps);
    if (shared !== null && env !== undefined) {
      await bindNewChat(shared, provider, request, deps, "plain");
      return env;
    }
  }

  const checked = asked === AUTO ? ({ state: "auto" } as const) : await checkDefault(registry, provider, { directoryExists: deps.directoryExists });
  if (checked.state === "broken") throw refuse(checked.problem, { label: checked.label });
  if (checked.state === "ok") {
    const env = { ...request.env, ...envFor(checked.account, deps.defaultDir()) };
    await bindNewChat(checked.account, provider, request, deps, "plain");
    return env;
  }
  if (checked.state === "auto") {
    const picked = (await deps.autoPick?.(provider)) ?? null;
    const env = picked === null ? undefined : await accountEnv(picked, provider, request, deps);
    if (picked !== null && env !== undefined) {
      const landed = await bindNewChat(picked, provider, request, deps, "auto", stale);
      const landedEnv = landed.id === picked.id ? env : await accountEnv(landed, provider, request, deps);
      if (landedEnv !== undefined) {
        log(`accounts: ${request.agentId} opens on ${landed.id} (automatic)`);
        return landedEnv;
      }
      // The workspace was pinned meanwhile to an account that cannot open the chat: keep the pick.
      await bindNewChat(picked, provider, request, deps, "plain");
      log(`accounts: ${request.agentId} opens on ${picked.id} (automatic)`);
      return env;
    }
  }

  // No default, or nothing to pick: the chat runs on its own directory's login, which is fine
  // when there is one.
  if (provider !== "claude" || deps.ownLogin === undefined) return undefined;
  const own = await deps.ownLogin(request);
  if (own.loggedIn !== false) return undefined;
  if (checked.state === "auto") throw refuse("auto-none", { dir: own.dir });
  throw refuse(defaultOptions(registry, provider).length > 0 ? "not-set" : "no-accounts", { dir: own.dir });
}

/**
 * Binds a new chat to the account it opens on, so the pill names it, and returns that account.
 * One step against other writers, so chats starting together cannot drop each other's binding.
 *
 * `explicit` and `auto` also give the account to the chat's workspace when it has none yet, so
 * the task's next chats follow this one. An `auto` pick yields to an account another chat of the
 * workspace pinned while this one was picking: chats started together stay on one account.
 * `stale` names a workspace account that could not open the chat; it is replaced, not adopted.
 */
async function bindNewChat(
  account: Account,
  provider: string,
  request: SessionRequest,
  deps: HookDeps,
  mode: "plain" | "explicit" | "auto",
  /** A workspace account already found unusable: treated as no account, and replaced. */
  stale: string | null = null,
): Promise<Account> {
  const workspaceId = request.workspaceId;
  let landed = account;
  const change = (registry: Registry): Registry => {
    const found = workspaceId === null ? null : workspaceAccount(registry, workspaceId, provider);
    const pinned = found !== null && found.id === stale ? null : found;
    landed = mode === "auto" && pinned !== null ? pinned : account;
    let next = applyBinding(registry, { agentId: request.agentId, account: landed.id });
    if (mode !== "plain" && workspaceId !== null && pinned === null) {
      next = bindWorkspace(next, { workspaceId, provider, account: landed.id, auto: mode === "auto" });
    }
    return next;
  };
  if (deps.update !== undefined) await deps.update(change);
  else await deps.writeRegistry(change(await deps.readRegistry()));
  return landed;
}

/** `accountEnv`, and passed over as well when the account is known to be logged out. */
async function usableEnv(
  account: Account,
  provider: string,
  request: SessionRequest,
  deps: HookDeps,
): Promise<Record<string, string> | undefined> {
  const env = await accountEnv(account, provider, request, deps);
  if (env === undefined) return undefined;
  return (await deps.loggedIn?.(account.home)) === false ? undefined : env;
}

/** What `account` contributes to a session of `provider`, or undefined when it cannot. The
 *  session is pointed at the account's directory, whose own login it then runs on. */
async function accountEnv(
  account: Account,
  provider: string,
  request: SessionRequest,
  deps: HookDeps,
): Promise<Record<string, string> | undefined> {
  if (account.provider !== provider) return undefined;
  if (!PROVIDERS[account.provider].supported) return undefined;
  // A stale binding to a directory that is gone: leave the session as Paseo built it rather
  // than point it at nothing.
  if (!(await deps.directoryExists(account.home))) return undefined;
  return { ...request.env, ...envFor(account, deps.defaultDir()) };
}
