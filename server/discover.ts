export { displayName } from "../shared/naming.ts";
import { displayName } from "../shared/naming.ts";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AccountView } from "../shared/accounts.ts";
import { loginKey } from "../shared/identity.ts";
import { type Identity, parseAuthStatus } from "../shared/parse.ts";
import { type ProviderId, providerForHome } from "../shared/providers.ts";
import { claudeEnv, defaultDir, findClaude, isFile } from "./claude.ts";
import { identifyCodex, listCodexDirs } from "./discoverCodex.ts";

export { claudePaths, defaultDir } from "./claude.ts";

const run = promisify(execFile);

/** A `~/.claude*` sibling that is a config directory rather than some other tool's folder:
 *  Claude Code writes `.claude.json` into every directory it has been run with. */
const PROFILE_NAME = /^\.claude[-_.].+/;

/**
 * Every Claude config directory in the home folder: `~/.claude`, always, and every other
 * `~/.claude*` directory that holds a `.claude.json` — `~/.claude-work`,
 * `~/.claude_personal`, `~/.claude-team-data`, whatever naming scheme the user picked for
 * their `CLAUDE_CONFIG_DIR`s.
 */
export async function listConfigDirs(home: string = homedir()): Promise<string[]> {
  let names: string[] = [];
  try {
    const entries = await readdir(home, { withFileTypes: true });
    names = entries.filter((entry) => entry.isDirectory() && PROFILE_NAME.test(entry.name)).map((entry) => entry.name);
  } catch {
    // An unreadable home folder still has a default directory.
  }
  const profiles: string[] = [];
  for (const name of names.sort()) {
    const dir = join(home, name);
    if (await isFile(join(dir, ".claude.json"))) profiles.push(dir);
  }
  return [defaultDir(home), ...profiles];
}

/**
 * The `.claude-data` directory nearest above a path, if any. Some setups keep one config
 * directory per project, at `<project>/.claude-data`, and point `CLAUDE_CONFIG_DIR` at it
 * from the shell; those directories are offered alongside the home-folder ones.
 */
export async function jobDirFor(start: string, home: string = homedir()): Promise<string | null> {
  let dir = start;
  while (dir.startsWith(`${home}/`)) {
    const candidate = join(dir, ".claude-data");
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // not here; keep walking up
    }
    dir = dirname(dir);
  }
  return null;
}

/** Home-folder directories plus the per-project `.claude-data` of every given project path,
 *  de-duplicated and sorted. */
export async function allConfigDirs(
  projectPaths: readonly string[] = [],
  home: string = homedir(),
): Promise<string[]> {
  const found = new Set(await listConfigDirs(home));
  for (const path of projectPaths) {
    const job = await jobDirFor(path, home);
    if (job !== null) found.add(job);
  }
  return [...found].sort();
}

export interface DirEntry {
  home: string;
  provider: ProviderId;
}

/** Every config directory of every supported provider, Claude's first. */
export async function allDirs(
  projectPaths: readonly string[] = [],
  home: string = homedir(),
): Promise<DirEntry[]> {
  const [claude, codex] = await Promise.all([allConfigDirs(projectPaths, home), listCodexDirs(home)]);
  return [
    ...claude.map((path) => ({ home: path, provider: "claude" as const })),
    ...codex.map((path) => ({ home: path, provider: "codex" as const })),
  ];
}

const loggedOut: Identity = { loggedIn: false, email: "", orgName: "", subscriptionType: "" };

/** `claude auth status --json` output as an identity. Anything that does not parse reads as
 *  logged out. */
export function readIdentity(stdout: unknown): Identity {
  return tryReadIdentity(stdout) ?? loggedOut;
}

/** Null when there was nothing to read, which tells a failure apart from an answer. */
function tryReadIdentity(stdout: unknown): Identity | null {
  if (typeof stdout !== "string" || stdout.trim() === "") return null;
  try {
    return parseAuthStatus(stdout);
  } catch {
    return null;
  }
}

/** Raised when `claude` could not be found at all. A global condition rather than a fact
 *  about one directory, so the pill and the screen report it once instead of showing every
 *  account as logged out. */
export const CLAUDE_NOT_FOUND = "the claude command could not be found";

