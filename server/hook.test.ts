import { test } from "node:test";
import assert from "node:assert/strict";
import type { Registry } from "../shared/registry.ts";
import { SessionRefused, type SessionRequest, sessionEnv } from "./hook.ts";

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
