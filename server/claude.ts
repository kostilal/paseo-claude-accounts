import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonical } from "../shared/path.ts";

/** Claude Code's own default config directory. */
export function defaultDir(home: string = homedir()): string {
  return join(home, ".claude");
}

/**
 * Where `claude` usually lives. A daemon started from the GUI does not inherit a login
 * shell's PATH, so a bare `claude` can fail with ENOENT on a machine where the CLI works
 * fine in a terminal. Known install locations are tried first, PATH last.
 */
export function claudePaths(home: string = homedir()): string[] {
  return [
    join(home, ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    join(home, ".claude", "local", "claude"),
    join(home, ".npm-global", "bin", "claude"),
  ];
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The `claude` executable to run: the first known install location that exists, else a
 *  bare `claude` resolved through PATH. */
export async function findClaude(
  home: string = homedir(),
  exists: (path: string) => Promise<boolean> = isFile,
): Promise<string> {
  for (const candidate of claudePaths(home)) {
    if (await exists(candidate)) return candidate;
  }
  return "claude";
}

/**
 * Variables that would make `claude` answer about something other than the directory it
 * is pointed at: an inherited token or API key wins over the directory's own login, and
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR` redirects which Keychain item is read.
 */
const OVERRIDES = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR",
];

/**
 * The environment for running `claude` against one config directory.
 *
 * Claude Code names its Keychain item `Claude Code-credentials` only when
 * `CLAUDE_CONFIG_DIR` is unset; once the variable is set, even to `~/.claude`, the name
 * gains a hash of the path. A plain `claude login` therefore files its credentials under
 * the bare name, and asking about `~/.claude` with the variable set would look in the wrong
 * item and report "logged out". So the default directory is reached by unsetting the
 * variable, and every other directory by setting it.
 */
export function claudeEnv(
  dir: string,
  base: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const name of OVERRIDES) delete env[name];
  if (canonical(dir) === canonical(defaultDir(home))) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = dir;
  return env;
}

/** The same rule as `claudeEnv`, as a shell prefix for a script run in a terminal: `$1` is
 *  the directory, or empty for the default one. A login shell may have exported its own
 *  `CLAUDE_CONFIG_DIR` by the time the script runs, so the variable is always set or unset
 *  explicitly. */
export const SHELL_CONFIG_DIR =
  'unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_SECURESTORAGE_CONFIG_DIR; ' +
  'if [ -n "$1" ]; then export CLAUDE_CONFIG_DIR="$1"; else unset CLAUDE_CONFIG_DIR; fi';

/** What to pass as `$1` for `SHELL_CONFIG_DIR`. */
export function shellDirArg(dir: string, home: string = homedir()): string {
  return canonical(dir) === canonical(defaultDir(home)) ? "" : dir;
}
