import { test } from "node:test";
import assert from "node:assert/strict";
import type { Registry } from "../shared/registry.ts";
import { SessionRefused, type SessionRequest, sessionEnv, withAskedAccount } from "./hook.ts";

/** A default directory none of the test accounts live in, so a credential value is the account's
 *  path rather than the empty string that selects the default item. */
const DEFAULT_DIR = "/root/.claude";

const work = { id: "work", label: "Work", provider: "claude" as const, home: "/w/acme/.claude-data" };

function registry(overrides: Partial<Registry> = {}): Registry {
  return {
    version: 2,
    accounts: [work],
    // Both agent ids the requests below use.
    agents: { ag1: "work", a1: "work" },
    ...overrides,
  };
}

function request(overrides: Partial<SessionRequest> = {}): SessionRequest {
  return {
    agentId: "ag1",
    workspaceId: "wks_1",
    provider: "claude",
    cwd: "/w/acme/app",
    env: { PATH: "/usr/bin" },
    ...overrides,
  };
}

type Deps = Parameters<typeof sessionEnv>[1];

function deps(overrides: Partial<Deps> = {}): Deps {
  let stored = registry();
  return {
    readRegistry: async () => stored,
    writeRegistry: async (next: Registry) => {
      stored = next;
    },
    directoryExists: async () => true,
    defaultDir: () => DEFAULT_DIR,
    ...overrides,
  } as Deps;
}

test("a bound account points the session at its credential directory, keeping its own config dir", async () => {
  const env = await sessionEnv(
    { agentId: "ag1", workspaceId: "w1", provider: "claude", cwd: "/w/acme", env: { PATH: "/bin" } },
    deps(),
  );
  // Only the credential variable is set; the session keeps its own config directory.
  assert.deepEqual(env, { PATH: "/bin", CLAUDE_SECURESTORAGE_CONFIG_DIR: "/w/acme/.claude-data" });
});

test("a bound account whose directory is gone leaves the session alone", async () => {
  const env = await sessionEnv(request(), deps({ directoryExists: async () => false }));
  assert.equal(env, undefined);
});

// The default account: set in the settings or by "Move all chats here"; new chats open on it.

const keyed = { ...work, id: "keyed", label: "Team", home: "/Users/me/.claude-team" };

function defaulted(
  options: {
    agents?: Record<string, string>;
    defaults?: Record<string, string>;
    accounts?: Registry["accounts"];
    exists?: boolean;
    own?: { dir: string; loggedIn: boolean | null };
  } = {},
) {
  let stored: Registry = registry({
    accounts: options.accounts ?? [work, keyed],
    agents: options.agents ?? {},
    defaults: options.defaults ?? { claude: "keyed" },
  });
  const lines: string[] = [];
  const d: Deps = {
    readRegistry: async () => stored,
    writeRegistry: async (next: Registry) => {
      stored = next;
    },
    directoryExists: async () => options.exists ?? true,
    defaultDir: () => DEFAULT_DIR,
    ownLogin: async () => options.own ?? { dir: "/w/acme/.claude-data", loggedIn: true },
    refusalText: (code, values) => `${code}|${values.label ?? ""}|${values.dir ?? ""}`,
    log: (line) => lines.push(line),
  } as Deps;
  return { deps: d, stored: () => stored, lines };
}

const created = (overrides: Partial<SessionRequest> = {}) => request({ agentId: "new", reason: "create", ...overrides });

async function refusal(promise: Promise<unknown>): Promise<SessionRefused> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof SessionRefused, `expected a refusal, got ${String(error)}`);
    return error;
  }
  assert.fail("the session was not refused");
}

test("a new chat with no binding opens on the default account and is bound to it", async () => {
  const fake = defaulted();
  const env = await sessionEnv(created(), fake.deps);
  assert.equal(env?.CLAUDE_SECURESTORAGE_CONFIG_DIR, "/Users/me/.claude-team");
  assert.equal(env?.PATH, "/usr/bin", "Paseo's own environment is kept");
  assert.equal(fake.stored().agents.new, "keyed");
});

