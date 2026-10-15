import { stat } from "node:fs/promises";
import type { PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import { PROVIDERS, envFor, isProviderId } from "../shared/providers.ts";
import { type Registry, resolveAccount, tokenKey } from "../shared/registry.ts";

/** The part of the session-open request the hook reads. A `Pick` of the SDK type, so an
 *  upstream shape change fails the typecheck instead of quietly reading undefined. */
export type SessionRequest = Pick<
  PluginSessionOpenRequest,
  "agentId" | "workspaceId" | "provider" | "cwd" | "env"
>;

export interface HookDeps {
  readRegistry(): Promise<Registry>;
  /** The token filed under a Keychain account (`tokenKey`), or null. Only the token
   *  mechanism calls this, so a directory switch never risks a Keychain dialog while a
   *  session starts. */
  readMintedToken(login: string): Promise<string | null>;
  /** Whether a config directory exists. Codex refuses to start on a missing `CODEX_HOME`,
   *  so a stale binding must not be injected. */
  directoryExists(path: string): Promise<boolean>;
  log?(line: string): void;
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
 *  on whatever account is bound now. Anything that cannot apply (another provider, no token,
 *  a missing directory, an error) is a no-op: a session on the wrong account is a nuisance,
 *  one that cannot start is worse. */
export async function sessionEnv(
  request: SessionRequest,
  deps: HookDeps,
): Promise<Record<string, string> | undefined> {
  if (!isProviderId(request.provider)) return undefined;
  const provider = request.provider;
  try {
    const registry = await deps.readRegistry();
    const account = resolveAccount(registry, { agentId: request.agentId });
    if (account === null) return undefined;
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
  } catch (error) {
    // Say so once and let Paseo open the session its own way.
    (deps.log ?? ((line: string) => console.error(line)))(
      `accounts: leaving the session alone: ${String(error)}`,
    );
    return undefined;
  }
}
