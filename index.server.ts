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
  refreshAccountRpc,
  removeAccount,
  snapshotRpc,
  unhideAccount,
} from "./shared/accounts.ts";
import { type RefusalCode, getDefaultRpc, refusalText, setDefaultRpc } from "./shared/defaults.ts";
import { detectLocale, t } from "./shared/i18n.ts";
import { uniqueId } from "./shared/naming.ts";
import { canonical } from "./shared/path.ts";
import { PROVIDERS, type ProviderId, familyOf, isProviderId, providerForHome } from "./shared/providers.ts";
import { type Candidate, pickAuto } from "./shared/auto.ts";
import {
  AUTO,
  type Account,
  type Registry,
  accountById,
  bindWorkspace,
  forgetWorkspace,
  registerAccount,
  removeAccounts,
  setDefault,
  unhideHomes,
  unpinAutomatic,
  workspaceAccount,
} from "./shared/registry.ts";
import { defaultPreferences, preferences } from "./shared/settings.ts";
import { computeForecast, forecastRpc } from "./shared/forecast.ts";
import { claudeProvidersRpc, pillStateRpc, switchAccountRpc, switchAllRpc } from "./shared/switch.ts";
import { workspaceStateRpc } from "./shared/workspace.ts";
import { ACCOUNT_RESOURCE, accountSearchRpc } from "./shared/attach.ts";
import { loginKey, loginLabel } from "./shared/identity.ts";
import type { Identity } from "./shared/parse.ts";
import { judgeApplied } from "./server/applied.ts";
import { createApiKeyCheck } from "./server/apiKey.ts";
import { bounded } from "./server/bounded.ts";
import { chatRpc, describeAccounts, describeRpc, moveCheckRpc } from "./server/capabilities.ts";
import { type ChatFacts, chatFactsOf, readChatAccount, resolveChatAccount } from "./server/chatAccount.ts";
import { checkDefault, defaultOptions } from "./server/defaults.ts";
import { createFamilies } from "./server/families.ts";
import { allConfigDirs, createDiscovery, defaultDir, displayName, jobDirFor } from "./server/discover.ts";
import { ACCOUNT_VAR, directoryExists, sessionEnv, withAskedAccount } from "./server/hook.ts";
import { openLogin } from "./server/login.ts";
import { createChatLimits } from "./server/chatLimits.ts";
import { createHistory } from "./server/history.ts";
import { FRESH_FOR_MS, usedSummary } from "./server/limits.ts";
import { migrateFromTokens } from "./server/migrate.ts";
import { readMoveCheck } from "./server/moveCheck.ts";
import { createOverview, createUsageRow } from "./server/overview.ts";
import { pillStateFor } from "./server/pill.ts";
import { createProfiles, ownLogin } from "./server/profile.ts";
import { type CliProvider, createSessionDirs } from "./server/sessionDir.ts";
import { createSessionLedger } from "./server/sessionLedger.ts";
import { createProjects } from "./server/projects.ts";
import { createReadings } from "./server/readings.ts";
import { createRefreshOne } from "./server/refreshOne.ts";
import { reloadAgent } from "./server/reload.ts";
import { createSerial } from "./server/serial.ts";
import { createSnapshot } from "./server/snapshot.ts";
import { OVERVIEW_SNAPSHOT_FILE, STATE_FILE, USAGE_HISTORY_FILE, USAGE_READINGS_FILE, loadRegistry, readRegistry, writeRegistry } from "./server/store.ts";
import { switchAccount } from "./server/switchAccount.ts";
import { transcriptExists, unsavedSession } from "./server/transcript.ts";
import { listChats, switchAll } from "./server/switchAll.ts";
import { createUsage, liveDeps } from "./server/usage.ts";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  const projects = createProjects();
  // How long a usage reading stands, from the settings; the next poll goes by a changed value.
  let freshForMs = FRESH_FOR_MS;
  // Every reading taken anyway goes into the history the forecast reads; none is taken for it.
  const history = createHistory({ path: USAGE_HISTORY_FILE });
  const usage = createUsage(
    {
      ...liveDeps,
      onReading: (dir, result, measuredAt) => void history.record(dir, result, measuredAt),
      saved: createReadings({ path: USAGE_READINGS_FILE }),
    },
    () => freshForMs,
  );
  // Who each account's own login belongs to; discovery's answer comes from a cache that chats
  // running on another account rewrite.
  const profiles = createProfiles();
  const discovery = createDiscovery();
  const log = (line: string) => console.error(line);
  const snapshot = createSnapshot({ path: OVERVIEW_SNAPSHOT_FILE, log });
  const overridingVar = createApiKeyCheck();
  const sessionDir = createSessionDirs();
  const families = createFamilies();
  // What the session-open hook gave each chat the last time it opened: the one thing that says
  // which account a restarted session took before its process exists.
  const ledger = createSessionLedger();

  // One-time upgrade from 0.1.x: delete the old switching keys and drop their registry fields.
  void migrateFromTokens(STATE_FILE, log);

  /** Where a chat that nobody has switched runs: the config directory the daemon would
   *  hand Claude Code, which is `~/.claude` unless the daemon itself was started with
   *  `CLAUDE_CONFIG_DIR` set. */
  const unboundDir = () => process.env.CLAUDE_CONFIG_DIR || defaultDir();

  /** The config directory a chat runs in when nobody has switched it: what its running
   *  process says, else a guess from its working directory, else the daemon's default. */
  async function homeOfChat(agentId: string, cwd: string, paseo: PaseoApi): Promise<string> {
    const live = await sessionDir(agentId);
    if (live.found) {
      if (live.configDir === null) return defaultDir();
      if (await directoryExists(live.configDir)) return canonical(live.configDir);
    }
    // A closed chat of a profile that pins its directory ("Claude (Work)") runs there.
    const agent = await paseo.agents.ref(agentId).refresh().catch(() => null);
    const pinned = agent === null ? null : (await families.of(paseo, agent.agent.provider))?.configDir;
    if (typeof pinned === "string" && (await directoryExists(pinned))) return canonical(pinned);
    return (await jobDirFor(cwd)) ?? unboundDir();
  }

  const persist = (registry: Registry) => writeRegistry(registry, STATE_FILE, log);
  /** How the pill and the workspace popover read each login and its allowance, so the two never
   *  disagree. */
  const loginDeps = {
    identify: (home: string) => discovery.identify(home),
    authorised: (home: string) => usage.authorised(home),
    usageFor: async (home: string, manual: boolean) => {
      const cached = usage.cached(home);
      if (cached !== null && !usage.stale(home)) return cached;
      return usage.measure(home, defaultDir(), manual);
    },
    info: (home: string) => usage.info(home),
    profile: (home: string) => profiles.identityOf(home, defaultDir()),
  };
  /** One queue for the read-modify-writes this feature adds, so chats starting together and a
   *  workspace being set or archived never write over each other. */
  const serial = createSerial();
  const update = (change: (registry: Registry) => Registry) =>
    serial(async () => {
      const next = change(await readRegistry());
      await persist(next);
      return next;
    });

  /** One account as an automatic pick sees it: null when its directory is gone or it is logged
   *  out, else what is known of its allowance. */
  async function candidateFor(account: Account, meterable: boolean): Promise<Candidate | null> {
    if (!(await directoryExists(account.home))) return null;
    const loggedIn = await discovery.identify(account.home).then((who) => who.loggedIn, () => false);
    if (!loggedIn) return null;
    const cached = usage.cached(account.home);
    const reading = !meterable
      ? null
      : cached !== null && !usage.stale(account.home)
        ? cached
        : await usage.measure(account.home, defaultDir(), false).catch(() => null);
    const known = reading !== null && reading.state === "ok";
    return { account, known, fiveHour: known ? reading.fiveHour : null, sevenDay: known ? reading.sevenDay : null };
  }

  /** The account an automatic pick chooses for a new chat of `provider` now. Each account gets
   *  `AUTO_READ_MS` in all (login check and allowance reading); one that takes longer counts as
   *  unknown, so a slow Keychain, `claude` or network never holds a new chat back for longer. */
  async function autoPick(provider: string): Promise<Account | null> {
    if (!isProviderId(provider) || !PROVIDERS[provider].supported) return null;
    const registry = await readRegistry();
    const meterable = PROVIDERS[provider].meterable;
    const candidates = await Promise.all(
      registry.accounts
        .filter((account) => account.provider === provider)
        .map((account) => {
          const unknown: Candidate = { account, known: false, fiveHour: null, sevenDay: null };
          const gaveUp = new Promise<Candidate>((resolve) => setTimeout(() => resolve(unknown), AUTO_READ_MS).unref?.());
          return Promise.race([candidateFor(account, meterable).catch(() => null), gaveUp]);
        }),
    );
    const policy = (await prefs()).autoPolicy;
    return pickAuto(candidates.filter((candidate): candidate is Candidate => candidate !== null), policy);
  }

  /** The plugin's preferences, or their defaults while they cannot be read. */
  async function prefs() {
    const state = await settings.read().catch(() => null);
    return state !== null && state.status === "ready" ? state.values : defaultPreferences;
  }

  void prefs().then((values) => {
    freshForMs = values.refreshMinutes * MINUTE_MS;
  });
  const stopFollowingSettings = settings.subscribe((state) => {
    if (state.status === "ready") freshForMs = state.values.refreshMinutes * MINUTE_MS;
  });

  /** The language the daemon writes messages in: the plugin's setting, else the daemon's. */
  async function serverStrings() {
    const language = (await prefs()).language;
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

  /** Whether a session's transcript is on disk, looked for in every config directory a chat can
   *  run in: the known ones, the daemon's own and, for one chat, the one its process runs in.
   *  The directories are worked out once per check. Anything that fails counts as found: the
   *  guard must never block a switch because of an error of its own. */
  function transcriptCheck(api: PaseoApi, agentId: string | null) {
    let homes: Promise<string[]> | null = null;
    const homesOnce = () =>
      (homes ??= (async () => {
        const live = agentId === null ? null : await sessionDir(agentId);
        const own = live?.found ? (live.configDir ?? defaultDir()) : null;
        // A profile's pinned directory holds its chats' transcripts, registered or not.
        const pins = Object.values(await families.all(api)).flatMap((family) => (family.configDir === null ? [] : [family.configDir]));
        return [...new Set([...(await knownHomes(api)), unboundDir(), ...pins, ...(own === null ? [] : [own])])];
      })());
    return (sessionId: string) => homesOnce().then((found) => transcriptExists(sessionId, found)).catch(() => true);
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

  /** The chat with exactly this id as Paseo has it, or null. */
  const chatLookup = async (paseo: PaseoApi, agentId: string): Promise<ChatFacts | null> =>
    chatFactsOf(await paseo.agents.ref(agentId).refresh().catch(() => null), agentId, (provider) => families.of(paseo, provider));

  /** Whether restarting the chat now would lose it: its first turn is not on disk yet. */
  const unsavedOf = (paseo: PaseoApi) => (agentId: string, chat: ChatFacts | null) =>
    chat === null
      ? Promise.resolve(false)
      : unsavedSession({ provider: chat.provider, sessionId: chat.sessionId, createdAt: chat.createdAt }, transcriptCheck(paseo, agentId));

  /** What the resolver reads to tell which account a chat is on. */
  const resolveDeps = {
    readRegistry,
    live: (agentId: string, provider: CliProvider) => sessionDir(agentId, { provider }),
    ledger: (agentId: string) => ledger.last(agentId),
    defaultDir,
  };

  /** Whose login an account holds, from Anthropic and not from the cache a chat rewrites. Bounded:
   *  a slow Keychain or `claude` must not hold a read that a person is waiting on. */
  const identityOf = (account: Account, refresh = false): Promise<Identity | null> =>
    bounded(
      discovery
        .identify(account.home, refresh)
        .then((discovered) => ownLogin(account, discovered, (home) => profiles.identityOf(home, defaultDir(), { refresh }))),
      IDENTITY_READ_MS,
      null,
    );

  /** Other registered directories logged in to the same account, the way the Accounts screen
   *  groups them: same email under the same organisation. */
  async function sameLogin(account: Account): Promise<Account[]> {
    const mine = await identityOf(account);
    if (mine === null || mine.email === "") return [];
    const key = loginKey(mine, account.home);
    const others = (await readRegistry()).accounts.filter((other) => other.provider === account.provider && other.id !== account.id);
    const known = await Promise.all(others.map(async (other) => ({ other, who: await identityOf(other) })));
    return known.filter(({ other, who }) => who !== null && loginKey(who, other.home) === key).map(({ other }) => other);
  }

  /** The allowance of the account a chat runs on, and how old it is. */
  const limitsOf = createChatLimits({ usage, defaultDir, siblings: sameLogin, readMs: LIMITS_READ_MS, freshForMs: () => freshForMs });

  const refreshOne = createRefreshOne({
    usage,
    defaultDir,
    account: async (id) => accountById(await readRegistry(), id),
    siblings: sameLogin,
  });

  server.handle(listAccounts, async (input, { paseo }) => {
    const [overview, override] = await Promise.all([overviewFor(paseo, input.refresh, input.force), overridingVar(paseo)]);
    // Under Auto there is no default account to badge; the one Auto would pick now is shown.
    const registry = await readRegistry();
    const now = registry.defaults?.claude === AUTO ? ((await autoPick("claude"))?.id ?? "") : "";
    const accounts = overview.accounts.map((row) => ({ ...row, autoNow: now !== "" && row.accountIds.includes(now) }));
    const answer = { ...overview, accounts, overridingVar: override };
    // Not awaited: the answer does not wait for the disk, and a failed save only logs.
    if (answer.error === "") void snapshot.save(answer);
    return answer;
  });

  server.handle(snapshotRpc, () => snapshot.read());

  server.handle(refreshAccountRpc, (input) => refreshOne(input.account));

  // From the numbers the screen last showed: the forecast asks the usage endpoint nothing itself.
  server.handle(forecastRpc, async (input) => {
    const [saved, registry] = await Promise.all([snapshot.read(), readRegistry()]);
    const rows = saved.overview?.accounts ?? [];
    const readings = new Map(
      await Promise.all(
        rows.map(async (row) => {
          const homes = row.accountIds.map((id) => accountById(registry, id)?.home ?? "").filter((home) => home !== "");
          return [row.key, await history.samplesOf(homes)] as const;
        }),
      ),
    );
    return computeForecast({ ...input, rows, samples: (row) => readings.get(row.key) ?? [], now: Date.now() });
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
    const id = uniqueId(displayName(home), new Set([AUTO, ...registry.accounts.map((a) => a.id)]));
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

  server.handle(switchAccountRpc, async (input, { paseo }) => {
    const result = await switchAccount(
      { agentId: input.agentId, accountId: input.account },
      {
        readRegistry,
        writeRegistry: persist,
        // Through the queue the hook writes by, so a chat bound during the restart is not lost.
        update,
        exists: directoryExists,
        identify: (home) => discovery.identify(home),
        chat: (agentId) => chatLookup(paseo, agentId),
        unsaved: unsavedOf(paseo),
        reload: (agentId) => reloadAgent(agentId),
        // Right after a restart there may be no process yet, so the hook's own record counts first.
        verify: async (_chat, target, since) =>
          judgeApplied({
            record: ledger.last(input.agentId),
            live: await sessionDir(input.agentId, { provider: target.provider, fresh: true }),
            provider: target.provider,
            target,
            defaultDir: defaultDir(),
            since,
          }),
      },
    );
    // The popover has closed by the time this answers; the log keeps the reason.
    if (result.code !== "") log(`accounts: switching ${input.agentId} to ${input.account} failed (${result.code}) ${result.error}`.trimEnd());
    else if (result.applied === "pending" || result.applied === "unverified") {
      log(`accounts: switching ${input.agentId} to ${input.account} is ${result.applied}`);
    }
    return result;
  });

  server.handle(switchAllRpc, async (input, { paseo }) => {
    const result = await switchAll(input.account, {
      readRegistry,
      writeRegistry: persist,
      exists: directoryExists,
      identify: (home) => discovery.identify(home),
      chats: async () => {
        // Fresh: a person pressing this means every chat, a profile added a moment ago included.
        const known = await families.all(paseo, true);
        return (await listChats(paseo)).map((chat) => ({ ...chat, provider: familyOf(chat.provider, known)?.family ?? chat.provider }));
      },
      reload: (agentId) => reloadAgent(agentId),
      hasTranscript: transcriptCheck(paseo, null),
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
        ...loginDeps,
        readRegistry,
        projectHome: () => homeOfChat(input.agentId, input.cwd, paseo),
      },
    );
    return { ...state, overridingVar: override };
  });

  server.handle(getDefaultRpc, async (input) => {
    const registry = await readRegistry();
    const options = defaultOptions(registry, input.provider);
    const checked = await checkDefault(registry, input.provider, { directoryExists });
    if (checked.state === "unset") return { account: "", problem: "" as const, label: "", options };
    if (checked.state === "auto") return { account: AUTO, problem: "" as const, label: "", options };
    if (checked.state === "ok") return { account: checked.account.id, problem: "" as const, label: checked.account.label, options };
    return { account: checked.id, problem: checked.problem, label: checked.label, options };
  });

  // Only decides where chats opened from now on land; no binding is touched.
  server.handle(setDefaultRpc, async (input) => {
    if (!isProviderId(input.provider) || !PROVIDERS[input.provider].supported) return { code: "unsupported-provider" as const };
    const read = await loadRegistry();
    if (read.state === "unreadable") return { code: "registry-unreadable" as const };
    const account = input.account === "" ? null : input.account;
    // The same default again changes nothing: releasing Auto's workspaces now would quietly
    // move their tasks onto a fresh pick.
    if ((read.registry.defaults?.[input.provider] ?? null) === account) return { code: "" as const };
    if (account !== null) {
      // Refuse a default the hook could not use, before anything is written.
      const checked = await checkDefault(setDefault(read.registry, input.provider, account), input.provider, { directoryExists });
      if (checked.state === "broken") return { code: checked.problem };
    }
    // Workspaces an automatic pick placed follow the new default; a person's choice stays.
    await update((registry) => unpinAutomatic(setDefault(registry, input.provider, account), input.provider));
    return { code: "" as const };
  });

  // For God Mode: what an assistant outside Paseo may read and do here, and the chat a switch
  // would restart, so its confirmation names the chat rather than an id.
  server.handle(describeRpc, () => describeAccounts());
  server.handle(chatRpc, (input, { paseo }) =>
    readChatAccount(input, {
      ...resolveDeps,
      chat: (agentId) => chatLookup(paseo, agentId),
      identity: (account) => identityOf(account, input.force),
      limits: limitsOf,
    }),
  );
  server.handle(moveCheckRpc, (input, { paseo }) =>
    readMoveCheck(
      { agentId: input.agentId, accountId: input.account },
      {
        readRegistry,
        chat: (agentId) => chatLookup(paseo, agentId),
        exists: directoryExists,
        identify: (home) => discovery.identify(home),
        unsaved: unsavedOf(paseo),
        current: (chat) => resolveChatAccount(chat, resolveDeps),
        identity: (account) => identityOf(account),
      },
    ),
  );

  // The pill's chats: Claude's own and those of every profile extending it. Rejects when the config
  // cannot be read, so the client asks again rather than taking "no profiles" for an answer.
  server.handle(claudeProvidersRpc, async (_input, { paseo }) => {
    const known = await families.read(paseo);
    return { providers: ["claude", ...Object.keys(known)] };
  });

  server.before("agent.session_open", async (input, { paseo }) => {
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
      autoPick,
      update,
      family: (provider) => families.of(paseo, provider),
      oneAccountPerWorkspace: async () => (await prefs()).oneAccountPerWorkspace,
      // Bounded like a pick: an answer that takes longer is "could not be told".
      loggedIn: (home) =>
        Promise.race([
          discovery.identify(home).then((who) => who.loggedIn, () => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), AUTO_READ_MS).unref?.()),
        ]),
      refusalText: (code: RefusalCode, values) => refusalText(strings, code, values),
      log,
    });
    // Under the provider a profile extends, or its opens would go unrecorded and a switch of its
    // chat could never be told to have taken.
    ledger.note({ ...input.request, provider: await families.name(paseo, input.request.provider) }, env);
    return env === undefined ? undefined : { ...input.request, env };
  });

  /** Every login with its allowance, as the pill lists them, with no chat behind them: `current`
   *  is false throughout, for the caller to set. */
  async function loginRows(registry: Registry, manual: boolean) {
    const state = await pillStateFor(
      { agentId: "", cwd: "", manual },
      { ...loginDeps, readRegistry: async () => registry, projectHome: async () => null },
    );
    return state.accounts;
  }

  // The composer's "Claude account" attachment: Auto, then every logged-in Claude login.
  server.handle(accountSearchRpc, async (input) => {
    const strings = await serverStrings();
    const query = input.query.trim().toLowerCase();
    const rows = (await loginRows(await readRegistry(), false)).filter((row) => row.provider === "claude" && row.loggedIn);
    const items = [
      {
        id: AUTO,
        identifier: strings.workspaceAutoNone,
        title: strings.attachAutoTitle,
        url: USAGE_URL,
        text: strings.attachAutoText,
        resourceType: ACCOUNT_RESOURCE,
      },
      ...rows.map((row) => {
        const name = loginLabel({ email: row.email, orgName: row.orgName, plan: "" }, row.label);
        return {
          id: row.switchTo,
          identifier: row.label,
          title: name,
          subtitle: usedSummary(row.fiveHour, row.sevenDay, strings),
          url: USAGE_URL,
          // The label rather than the login: this text goes into the chat's prompt.
          text: strings.attachAccountText.replace("{label}", row.label),
          resourceType: ACCOUNT_RESOURCE,
        };
      }),
    ];
    const matching = query === "" ? items : items.filter((item) => `${item.identifier} ${item.title}`.toLowerCase().includes(query));
    return { items: matching };
  });

  // A new workspace's first chat: its "Claude account" attachment becomes its environment.
  server.before("workspace.create", ({ request }) => {
    const next = withAskedAccount(request);
    if (next !== undefined) log(`accounts: a new workspace's first chat asks for ${next.agent?.env?.[ACCOUNT_VAR] ?? ""}`);
    return next;
  });

  server.handle(workspaceStateRpc, async (input) => {
    const registry = await readRegistry();
    const own = workspaceAccount(registry, input.workspaceId, input.provider);
    const checked = await checkDefault(registry, input.provider, { directoryExists });
    const next =
      checked.state === "auto"
        ? { source: "auto" as const, account: (await autoPick(input.provider))?.id ?? "" }
        : checked.state === "ok"
          ? { source: "default" as const, account: checked.account.id }
          : checked.state === "broken"
            ? { source: "default" as const, account: checked.id }
            : { source: "folder" as const, account: "" };
    const accounts = (await loginRows(registry, input.manual))
      .filter((row) => row.provider === input.provider)
      .map((row) => ({ ...row, current: own !== null && row.accountIds.includes(own.id) }));
    return { account: own?.id ?? "", default: registry.defaults?.[input.provider] ?? "", next, accounts };
  });

  // An archived workspace takes no new chats, so its accounts would only pile up.
  server.on("workspace.archived", async ({ workspace }) => {
    const read = await loadRegistry();
    if (read.state === "unreadable" || read.registry.workspaces?.[workspace.id] === undefined) return;
    await update((registry) => forgetWorkspace(registry, workspace.id));
  });

  return () => stopFollowingSettings();
}

/** Where a "Claude account" attachment links to: the subscription's own usage page. */
const USAGE_URL = "https://claude.ai/settings/usage";

/** How long an automatic pick waits on one account before treating its allowance as unknown. */
const AUTO_READ_MS = 3_000;

/** How long a chat's account waits for whose login it holds, and for one reading of its
 *  allowance, before answering with what it has. A plugin call is abandoned at 30 s. */
const IDENTITY_READ_MS = 4_000;
const LIMITS_READ_MS = 9_000;

const MINUTE_MS = 60_000;