test("the default wins over a logged-in project directory for a new chat", async () => {
  const fake = defaulted({ own: { dir: "/w/acme/.claude-data", loggedIn: true } });
  assert.equal((await sessionEnv(created(), fake.deps))?.CLAUDE_SECURESTORAGE_CONFIG_DIR, "/Users/me/.claude-team");
});

test("an existing chat with no binding is not moved onto a default chosen later", async () => {
  for (const reason of ["resume", "refresh", "import"] as const) {
    const fake = defaulted();
    assert.equal(await sessionEnv(request({ agentId: "old", reason }), fake.deps), undefined, reason);
    assert.equal("old" in fake.stored().agents, false, reason);
  }
});

test("an existing chat whose default is broken still opens: only new chats are refused", async () => {
  const fake = defaulted({ exists: false });
  assert.equal(await sessionEnv(request({ agentId: "old", reason: "resume" }), fake.deps), undefined);
});

test("a chat bound by hand keeps its account over the default", async () => {
  const fake = defaulted({ agents: { mine: "work" } });
  const env = await sessionEnv(request({ agentId: "mine", reason: "create" }), fake.deps);
  assert.equal(env?.CLAUDE_SECURESTORAGE_CONFIG_DIR, "/w/acme/.claude-data");
  assert.equal(fake.stored().agents.mine, "work");
});

test("with several accounts each new chat lands on the one chosen as default", async () => {
  const other = { ...keyed, id: "other", label: "Other", home: "/Users/me/.claude-bob" };
  for (const [chosen, dir] of [["keyed", "/Users/me/.claude-team"], ["other", "/Users/me/.claude-bob"]] as const) {
    const fake = defaulted({ accounts: [work, keyed, other], defaults: { claude: chosen } });
    const env = await sessionEnv(created(), fake.deps);
    assert.equal(env?.CLAUDE_SECURESTORAGE_CONFIG_DIR, dir);
    assert.equal(fake.stored().agents.new, chosen);
  }
});

test("a default whose directory is gone refuses the new chat and binds nothing", async () => {
  const fake = defaulted({ exists: false });
  const refused = await refusal(sessionEnv(created(), fake.deps));
  assert.equal(refused.code, "missing-directory");
  assert.equal(refused.message, "missing-directory|Team|");
  assert.equal("new" in fake.stored().agents, false);
});

test("a default naming a removed account refuses the new chat", async () => {
  const fake = defaulted({ defaults: { claude: "gone" } });
  assert.equal((await refusal(sessionEnv(created(), fake.deps))).code, "unknown-account");
});

test("a default for another provider is not applied", async () => {
  const fake = defaulted({ defaults: { codex: "keyed" } });
  assert.equal(await sessionEnv(created(), fake.deps), undefined);
  assert.equal("new" in fake.stored().agents, false);
});

test("no default and a logged-in directory: the new chat opens on its own login", async () => {
  const fake = defaulted({ defaults: {} });
  assert.equal(await sessionEnv(created(), fake.deps), undefined);
  assert.equal("new" in fake.stored().agents, false);
});

test("no default and a logged-out directory: the new chat is refused and asked to choose", async () => {
  const fake = defaulted({ defaults: {}, own: { dir: "/w/evo/.claude-data", loggedIn: false } });
  const refused = await refusal(sessionEnv(created(), fake.deps));
  assert.equal(refused.code, "not-set");
  assert.equal(refused.message, "not-set||/w/evo/.claude-data");
  assert.match(fake.lines.join("\n"), /refused to start new \(not-set\)/);
});

test("no accounts and a logged-out directory: the refusal says to add one", async () => {
  const fake = defaulted({ defaults: {}, accounts: [], own: { dir: "/w/evo/.claude-data", loggedIn: false } });
  assert.equal((await refusal(sessionEnv(created(), fake.deps))).code, "no-accounts");
});

test("a login state that could not be read does not refuse the chat", async () => {
  const fake = defaulted({ defaults: {}, own: { dir: "/w/evo/.claude-data", loggedIn: null } });
  assert.equal(await sessionEnv(created(), fake.deps), undefined);
  const failing = defaulted({ defaults: {} });
  const env = await sessionEnv(created(), {
    ...failing.deps,
    ownLogin: async () => {
      throw new Error("the claude command could not be found");
    },
  });
  assert.equal(env, undefined);
});

