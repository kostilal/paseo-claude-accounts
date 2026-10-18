import type { PaseoApi } from "./server/paseo.ts";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  connectAccount,
  fetchUsage,
  listAccounts,
  loginAccount,
  removeAccount,
  unhideAccount,
} from "./shared/accounts.ts";
import { type RefusalCode, getDefaultRpc, refusalText, setDefaultRpc } from "./shared/defaults.ts";
import { detectLocale, t } from "./shared/i18n.ts";
import { uniqueId } from "./shared/naming.ts";
import { canonical } from "./shared/path.ts";
import { PROVIDERS, type ProviderId, isProviderId, providerForHome } from "./shared/providers.ts";
import { type Registry, accountById, registerAccount, removeAccounts, setDefault, unhideHomes } from "./shared/registry.ts";
import { preferences } from "./shared/settings.ts";
import { pillStateRpc, switchAccountRpc, switchAllRpc } from "./shared/switch.ts";
import { createApiKeyCheck } from "./server/apiKey.ts";
import { chatRpc, describeAccounts, describeRpc, readChat } from "./server/capabilities.ts";
import { checkDefault, defaultOptions } from "./server/defaults.ts";
import { allConfigDirs, createDiscovery, defaultDir, displayName, jobDirFor } from "./server/discover.ts";
import { directoryExists, sessionEnv } from "./server/hook.ts";
import { openLogin } from "./server/login.ts";
import { migrateFromTokens } from "./server/migrate.ts";
import { createOverview, createUsageRow } from "./server/overview.ts";
import { pillStateFor } from "./server/pill.ts";
import { createProfiles } from "./server/profile.ts";
import { createSessionDirs } from "./server/sessionDir.ts";
import { createProjects } from "./server/projects.ts";
import { reloadAgent } from "./server/reload.ts";
import { STATE_FILE, loadRegistry, readRegistry, writeRegistry } from "./server/store.ts";
import { switchAccount } from "./server/switchAccount.ts";
import { listChats, switchAll } from "./server/switchAll.ts";
import { createUsage } from "./server/usage.ts";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  const projects = createProjects();
  const usage = createUsage();
  // Who each account's own login belongs to; discovery's answer comes from a cache that chats
  // running on another account rewrite.
  const profiles = createProfiles();
  const discovery = createDiscovery();
  const log = (line: string) => console.error(line);
  const overridingVar = createApiKeyCheck();
  const sessionDir = createSessionDirs();

  // One-time upgrade from 0.1.x: delete the old switching keys and drop their registry fields.
  void migrateFromTokens(STATE_FILE, log);

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

  /** The language the daemon writes messages in: the plugin's setting, else the daemon's. */
  async function serverStrings() {
    const state = await settings.read().catch(() => null);
    const language = state !== null && state.status === "ready" ? state.values.language : "auto";
    return t(language === "auto" ? detectLocale() : language);
  }

  const overviewFor = createOverview({
    discover: (paths, refresh) => discovery.discover(paths, refresh),
    readRegistry,
    projects,
    usage,
    defaultDir,
    profile: (home, refresh) => profiles.identityOf(home, defaultDir(), { refresh }),
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

  server.handle(switchAccountRpc, async (input) => {
    const result = await switchAccount(
      { agentId: input.agentId, accountId: input.account },
      {
        readRegistry,
        writeRegistry: persist,
        exists: directoryExists,
        identify: (home) => discovery.identify(home),
        reload: (agentId) => reloadAgent(agentId),
      },
    );
    // The popover has closed by the time this answers; the log keeps the reason.
    if (result.code !== "") log(`accounts: switching ${input.agentId} to ${input.account} failed (${result.code}) ${result.error}`.trimEnd());
    return result;
  });

  server.handle(switchAllRpc, async (input, { paseo }) => {
    const result = await switchAll(input.account, {
      readRegistry,
      writeRegistry: persist,
      exists: directoryExists,
      identify: (home) => discovery.identify(home),
      chats: () => listChats(paseo),
      reload: (agentId) => reloadAgent(agentId),
    });
    // The screen only has room for counts; the reasons go here.
    if (result.code !== "") log(`accounts: moving all chats to ${input.account} refused (${result.code})`);
    if (result.failed > 0) log(`accounts: ${result.failed} chats kept their account: ${result.error}`);
    return result;
  });

  server.handle(pillStateRpc, async (input, { paseo }) => {
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
        profile: (home) => profiles.identityOf(home, defaultDir()),
      },
    );
    return { ...state, overridingVar: override };
  });

  server.handle(getDefaultRpc, async (input) => {
    const registry = await readRegistry();
    const options = defaultOptions(registry, input.provider);
    const checked = await checkDefault(registry, input.provider, { directoryExists });
    if (checked.state === "unset") return { account: "", problem: "" as const, label: "", options };
    if (checked.state === "ok") return { account: checked.account.id, problem: "" as const, label: checked.account.label, options };
    return { account: checked.id, problem: checked.problem, label: checked.label, options };
  });

  // Only decides where chats opened from now on land; no binding is touched.
  server.handle(setDefaultRpc, async (input) => {
    if (!isProviderId(input.provider) || !PROVIDERS[input.provider].supported) return { code: "unsupported-provider" as const };
    const read = await loadRegistry();
    if (read.state === "unreadable") return { code: "registry-unreadable" as const };
    if (input.account === "") {
      await persist(setDefault(read.registry, input.provider, null));
      return { code: "" as const };
    }
    // Refuse a default the hook could not use, before anything is written.
    const checked = await checkDefault(setDefault(read.registry, input.provider, input.account), input.provider, { directoryExists });
    if (checked.state === "broken") return { code: checked.problem };
    await persist(setDefault(read.registry, input.provider, input.account));
    return { code: "" as const };
  });

  // For God Mode: what an assistant outside Paseo may read and do here, and the chat a switch
  // would restart, so its confirmation names the chat rather than an id.
  server.handle(describeRpc, () => describeAccounts());
  server.handle(chatRpc, (input, { paseo }) => readChat(input.agentId, (id) => paseo.agents.ref(id).refresh()));

  server.before("agent.session_open", async (input) => {
    const strings = await serverStrings();
    const env = await sessionEnv(input.request, {
      readRegistry,
      writeRegistry: persist,
      directoryExists,
      defaultDir,
      // Where a new chat would run without the plugin: an explicit directory, else the
      // project's, else the daemon's. Asked again past the cache before refusing, in case
      // the person has just logged in.
      ownLogin: async (request) => {
        const dir = canonical(request.env.CLAUDE_CONFIG_DIR || (await jobDirFor(request.cwd)) || unboundDir());
        if ((await discovery.identify(dir)).loggedIn) return { dir, loggedIn: true };
        return { dir, loggedIn: (await discovery.identify(dir, true)).loggedIn };
      },
      refusalText: (code: RefusalCode, values) => refusalText(strings, code, values),
      log,
    });
    return env === undefined ? undefined : { ...input.request, env };
  });

  return () => {};
}
