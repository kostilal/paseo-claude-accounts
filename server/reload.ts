import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Paseo ships its CLI inside the application bundle and does not always put it on PATH. */
export const BUNDLED_PASEO = "/Applications/Paseo.app/Contents/Resources/bin/paseo";

/** Where the bundled CLI may be, in order. */
export function paseoPaths(home: string = homedir()): string[] {
  return [BUNDLED_PASEO, join(home, "Applications", "Paseo.app", "Contents", "Resources", "bin", "paseo")];
}

const RELOAD_TIMEOUT_MS = 30_000;

export type ReloadCode = "" | "paseo-not-found" | "reload-failed";

export interface ReloadDeps {
  exists(path: string): Promise<boolean>;
  run(file: string, args: string[]): Promise<void>;
}

export const liveReloadDeps: ReloadDeps = {
  exists: async (path) => {
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  },
  run: async (file, args) => {
    await run(file, args, { timeout: RELOAD_TIMEOUT_MS });
  },
};

/** Restart this agent's provider session with `paseo agent reload`. On reopen Paseo runs the
 *  `agent.session_open` hook again, which injects the newly bound account. The CLI is used
 *  because the plugin `PaseoApi`'s `refresh()` only refetches a snapshot; the call that
 *  restarts the process is not exposed to plugins. */
export async function reloadAgent(
  agentId: string,
  deps: ReloadDeps = liveReloadDeps,
): Promise<{ code: ReloadCode; error: string }> {
  let file = "paseo";
  for (const candidate of paseoPaths()) {
    if (await deps.exists(candidate)) {
      file = candidate;
      break;
    }
  }
  try {
    await deps.run(file, ["agent", "reload", agentId]);
    return { code: "" as const, error: "" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") return { code: "paseo-not-found" as const, error: "" };
    return {
      code: "reload-failed" as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