test("a provider this plugin does not know is left alone", async () => {
  assert.equal(await sessionEnv(request({ provider: "copilot" }), deps()), undefined);
});

test("an unrecognised provider is rejected before the registry is ever read", async () => {
  let asked = false;
  const answer = await sessionEnv(request({ provider: "copilot" }), {
    ...deps(),
    readRegistry: async () => {
      asked = true;
      return registry();
    },
  });
  assert.equal(answer, undefined);
  assert.equal(asked, false);
});

test("an account for another provider cannot apply to this session", async () => {
  const codex = { ...work, id: "cdx", provider: "codex" as const, home: "/w/.codex" };
  const mixed = registry({ accounts: [codex], agents: { ag1: "cdx" } });
  assert.equal(await sessionEnv(request(), deps({ readRegistry: async () => mixed })), undefined);
});

test("nothing bound leaves the session exactly as Paseo built it", async () => {
  const bare = registry({ agents: {} });
  assert.equal(await sessionEnv(request(), deps({ readRegistry: async () => bare })), undefined);
});

test("a failure anywhere is a no-op, not a session that will not start", async () => {
  const boom = deps({
    readRegistry: async () => {
      throw new Error("disk on fire");
    },
  });
  assert.equal(await sessionEnv(request(), boom), undefined);
});

test("every failure the hook can hit says so once and leaves the session alone", async () => {
  const lines: string[] = [];
  const failures: Array<Partial<Deps>> = [
    {
      readRegistry: async () => {
        throw new Error("disk on fire");
      },
    },
    {
      directoryExists: async () => {
        throw new Error("the disk will not answer");
      },
    },
  ];
  for (const failure of failures) {
    const answer = await sessionEnv(request(), deps({ ...failure, log: (line) => lines.push(line) }));
    // A session on the wrong account beats a session that does not start.
    assert.equal(answer, undefined);
  }
  assert.equal(lines.length, failures.length);
  for (const line of lines) assert.match(line, /leaving the session alone/);
});

const codexAccount = { id: "cdx", label: "Codex", provider: "codex" as const, home: "/w/.codex-work" };

test("a codex session is pointed at its directory", async () => {
  const bound = registry({ accounts: [codexAccount], agents: { ag1: "cdx" } });
  const answer = await sessionEnv(request({ provider: "codex" }), deps({ readRegistry: async () => bound }));
  assert.deepEqual(answer, { PATH: "/usr/bin", CODEX_HOME: "/w/.codex-work" });
});

test("a codex directory that is gone leaves the session alone", async () => {
  const gone = { ...codexAccount, home: "/w/gone" };
  const answer = await sessionEnv(request({ provider: "codex" }), {
    ...deps({ readRegistry: async () => registry({ accounts: [gone], agents: { ag1: "cdx" } }) }),
    directoryExists: async () => false,
  });
  assert.equal(answer, undefined);
});

// Choosing the account at the start: the environment, the workspace, an automatic default.

const home = { ...work, id: "home", label: "Home", home: "/Users/me/.claude" };

function starting(
  options: {
    defaults?: Record<string, string>;
    workspaces?: Registry["workspaces"];
    exists?: (path: string) => boolean;
    pick?: string | null;
  } = {},
) {
  let stored: Registry = registry({
    accounts: [work, keyed, home],
    agents: {},
    defaults: options.defaults ?? {},
    ...(options.workspaces === undefined ? {} : { workspaces: options.workspaces }),
  });
  const picks: string[] = [];
  const d: Deps = {
    readRegistry: async () => stored,
    writeRegistry: async (next: Registry) => {
      stored = next;
    },
    directoryExists: async (path) => options.exists?.(path) ?? true,
    defaultDir: () => DEFAULT_DIR,
    ownLogin: async () => ({ dir: "/w/acme/.claude-data", loggedIn: true }),
    autoPick: async (provider) => {
      picks.push(provider);
      const id = options.pick === undefined ? "home" : options.pick;
      return id === null ? null : (stored.accounts.find((account) => account.id === id) ?? null);
    },
    refusalText: (code, values) => `${code}|${values.label ?? ""}|${values.dir ?? ""}`,
    log: () => {},
  } as Deps;
  return { deps: d, stored: () => stored, picks };
}

