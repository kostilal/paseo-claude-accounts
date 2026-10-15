import type { PaseoApi } from "./server/paseo.ts";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  connectAccount,
  fetchUsage,
  listAccounts,
  loginAccount,
  mintToken,
  removeAccount,
  unhideAccount,
} from "./shared/accounts.ts";
import { uniqueId } from "./shared/naming.ts";
import { parseAuthStatus } from "./shared/parse.ts";
import { canonical } from "./shared/path.ts";
import { PROVIDERS, type ProviderId, isProviderId, providerForHome } from "./shared/providers.ts";
import { type Registry, accountById, registerAccount, removeAccounts, unhideHomes } from "./shared/registry.ts";
import { preferences } from "./shared/settings.ts";
import { pillStateRpc, switchAccountRpc } from "./shared/switch.ts";
import { createApiKeyCheck } from "./server/apiKey.ts";
import { claudeEnv, findClaude } from "./server/claude.ts";
import { allConfigDirs, createDiscovery, defaultDir, displayName, jobDirFor } from "./server/discover.ts";
import { directoryExists, sessionEnv } from "./server/hook.ts";
import { openLogin } from "./server/login.ts";
import { finishMint, validateToken } from "./server/mint.ts";
import { createMints } from "./server/mintTerminal.ts";
import { readMintedToken, writeMintedToken } from "./server/mintedToken.ts";
import { createOverview, createUsageRow } from "./server/overview.ts";
import { pillStateFor } from "./server/pill.ts";
import { createSessionDirs } from "./server/sessionDir.ts";
import { createProjects } from "./server/projects.ts";
import { reloadAgent } from "./server/reload.ts";
import { MINTS_DIR, STATE_FILE, loadRegistry, readRegistry, writeRegistry } from "./server/store.ts";
import { switchAccount } from "./server/switchAccount.ts";
import { createUsage } from "./server/usage.ts";

const run = promisify(execFile);

