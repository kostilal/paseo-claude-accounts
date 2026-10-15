import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { KeychainTimeout, killedByTimeout } from "./keychain.ts";

const execFileAsync = promisify(execFile);

/**
 * The Keychain service holding the tokens this plugin minted, one item per login. Separate
 * from Claude Code's own `Claude Code-credentials*` items, which belong to their config
 * directories and must never be overwritten.
 */
export const MINTED_SERVICE = "paseo-claude-accounts";

/** A `security` read can wait for ever behind an unlock dialog, and the session-open hook
 *  awaits this read, so it is killed after three seconds. */
export const READ_TIMEOUT_MS = 3_000;

export interface KeychainRunner {
  run(
    file: string,
    args: readonly string[],
    options?: { timeout: number; killSignal: "SIGKILL" },
  ): Promise<{ stdout: string }>;
  /** Runs `security -i` with `input` on stdin. */
  interactive(input: string): Promise<void>;
}

export const systemKeychain: KeychainRunner = {
  run: (file, args, options) => execFileAsync(file, [...args], { ...options }),
  interactive: (input) =>
    new Promise((resolve, reject) => {
      const child = spawn("security", ["-i"], { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`security exited ${code}`))));
      child.stdin.end(input);
    }),
};

/**
 * The token minted for one login, or null when there is none. A read that times out is
 * the one failure reported as an error (`KeychainTimeout`), so the log can say that a
 * dialog is waiting instead of looking like "no token".
 */
export async function readMintedToken(
  login: string,
  deps: KeychainRunner = systemKeychain,
): Promise<string | null> {
  let stdout: string;
  try {
    ({ stdout } = await deps.run(
      "security",
      ["find-generic-password", "-s", MINTED_SERVICE, "-a", login, "-w"],
      { timeout: READ_TIMEOUT_MS, killSignal: "SIGKILL" },
    ));
  } catch (error) {
    if (killedByTimeout(error)) throw new KeychainTimeout("a Keychain dialog is waiting");
    return null;
  }
  const token = stdout.trim();
  return token === "" ? null : token;
}

/** A value inside a double-quoted `security -i` argument. */
function quoted(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Files a token under its login, replacing any earlier one (`-U`). The token goes in on
 * stdin through `security -i` rather than as an argument, so it never appears in the
 * process list. `security -i` exits 0 even when the command inside fails, so the write is
 * read back to confirm it. Errors never carry the token.
 */
export async function writeMintedToken(
  login: string,
  token: string,
  deps: KeychainRunner = systemKeychain,
): Promise<void> {
  try {
    await deps.interactive(
      `add-generic-password -U -s ${quoted(MINTED_SERVICE)} -a ${quoted(login)} -w ${quoted(token)}\n`,
    );
  } catch {
    throw new Error(`could not write the token for ${login} to the Keychain`);
  }
  if ((await readMintedToken(login, deps)) !== token) {
    throw new Error(`could not write the token for ${login} to the Keychain`);
  }
}

/** Removing what is not there is success. */
export async function deleteMintedToken(
  login: string,
  deps: KeychainRunner = systemKeychain,
): Promise<void> {
  try {
    await deps.run("security", ["delete-generic-password", "-s", MINTED_SERVICE, "-a", login]);
  } catch {
    // already absent
  }
}