export function claudeNotFound(): Error {
  return new Error(CLAUDE_NOT_FOUND);
}

export function isClaudeNotFound(error: unknown): boolean {
  return error instanceof Error && error.message === CLAUDE_NOT_FOUND;
}

export interface IdentifyDeps {
  exists(path: string): Promise<boolean>;
  /** Runs `<file> auth status --json` against `dir` and resolves to its stdout. Rejects the
   *  way `execFile` does: `code` is "ENOENT" for a missing file, `stdout` carries whatever
   *  was printed. */
  run(file: string, dir: string, timeoutMs: number): Promise<string>;
  home(): string;
}

export const liveIdentifyDeps: IdentifyDeps = {
  exists: isFile,
  run: async (file, dir, timeoutMs) => {
    const { stdout } = await run(file, ["auth", "status", "--json"], {
      env: claudeEnv(dir),
      timeout: timeoutMs,
    });
    return stdout;
  },
  home: () => homedir(),
};

/**
 * Who a config directory is logged in as.
 *
 * `claude auth status` exits non-zero for a logged-out directory while still printing a
 * valid body, so a body that parses is the answer whatever the exit code. No body and
 * ENOENT means `claude` is missing; any other failure (timeout, EACCES) is rethrown rather
 * than reported as a log-out.
 */
export async function identify(
  dir: string,
  timeoutMs = 15_000,
  deps: IdentifyDeps = liveIdentifyDeps,
): Promise<Identity> {
  const file = await findClaude(deps.home(), deps.exists);
  try {
    return readIdentity(await deps.run(file, dir, timeoutMs));
  } catch (error) {
    const answer = tryReadIdentity((error as { stdout?: unknown }).stdout);
    if (answer !== null) return answer;
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") throw claudeNotFound();
    throw error;
  }
}

/** The row the screen draws for a discovered directory, before usage or grouping is known. */
function toView(dir: string, identity: Identity, provider: ProviderId): AccountView {
  return {
    id: dir,
    name: displayName(dir),
    home: dir,
    provider,
    registered: true,
    key: loginKey(identity, dir),
    loggedIn: identity.loggedIn,
    email: identity.email,
    orgName: identity.orgName,
    subscriptionType: identity.subscriptionType,
    accountIds: [],
    switchTo: "",
    isDefault: false,
    usage: "unauthorised" as const,
    fiveHour: null,
    sevenDay: null,
    usageErrorCode: "" as const,
    usageError: "",
  };
}

export interface Discovery {
  /** Every config directory, with who each one is logged in as. */
  discover(projectPaths?: readonly string[], refresh?: boolean, home?: string): Promise<AccountView[]>;
  /** One directory's identity, from the same cache. */
  identify(dir: string, refresh?: boolean): Promise<Identity>;
  forget(): void;
}

/**
 * Identity, cached per directory for a minute. `claude auth status` costs about a second
 * per directory and the screen polls every thirty seconds; a login changes rarely, and a
 * caller acting on a person's request passes `refresh` to skip the cache.
 */
export function createDiscovery(
  ttlMs = 60_000,
  probe: (dir: string) => Promise<Identity> = identify,
  probeCodex: (dir: string) => Promise<Identity> = (dir) => identifyCodex(dir),
): Discovery {
  const cache = new Map<string, { at: number; identity: Identity }>();

  const proberFor = (dir: string) => (providerForHome(dir) === "codex" ? probeCodex : probe);

  async function identityOf(dir: string, refresh = false): Promise<Identity> {
    const entry = cache.get(dir);
    if (!refresh && entry !== undefined && Date.now() - entry.at < ttlMs) return entry.identity;
    const identity = await proberFor(dir)(dir);
    cache.set(dir, { at: Date.now(), identity });
    return identity;
  }

  return {
    identify: identityOf,
    forget: () => cache.clear(),
    async discover(projectPaths: readonly string[] = [], refresh = false, home: string = homedir()) {
      const entries = await allDirs(projectPaths, home);
      const identities = await Promise.all(entries.map((entry) => identityOf(entry.home, refresh)));
      return entries.map((entry, index) => toView(entry.home, identities[index]!, entry.provider));
    },
  };
}
