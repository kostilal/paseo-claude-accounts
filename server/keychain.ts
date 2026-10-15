import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import { record } from "../shared/parse.ts";

const run = promisify(execFile);

/** Thrown when the read was killed by its own timeout, which on macOS means one thing:
 *  an authorisation dialog is on screen waiting for an answer nobody gave. */
export class KeychainTimeout extends Error {}

/** The message for an item that holds no claude.ai token. */
export const NO_TOKEN = "this config directory has no claude.ai token";

/** Whether `execFile` killed the child because of its timeout. */
export function killedByTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { killed?: boolean }).killed === true;
}

/** The access token for one config directory. `timeoutMs` of null waits indefinitely, which
 *  is right only when a person pressed a button and expects the Keychain dialog.
 *  The token is never stored, logged, or sent to a client. */
export interface Credential {
  token: string;
  /** Claude Code's own `expiresAt`, ms since the epoch, or null when the item has none. */
  expiresAt: number | null;
}

export async function readToken(service: string, timeoutMs: number | null): Promise<string> {
  return (await readCredential(service, timeoutMs)).token;
}

/** The credential Claude Code keeps for one config directory. The expiry lets callers skip
 *  an expired token (and try another directory on the same login) without spending a
 *  rate-limited request to learn it from a 401. */
export async function readCredential(service: string, timeoutMs: number | null): Promise<Credential> {
  const options = timeoutMs === null ? {} : { timeout: timeoutMs, killSignal: "SIGKILL" as const };
  let stdout: string;
  try {
    ({ stdout } = await run(
      "security",
      ["find-generic-password", "-s", service, "-a", userInfo().username, "-w"],
      options,
    ));
  } catch (error) {
    if (killedByTimeout(error)) throw new KeychainTimeout("a Keychain dialog is waiting");
    throw error;
  }
  // JSON.parse errors quote part of their input, which here is the credential blob, so the
  // message is replaced to keep any secret material from reaching the screen.
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("the Keychain item for this config directory is not JSON");
  }
  const blob = record(parsed);
  const oauth = record(blob.claudeAiOauth);
  const token = oauth.accessToken;
  if (typeof token !== "string" || token === "") {
    // E.g. a directory holding only mcpOAuth, until someone logs in there.
    throw new Error(NO_TOKEN);
  }
  const expiresAt = typeof oauth.expiresAt === "number" && Number.isFinite(oauth.expiresAt) ? oauth.expiresAt : null;
  return { token, expiresAt };
}