const credentialOf = (env: Record<string, string> | undefined) => env?.CLAUDE_SECURESTORAGE_CONFIG_DIR;

test("an automatic default opens a new chat on the picked account and gives it to the workspace", async () => {
  const fake = starting({ defaults: { claude: "@auto" } });
  const env = await sessionEnv(created(), fake.deps);
  assert.equal(credentialOf(env), "/Users/me/.claude");
  assert.equal(fake.stored().agents.new, "home");
  assert.deepEqual(fake.stored().workspaces, { wks_1: { claude: "home" } });
});

test("the next chat in the workspace follows the first one rather than a fresh pick", async () => {
  const fake = starting({ defaults: { claude: "@auto" }, workspaces: { wks_1: { claude: "keyed" } }, pick: "home" });
  const env = await sessionEnv(created({ agentId: "second" }), fake.deps);
  assert.equal(credentialOf(env), "/Users/me/.claude-team");
  assert.equal(fake.stored().agents.second, "keyed");
  assert.deepEqual(fake.picks, [], "no pick is made while the workspace has an account");
});

test("a chat in another workspace is picked afresh", async () => {
  const fake = starting({ defaults: { claude: "@auto" }, workspaces: { wks_1: { claude: "keyed" } }, pick: "home" });
  const env = await sessionEnv(created({ workspaceId: "wks_2" }), fake.deps);
  assert.equal(credentialOf(env), "/Users/me/.claude");
  assert.equal(fake.stored().workspaces?.wks_2?.claude, "home");
  assert.equal(fake.stored().workspaces?.wks_1?.claude, "keyed", "the other workspace keeps its account");
});

test("the workspace's account wins over a fixed default too", async () => {
  const fake = starting({ defaults: { claude: "keyed" }, workspaces: { wks_1: { claude: "home" } } });
  assert.equal(credentialOf(await sessionEnv(created(), fake.deps)), "/Users/me/.claude");
});

test("a fixed default does not pin the workspace: changing the default still moves new chats", async () => {
  const fake = starting({ defaults: { claude: "keyed" } });
  await sessionEnv(created(), fake.deps);
  assert.equal(fake.stored().workspaces, undefined);
});

test("a workspace account whose directory is gone is passed over, not refused", async () => {
  const fake = starting({
    defaults: { claude: "keyed" },
    workspaces: { wks_1: { claude: "home" } },
    exists: (path) => path !== "/Users/me/.claude",
  });
  assert.equal(credentialOf(await sessionEnv(created(), fake.deps)), "/Users/me/.claude-team");
});

test("a workspace account of another provider is not applied to this chat", async () => {
  const fake = starting({ defaults: { claude: "keyed" }, workspaces: { wks_1: { codex: "home" } } });
  assert.equal(credentialOf(await sessionEnv(created(), fake.deps)), "/Users/me/.claude-team");
});

test("a chat with no workspace is picked but pins nothing", async () => {
  const fake = starting({ defaults: { claude: "@auto" } });
  const env = await sessionEnv(created({ workspaceId: null }), fake.deps);
  assert.equal(credentialOf(env), "/Users/me/.claude");
  assert.equal(fake.stored().workspaces, undefined);
});

test("an automatic default with nothing to pick falls back to the chat's own folder", async () => {
  const fake = starting({ defaults: { claude: "@auto" }, pick: null });
  assert.equal(await sessionEnv(created(), fake.deps), undefined);
  assert.equal("new" in fake.stored().agents, false);
});

