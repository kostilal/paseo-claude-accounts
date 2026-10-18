import { stat } from "node:fs/promises";
import type { PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import type { RefusalCode } from "../shared/defaults.ts";
import { PROVIDERS, envFor, isProviderId } from "../shared/providers.ts";
import { type Account, type Registry, applyBinding, resolveAccount, tokenKey } from "../shared/registry.ts";
import { type DefaultDeps, checkDefault, defaultOptions } from "./defaults.ts";

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
  /** The token filed under a Keychain account (`tokenKey`), or null. Only the token
   *  mechanism calls this, so a directory switch never risks a Keychain dialog while a
   *  session starts. */
  readMintedToken(login: string): Promise<string | null>;
  /** Whether a config directory exists. Codex refuses to start on a missing `CODEX_HOME`,
   *  so a stale binding must not be injected. */
  directoryExists(path: string): Promise<boolean>;
  /** Anthropic's answer to a default's token. Absent: not asked, the token counts as good. */
  checkToken?: DefaultDeps["checkToken"];
  /** Whether the config directory a new chat would run in on its own is logged in, and which
   *  directory that is. Absent, or `loggedIn: null` when it could not be told: the chat is
   *  not refused. */
  ownLogin?(request: SessionRequest): Promise<{ dir: string; loggedIn: boolean | null }>;
  /** The message a refused chat shows. */
  refusalText?(code: RefusalCode, values: { label?: string; dir?: string }): string;
  log?(line: string): void;
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
 *  the provider's default account and is bound to it, so the pill names it. An existing chat
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

/** A new, unbound chat: the default account, or a refusal, or Paseo's own environment. */
async function newChatEnv(
  registry: Registry,
  provider: string,
  request: SessionRequest,
  deps: HookDeps,
): Promise<Record<string, string> | undefined> {
  const refuse = (code: RefusalCode, values: { label?: string; dir?: string }) =>
    new SessionRefused(code, deps.refusalText?.(code, values) ?? `no account for this chat (${code})`);

  const checked = await checkDefault(registry, provider, {
    readMintedToken: deps.readMintedToken,
    directoryExists: deps.directoryExists,
    checkToken: deps.checkToken ?? (async () => "ok"),
  });
  if (checked.state === "broken") throw refuse(checked.problem, { label: checked.label });
  if (checked.state === "ok") {
    const env = { ...request.env, ...envFor(checked.account, checked.token) };
    await deps.writeRegistry(applyBinding(await deps.readRegistry(), { agentId: request.agentId, account: checked.account.id }));
    return env;
  }

  // No default: the chat runs on its own directory's login, which is fine when there is one.
  if (provider !== "claude" || deps.ownLogin === undefined) return undefined;
  const own = await deps.ownLogin(request);
  if (own.loggedIn !== false) return undefined;
  throw refuse(defaultOptions(registry, provider).length > 0 ? "not-set" : "no-accounts", { dir: own.dir });
}

/** What `account` contributes to a session of `provider`, or undefined when it cannot. */
async function accountEnv(
  account: Account,
  provider: string,
  request: SessionRequest,
  deps: HookDeps,
): Promise<Record<string, string> | undefined> {
  if (account.provider !== provider) return undefined;
  if (!PROVIDERS[account.provider].supported) return undefined;
  const mechanism = PROVIDERS[account.provider].switch;
  if (mechanism.kind === "home") {
    // Codex refreshes its own credentials inside the directory it is pointed at, so the
    // switch is just naming that directory.
    if (!(await deps.directoryExists(account.home))) return undefined;
    return { ...request.env, ...envFor(account, null) };
  }
  // No token is the normal state of a newly discovered account: the session keeps
  // whatever login its config directory already has. `tokenLogin` and `tokenOrg` (whose
  // subscription the token bills, and the Keychain item's key) can differ from the
  // directory's own login.
  const key = tokenKey(account);
  if (key === null) return undefined;
  const token = await deps.readMintedToken(key);
  if (token === null) return undefined;
  return { ...request.env, ...envFor(account, token) };
}
