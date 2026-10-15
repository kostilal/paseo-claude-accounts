import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The config directory a running chat's Claude Code process actually uses, read from the
 * process environment (`ps -E`). Paseo starts every agent process with `PASEO_AGENT_ID`, and
 * whatever chose the directory (the daemon, a launch command, a shell rc file) has left its
 * `CLAUDE_CONFIG_DIR` there. Nothing is logged: other variables in the listing can be secrets.
 *
 * `found: false` means no process for the agent is running. `configDir: null` with
 * `found: true` means the process runs without `CLAUDE_CONFIG_DIR`, i.e. on `~/.claude`.
 */
export interface SessionDir {
  found: boolean;
  configDir: string | null;
}

/** Picks one agent's directory out of `ps -axE -ww -o command=` output. A value containing
 *  spaces is cut at the first one; the caller checks that the directory exists. */
export function parseSessionDir(listing: string, agentId: string): SessionDir {
  const marker = `PASEO_AGENT_ID=${agentId}`;
  for (const line of listing.split("\n")) {
    const words = line.split(" ");
    if (!words.includes(marker)) continue;
    const variable = words.find((word) => word.startsWith("CLAUDE_CONFIG_DIR="));
    return { found: true, configDir: variable === undefined ? null : variable.slice("CLAUDE_CONFIG_DIR=".length) || null };
  }
  return { found: false, configDir: null };
}

/** `parseSessionDir` over a live process listing, shared for a few seconds between callers. */
export function createSessionDirs(
  ttlMs = 10_000,
  list: () => Promise<string> = async () => (await run("ps", ["-axE", "-ww", "-o", "command="], { maxBuffer: 64 * 1024 * 1024 })).stdout,
) {
  let cached: { at: number; listing: Promise<string> } | null = null;
  return async function sessionDir(agentId: string): Promise<SessionDir> {
    if (cached === null || Date.now() - cached.at > ttlMs) cached = { at: Date.now(), listing: list().catch(() => "") };
    return parseSessionDir(await cached.listing, agentId);
  };
}
