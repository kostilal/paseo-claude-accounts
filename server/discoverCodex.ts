import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Identity } from "../shared/parse.ts";
import { parseCodexAuth } from "./codexAuth.ts";

/** Codex's own default config directory. */
export function defaultCodexDir(home: string = homedir()): string {
  return join(home, ".codex");
}

/** Every Codex config directory: the default one (listed even if it does not exist yet, so
 *  there is a row to log in through) and every `~/.codex-*`. There is no per-project family
 *  as there is for Claude's `.claude-data`. */
export async function listCodexDirs(home: string = homedir()): Promise<string[]> {
  let profiles: string[] = [];
  try {
    const entries = await readdir(home, { withFileTypes: true });
    profiles = entries
      .filter((entry) => entry.isDirectory() && /^\.codex-.+$/.test(entry.name))
      .map((entry) => join(home, entry.name))
      .sort();
  } catch {
    // The default row still stands.
  }
  return [defaultCodexDir(home), ...profiles];
}

export interface CodexDeps {
  /** `auth.json`'s contents; rejects like `readFile` (`ENOENT` when nobody is logged in). */
  read(path: string): Promise<string>;
}

export const liveCodexDeps: CodexDeps = {
  read: (path) => readFile(path, "utf8"),
};

/** Who one Codex directory is logged in as. Any read failure means logged out: unlike
 *  Claude's `identify`, nothing is spawned, so there is no missing-binary case to separate. */
export async function identifyCodex(dir: string, deps: CodexDeps = liveCodexDeps): Promise<Identity> {
  try {
    return parseCodexAuth(await deps.read(join(dir, "auth.json")));
  } catch {
    return { loggedIn: false, email: "", orgName: "", subscriptionType: "" };
  }
}