test("the environment's account wins over the workspace and the default, and pins the workspace", async () => {
  const fake = starting({ defaults: { claude: "home" } });
  const env = await sessionEnv(created({ env: { PATH: "/usr/bin", PASEO_CLAUDE_ACCOUNT: "keyed" } }), fake.deps);
  assert.equal(credentialOf(env), "/Users/me/.claude-team");
  assert.equal(env?.PASEO_CLAUDE_ACCOUNT, "keyed", "kept, so chats the agent starts follow it");
  assert.equal(fake.stored().workspaces?.wks_1?.claude, "keyed");
});

test("the environment's account wins over a workspace that already has one, without repinning it", async () => {
  const fake = starting({ workspaces: { wks_1: { claude: "home" } } });
  const env = await sessionEnv(created({ env: { PASEO_CLAUDE_ACCOUNT: "keyed" } }), fake.deps);
  assert.equal(credentialOf(env), "/Users/me/.claude-team");
  assert.equal(fake.stored().workspaces?.wks_1?.claude, "home");
});

test("the environment can ask for an automatic pick whatever the default", async () => {
  const fake = starting({ defaults: { claude: "keyed" } });
  const env = await sessionEnv(created({ env: { PASEO_CLAUDE_ACCOUNT: "@auto" } }), fake.deps);
  assert.equal(credentialOf(env), "/Users/me/.claude");
  assert.deepEqual(fake.picks, ["claude"]);
  assert.equal(fake.stored().workspaces?.wks_1?.claude, "home");
});

test("an automatic pick asked for by the environment still follows a pinned workspace", async () => {
  const fake = starting({ workspaces: { wks_1: { claude: "keyed" } } });
  const env = await sessionEnv(created({ env: { PASEO_CLAUDE_ACCOUNT: "@auto" } }), fake.deps);
  assert.equal(credentialOf(env), "/Users/me/.claude-team");
  assert.deepEqual(fake.picks, []);
});

test("the environment's account is ignored by chats of other providers", async () => {
  const fake = starting();
  const env = await sessionEnv(created({ provider: "codex", env: { PASEO_CLAUDE_ACCOUNT: "keyed" } }), fake.deps);
  assert.equal(env, undefined, "not refused: a Claude account means nothing to a Codex chat");
});

test("a workspace account that is logged out is passed over", async () => {
  const fake = starting({ defaults: { claude: "keyed" }, workspaces: { wks_1: { claude: "home" } } });
  const deps = { ...fake.deps, loggedIn: async (dir: string) => dir !== "/Users/me/.claude" };
  assert.equal(credentialOf(await sessionEnv(created(), deps)), "/Users/me/.claude-team");
});

test("an automatic default with nothing to pick and no own login says so, not that no default is set", async () => {
  const fake = starting({ defaults: { claude: "@auto" }, pick: null });
  const deps = { ...fake.deps, ownLogin: async () => ({ dir: "/w/acme/.claude-data", loggedIn: false }) };
  assert.equal((await refusal(sessionEnv(created(), deps))).code, "auto-none");
});

test("two chats picked at once in one workspace land on one account", async () => {
  // Each pick waits, so both start before either writes; the second pick would differ.
  const fake = starting({ defaults: { claude: "@auto" } });
  let stored = fake.stored();
  let queue: Promise<unknown> = Promise.resolve();
  const answers = ["home", "keyed"];
  const deps: Deps = {
    ...fake.deps,
    // A read that takes a moment, as the state file's does: without one queue for the
    // read-modify-write, both chats read before either writes, and one binding is lost.
    readRegistry: async () => {
      const seen = stored;
      await new Promise((resolve) => setImmediate(resolve));
      return seen;
    },
    writeRegistry: async (next: Registry) => {
      stored = next;
    },
    autoPick: async () => {
      const id = answers.shift()!;
      await new Promise((resolve) => setImmediate(resolve));
      return stored.accounts.find((account) => account.id === id) ?? null;
    },
    update: (change) => {
      const run = queue.then(async () => {
        stored = change(stored);
        return stored;
      });
      queue = run;
      return run;
    },
  };
  const [first, second] = await Promise.all([
    sessionEnv(created({ agentId: "first" }), deps),
    sessionEnv(created({ agentId: "second" }), deps),
  ]);
  assert.equal(credentialOf(first), credentialOf(second));
  assert.ok(stored.agents.first !== undefined && stored.agents.second !== undefined, "both bindings kept");
  assert.equal(stored.agents.first, stored.agents.second);
  assert.equal(stored.workspaces?.wks_1?.claude, stored.agents.first);
});

