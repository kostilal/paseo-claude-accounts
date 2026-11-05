import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { canonical } from "../shared/path.ts";
import { PROVIDERS } from "../shared/providers.ts";
import { defaultCodexDir } from "./discoverCodex.ts";

const run = promisify(execFile);

/** The providers whose command line carries a chat's directory variables. */
export type CliProvider = "claude" | "codex";

/**
 * Where a running chat's CLI process actually runs, read from the process environment
 * (`ps -E`). Paseo starts every agent process with `PASEO_AGENT_ID`, and whatever chose the
 * directories (the daemon, this plugin's hook, a launch command, a shell rc file) has left its
 * variables there. Nothing is logged: other variables in the listing can be secrets.
 *
 * Only the provider's own executable counts. Anything a chat started (Docker Desktop, adb, a dev
 * server) inherits the environment, outlives the session and keeps these variables, so matching
 * on `PASEO_AGENT_ID` alone reports an account the chat may have left long ago.
 *
 * `found: false` means no CLI process for the agent is running. `configDir` is the variable
 * Claude Code keeps its transcript under (`CODEX_HOME` for Codex); null when the process has
 * none. `credentialDir` is the variable that picks the login (Claude only): absent when the
 * process has none, "" for the default directory.
 */
export interface SessionDir {
  found: boolean;
  configDir: string | null;
  credentialDir?: string;
  /** Several CLI processes of the agent disagree about where they run; the newest is reported. */
  ambiguous?: true;
}

/** The runtimes a CLI installed from npm is started through. */
const RUNTIMES = new Set(["node", "bun"]);

/** The script such a runtime is given. */
const SCRIPT: Record<CliProvider, RegExp> = {
  claude: /\/(claude-code|claude-agent-sdk)\/|\/claude(\.js)?$/,
  codex: /\/@openai\/codex\/|\/codex(\.js)?$/,
};

const leaf = (path: string | undefined) => (path ?? "").slice((path ?? "").lastIndexOf("/") + 1);

/** Whether a process line is the provider's CLI itself, the way `ps` shows its command. */
function isCli(words: string[], provider: CliProvider): boolean {
  const first = leaf(words[0]);
  if (first === provider) return true;
  return RUNTIMES.has(first) && SCRIPT[provider].test(words[1] ?? "");
}

/** The directory variables of one process line. A value containing spaces is cut at the first
 *  one; the caller compares the directory with the known ones. */
function readEnvironment(words: string[], provider: CliProvider): { configDir: string | null; credentialDir: string | undefined } {
  const spec = PROVIDERS[provider];
  const valueOf = (name: string) => {
    const word = words.find((candidate) => candidate.startsWith(`${name}=`));
    return word === undefined ? undefined : word.slice(name.length + 1);
  };
  const config = valueOf(spec.configVar);
  return {
    configDir: config === undefined || config === "" ? null : config,
    // Codex's login lives in its config directory: one variable, not two.
    credentialDir: spec.credVar === spec.configVar ? undefined : valueOf(spec.credVar),
  };
}

/** Picks one agent's CLI out of `ps -axE -ww -o command=` output. The newest process is the last
 *  one listed, since `ps` lists by process id. */
export function parseSessionDir(listing: string, agentId: string, provider: CliProvider = "claude"): SessionDir {
  const marker = `PASEO_AGENT_ID=${agentId}`;
  const lines = listing.split("\n");
  const seen: Array<ReturnType<typeof readEnvironment>> = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const words = lines[index]!.split(" ");
    if (words.includes(marker) && isCli(words, provider)) seen.push(readEnvironment(words, provider));
  }
  const newest = seen[0];
  if (newest === undefined) return { found: false, configDir: null };
  const disagree = seen.some((other) => other.configDir !== newest.configDir || other.credentialDir !== newest.credentialDir);
  return {
    found: true,
    configDir: newest.configDir,
    ...(newest.credentialDir === undefined ? {} : { credentialDir: newest.credentialDir }),
    ...(disagree ? { ambiguous: true as const } : {}),
  };
}

/**
 * The directory whose login a running session uses. Claude Code names the Keychain item from
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR` when it is set (empty selects the default directory) and
 * from `CLAUDE_CONFIG_DIR` otherwise, so a chat moved to another account still has its own
 * config directory and a different login.
 */
export function liveLoginDir(live: SessionDir, provider: CliProvider, defaultDir: string): string {
  if (provider === "codex") return canonical(live.configDir ?? defaultCodexDir());
  if (live.credentialDir !== undefined) return canonical(live.credentialDir === "" ? defaultDir : live.credentialDir);
  return canonical(live.configDir ?? defaultDir);
}

/** `parseSessionDir` over a live process listing, shared for a few seconds between callers. A
 *  caller that has just restarted a session asks for a `fresh` listing. */
export function createSessionDirs(
  ttlMs = 10_000,
  list: () => Promise<string> = async () => (await run("ps", ["-axE", "-ww", "-o", "command="], { maxBuffer: 64 * 1024 * 1024 })).stdout,
) {
  let cached: { at: number; listing: Promise<string> } | null = null;
  return async function sessionDir(
    agentId: string,
    options: { provider?: CliProvider; fresh?: boolean } = {},
  ): Promise<SessionDir> {
    if (options.fresh === true || cached === null || Date.now() - cached.at > ttlMs) {
      cached = { at: Date.now(), listing: list().catch(() => "") };
    }
    return parseSessionDir(await cached.listing, agentId, options.provider ?? "claude");
  };
}