export default function contribute(server: PluginServerContext) {
  server.registerSettings(preferences);
  const projects = createProjects();
  const usage = createUsage();
  const discovery = createDiscovery();
  const log = (line: string) => console.error(line);
  const overridingVar = createApiKeyCheck();
  const sessionDir = createSessionDirs();

  /** Where a chat that nobody has switched runs: the config directory the daemon would
   *  hand Claude Code, which is `~/.claude` unless the daemon itself was started with
   *  `CLAUDE_CONFIG_DIR` set. */
  const unboundDir = () => process.env.CLAUDE_CONFIG_DIR || defaultDir();

  /** The config directory a chat runs in when nobody has switched it: what its running
   *  process says, else a guess from its working directory, else the daemon's default. */
  async function homeOfChat(agentId: string, cwd: string): Promise<string> {
    const live = await sessionDir(agentId);
    if (live.found) {
      if (live.configDir === null) return defaultDir();
      if (await directoryExists(live.configDir)) return canonical(live.configDir);
    }
    return (await jobDirFor(cwd)) ?? unboundDir();
  }

  const persist = (registry: Registry) => writeRegistry(registry, STATE_FILE, log);

  const overviewFor = createOverview({
    discover: (paths, refresh) => discovery.discover(paths, refresh),
    readRegistry,
    projects,
    usage,
    defaultDir,
    log,
  });

  /** Every config directory the plugin treats as real: everything discovery finds, plus
   *  every registered directory, which may live outside both discovery families. */
  async function knownHomes(api: PaseoApi): Promise<string[]> {
    const [registry, rows] = await Promise.all([readRegistry(), projects.list(api)]);
    const discovered = await allConfigDirs(rows.map((row) => row.path));
    return [...new Set([...registry.accounts.map((account) => account.home), ...discovered])];
  }

  const usageRowFor = createUsageRow({
    knownHomes,
    identify: (dir, refresh) => discovery.identify(dir, refresh),
    usage,
    defaultDir,
  });

  /** The directory an account id names. An unregistered suggestion is addressed by its own
   *  absolute path. */
  async function homeFor(id: string): Promise<{ home: string; provider: ProviderId } | null> {
    if (id.startsWith("/")) return { home: id, provider: providerForHome(id) ?? "claude" };
    const account = accountById(await readRegistry(), id);
    return account === null ? null : { home: account.home, provider: account.provider };
  }

  const mints = createMints({
    dir: MINTS_DIR,
    log,
    finish: (home, transcript) =>
      finishMint(home, transcript, {
        validate: (token) => validateToken(token),
        whoami: async (token) => {
          const { stdout } = await run(await findClaude(), ["auth", "status", "--json"], {
            env: { ...claudeEnv(home), CLAUDE_CODE_OAUTH_TOKEN: token },
            timeout: 15_000,
          });
          return parseAuthStatus(stdout).email;
        },
        identify: (dir) => discovery.identify(dir, true),
        writeToken: (login, token) => writeMintedToken(login, token),
        readRegistry,
        writeRegistry: persist,
      }),
  });
  // Pick up any mint that finished while the plugin was not running, and clear old ones.
  void mints.adopt().catch((error: unknown) => log(`accounts: mint check failed: ${String(error)}`));
  const adopt = () => mints.adopt().catch((error: unknown) => log(`accounts: mint check failed: ${String(error)}`));

  /** A new directory for an account added from the screen, named so discovery finds it. */
  async function freshHome(provider: ProviderId): Promise<string> {
    const stem = provider === "codex" ? ".codex-account-" : ".claude-account-";
    for (let n = 1; ; n += 1) {
      const candidate = join(homedir(), `${stem}${n}`);
      try {
        await stat(candidate);
      } catch {
        return candidate;
      }
    }
  }

  server.handle(listAccounts, async (input, { paseo }) => {
    await adopt();
    const [overview, override] = await Promise.all([overviewFor(paseo, input.refresh, input.force), overridingVar(paseo)]);
    return { ...overview, overridingVar: override };
  });

  server.handle(fetchUsage, async (input, { paseo }) => {
    const found = await homeFor(input.account);
    if (found === null) return usageRowFor(paseo, input.account);
    const row = await usageRowFor(paseo, found.home);
    // `id` is the key the client merges this answer back on, so it is the id that asked.
    // Grouping fields stay empty: this answer is about one directory, and the client merges
    // only the meters and usage errors from it.
    return {
      ...row,
      id: input.account,
      home: found.home,
      provider: found.provider,
      registered: !input.account.startsWith("/"),
    };
  });

  // Registers a directory. With `login`, also creates it and opens a login terminal.
  server.handle(connectAccount, async (input, { paseo }) => {
    const nothing = { account: "", terminal: "" };
    if (!isProviderId(input.provider) || !PROVIDERS[input.provider].supported) {
      return { ...nothing, code: "unsupported-provider" as const, error: "" };
    }
    // Trimmed, because the home is matched against discovery and hashed into a Keychain name.
    const home = input.home === "" ? await freshHome(input.provider) : canonical(input.home);
    if (!home.startsWith("/")) return { ...nothing, code: "not-absolute" as const, error: "" };
    const registry = await readRegistry();
    if (registry.accounts.some((account) => account.home === home)) {
      return { ...nothing, code: "already-registered" as const, error: "" };
    }
    await mkdir(home, { recursive: true });
    const id = uniqueId(displayName(home), new Set(registry.accounts.map((a) => a.id)));
    const account = { id, label: input.label === "" ? id : input.label, provider: input.provider, home };
    await persist(registerAccount(registry, account));
    if (!input.login) return { account: id, terminal: "", code: "" as const, error: "" };
    const opened = await openLogin(paseo, input.provider, account.home, account.label);
    return { account: id, terminal: opened.terminal, code: opened.code, error: opened.error };
  });

  // Forgets accounts. Never deletes a directory, logs anybody out or touches the Keychain.
  server.handle(removeAccount, async (input) => {
    const nothing = { removed: [], hidden: [], error: "" };
    const read = await loadRegistry();
    if (read.state === "unreadable") return { ...nothing, code: "registry-unreadable" as const };
    const result = removeAccounts(read.registry, input.accounts);
    if (!result.ok) return { ...nothing, code: "unknown-account" as const };
    await persist(result.registry);
    return { removed: result.removed, hidden: result.hidden, code: "" as const, error: "" };
  });

  server.handle(unhideAccount, async (input) => {
    const read = await loadRegistry();
    if (read.state === "unreadable") return { restored: [], code: "registry-unreadable" as const, error: "" };
    const result = unhideHomes(read.registry, input.homes);
    if (result.restored.length > 0) await persist(result.registry);
    return { restored: result.restored, code: "" as const, error: "" };
  });

  // Reports that the login terminal started, not that the login finished.
  server.handle(loginAccount, async (input, { paseo }) => {
    const found = await homeFor(input.account);
    if (found === null) return { terminal: "", code: "unknown-account" as const, error: "" };
    try {
      return await openLogin(paseo, found.provider, found.home, displayName(found.home));
    } catch (error) {
      return { terminal: "", code: "" as const, error: error instanceof Error ? error.message : String(error) };
    }
  });

  server.handle(mintToken, async (input, { paseo }) => {
    const home = canonical(input.home);
    const account = (await readRegistry()).accounts.find((candidate) => candidate.home === home);
    if (account === undefined || PROVIDERS[account.provider].switch.kind !== "token") {
      return { terminal: "", code: "unknown-account" as const, error: "" };
    }
    try {
      return await mints.open(paseo, home, account.label, await findClaude());
    } catch (error) {
      return { terminal: "", code: "" as const, error: error instanceof Error ? error.message : String(error) };
    }
  });

  server.handle(switchAccountRpc, async (input) => {
    await adopt();
    return switchAccount(
      { agentId: input.agentId, accountId: input.account },
      {
        readRegistry,
        writeRegistry: persist,
        exists: directoryExists,
        identify: (home) => discovery.identify(home),
        readMintedToken: (login) => readMintedToken(login),
        reload: (agentId) => reloadAgent(agentId),
      },
    );
  });

  server.handle(pillStateRpc, async (input, { paseo }) => {
    await adopt();
    const override = await overridingVar(paseo);
    const state = await pillStateFor(
      { agentId: input.agentId, cwd: input.cwd, manual: input.manual },
      {
        readRegistry,
        projectHome: () => homeOfChat(input.agentId, input.cwd),
        identify: (home) => discovery.identify(home),
        authorised: (home) => usage.authorised(home),
        usageFor: async (home, manual) => {
          const cached = usage.cached(home);
          if (cached !== null && !usage.stale(home)) return cached;
          return usage.measure(home, defaultDir(), manual);
        },
      },
    );
    return { ...state, overridingVar: override };
  });

  server.before("agent.session_open", async (input) => {
    const env = await sessionEnv(input.request, {
      readRegistry,
      readMintedToken: (login) => readMintedToken(login),
      directoryExists,
      log,
    });
    return env === undefined ? undefined : { ...input.request, env };
  });

  return () => {
    mints.stop();
  };
}