test("two chats picked one after the other in a workspace land on the first pick", async () => {
  const fake = starting({ defaults: { claude: "@auto" }, pick: "home" });
  await sessionEnv(created({ agentId: "first" }), fake.deps);
  const later = { ...fake.deps, autoPick: async () => fake.stored().accounts.find((account) => account.id === "keyed")! };
  assert.equal(credentialOf(await sessionEnv(created({ agentId: "second" }), later)), "/Users/me/.claude");
  assert.equal(fake.stored().agents.second, "home");
});

test("an account the environment names but cannot be used refuses the chat", async () => {
  const unknown = starting();
  const refused = await refusal(sessionEnv(created({ env: { PASEO_CLAUDE_ACCOUNT: "nope" } }), unknown.deps));
  assert.equal(refused.code, "asked-unknown");
  assert.equal("new" in unknown.stored().agents, false, "nothing is written");

  const gone = starting({ exists: (path) => path !== "/Users/me/.claude-team" });
  const missing = await refusal(sessionEnv(created({ env: { PASEO_CLAUDE_ACCOUNT: "keyed" } }), gone.deps));
  assert.equal(missing.code, "asked-missing-directory");
});

test("an existing chat is not moved by its environment, its workspace or an automatic default", async () => {
  const fake = starting({ defaults: { claude: "@auto" }, workspaces: { wks_1: { claude: "keyed" } } });
  for (const reason of ["resume", "refresh", "import"] as const) {
    const env = await sessionEnv(request({ agentId: "old", reason, env: { PASEO_CLAUDE_ACCOUNT: "keyed" } }), fake.deps);
    assert.equal(env, undefined, reason);
  }
  assert.deepEqual(fake.picks, []);
});

test("under Auto, a workspace pinned to a logged-out account gets the pick, and the pin is replaced", async () => {
  const fake = starting({ defaults: { claude: "@auto" }, workspaces: { wks_1: { claude: "keyed" } }, pick: "home" });
  const deps = { ...fake.deps, loggedIn: async (dir: string) => dir !== "/Users/me/.claude-team" };
  assert.equal(credentialOf(await sessionEnv(created(), deps)), "/Users/me/.claude");
  assert.equal(fake.stored().agents.new, "home");
  assert.equal(fake.stored().workspaces?.wks_1?.claude, "home");
});

// The new-workspace screen: a "Claude account" attachment becomes the first chat's environment.

const attachment = (id: string) => ({
  type: "text",
  mimeType: "text/plain",
  text: "…",
  externalResource: { provider: "claude-accounts", resourceType: "claude-account", id, identifier: id, title: id, url: "https://claude.ai" },
});

test("an attachment on the first chat of a new workspace puts the account in its environment", () => {
  const next = withAskedAccount({ title: "t", agent: { env: { PATH: "/bin" }, attachments: [attachment("keyed")] } });
  assert.deepEqual(next?.agent?.env, { PATH: "/bin", PASEO_CLAUDE_ACCOUNT: "keyed" });
  assert.equal(next?.title, "t", "the rest of the request is kept");
});

test("the attachment is also found in the first chat's context", () => {
  const next = withAskedAccount({ agent: { env: {} as Record<string, string> }, firstAgentContext: { attachments: [attachment("@auto")] } });
  assert.equal(next?.agent?.env?.PASEO_CLAUDE_ACCOUNT, "@auto");
});

test("no attachment, no first chat, or an environment that already names an account: left alone", () => {
  assert.equal(withAskedAccount({ agent: { attachments: [] } }), undefined);
  assert.equal(withAskedAccount({ firstAgentContext: { attachments: [attachment("keyed")] } }), undefined);
  assert.equal(
    withAskedAccount({ agent: { env: { PASEO_CLAUDE_ACCOUNT: "home" }, attachments: [attachment("keyed")] } }),
    undefined,
  );
});
