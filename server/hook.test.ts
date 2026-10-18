import { test } from "node:test";
import assert from "node:assert/strict";
import type { PaseoApi } from "./paseo.ts";
import type { Registry } from "../shared/registry.ts";
import { SessionRefused, type SessionRequest, sessionEnv } from "./hook.ts";

const paseo = {} as PaseoApi;

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

/** The registry these deps return binds a copy of `work` that has a token login;
 *  `registry()` alone has none. */
function deps(options: { token: string | null }) {
  return {
    readRegistry: async () => registry({ accounts: [{ ...work, tokenLogin: "alice@example.com" }] }),
    writeRegistry: async () => {},
    readMintedToken: async () => options.token,
    directoryExists: async () => true,
  } as unknown as Parameters<typeof sessionEnv>[1];
}

test("a bound account contributes its token and no directory", async () => {
  const env = await sessionEnv(
    { agentId: "ag1", workspaceId: "w1", provider: "claude", cwd: "/w/acme", env: { PATH: "/bin" } },
    deps({ token: "sk-ant-oat01-example" }),
  );
  assert.deepEqual(env, { PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-example" });
});

test("two accounts on one email in different organisations each read their own token", async () => {
  // A personal plan and a Team seat share the address; each has its own Keychain item.
  const personal = { ...work, id: "personal", tokenLogin: "alice@example.com", tokenOrg: "org-personal" };
  const team = { ...work, id: "team", home: "/w/team/.claude-data", tokenLogin: "alice@example.com", tokenOrg: "org-team" };
  const items: Record<string, string> = {
    "alice@example.com/org-personal": "sk-ant-oat01-personal",
    "alice@example.com/org-team": "sk-ant-oat01-team",
  };
  const env = async (agentId: string) =>
    sessionEnv(request({ agentId }), {
      readRegistry: async () => registry({ accounts: [personal, team], agents: { p: "personal", t: "team" } }),
      writeRegistry: async () => {},
      readMintedToken: async (key) => items[key] ?? null,
      directoryExists: async () => true,
    });
  assert.equal((await env("p"))?.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat01-personal");
  assert.equal((await env("t"))?.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat01-team");
});

test("a token minted before organisations were recorded is still read under the bare email", async () => {
  const asked: string[] = [];
  await sessionEnv(request(), {
    ...deps({ token: "sk-ant-oat01-example" }),
    readMintedToken: async (key) => {
      asked.push(key);
      return "sk-ant-oat01-example";
    },
  });
  assert.deepEqual(asked, ["alice@example.com"]);
});

// The default account: set in the settings or by "Move all chats here"; new chats open on it.

const keyed = { ...work, id: "keyed", label: "Team", home: "/Users/me/.claude", tokenLogin: "alice@example.com", tokenOrg: "org-team" };

function defaulted(
  options: {
    agents?: Record<string, string>;
    token?: string | null;
    defaults?: Record<string, string>;
    accounts?: Registry["accounts"];
    check?: "ok" | "rejected" | "unknown";
    own?: { dir: string; loggedIn: boolean | null };
  } = {},
) {
  let stored: Registry = registry({
    accounts: options.accounts ?? [work, keyed],
    agents: options.agents ?? {},
    defaults: options.defaults ?? { claude: "keyed" },
  });
  const lines: string[] = [];
  const deps: Parameters<typeof sessionEnv>[1] = {
    readRegistry: async () => stored,
    writeRegistry: async (next: Registry) => {
      stored = next;
    },
    readMintedToken: async () => (options.token === undefined ? "sk-ant-oat01-team" : options.token),
    directoryExists: async () => true,
    checkToken: async () => options.check ?? "ok",
    ownLogin: async () => options.own ?? { dir: "/w/acme/.claude-data", loggedIn: true },
    refusalText: (code, values) => `${code}|${values.label ?? ""}|${values.dir ?? ""}`,
    log: (line) => lines.push(line),
  };
  return { deps, stored: () => stored, lines };
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
  assert.equal(env?.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat01-team");
  assert.equal(env?.PATH, "/usr/bin", "Paseo's own environment is kept");
  assert.equal(fake.stored().agents.new, "keyed");
});

test("the default wins over a logged-in project directory for a new chat", async () => {
  const fake = defaulted({ own: { dir: "/w/acme/.claude-data", loggedIn: true } });
  assert.equal((await sessionEnv(created(), fake.deps))?.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat01-team");
});

test("an existing chat with no binding is not moved onto a default chosen later", async () => {
  for (const reason of ["resume", "refresh", "import"] as const) {
    const fake = defaulted();
    assert.equal(await sessionEnv(request({ agentId: "old", reason }), fake.deps), undefined, reason);
    assert.equal("old" in fake.stored().agents, false, reason);
  }
});

test("an existing chat whose default is broken still opens: only new chats are refused", async () => {
  const fake = defaulted({ token: null });
  assert.equal(await sessionEnv(request({ agentId: "old", reason: "resume" }), fake.deps), undefined);
});

test("a chat bound by hand keeps its account over the default", async () => {
  const fake = defaulted({ agents: { mine: "work" } });
  const env = await sessionEnv(request({ agentId: "mine", reason: "create" }), fake.deps);
  assert.equal(env, undefined, "work has no token, so the session is left alone rather than moved");
  assert.equal(fake.stored().agents.mine, "work");
});

test("with several accounts each new chat lands on the one chosen as default", async () => {
  const other = { ...keyed, id: "other", label: "Other", tokenLogin: "bob@example.com", tokenOrg: "org-b" };
  const tokens: Record<string, string> = {
    "alice@example.com/org-team": "sk-ant-oat01-team",
    "bob@example.com/org-b": "sk-ant-oat01-bob",
  };
  for (const [chosen, token] of [["keyed", "sk-ant-oat01-team"], ["other", "sk-ant-oat01-bob"]] as const) {
    const fake = defaulted({ accounts: [work, keyed, other], defaults: { claude: chosen } });
    const env = await sessionEnv(created(), { ...fake.deps, readMintedToken: async (key) => tokens[key] ?? null });
    assert.equal(env?.CLAUDE_CODE_OAUTH_TOKEN, token);
    assert.equal(fake.stored().agents.new, chosen);
  }
});

test("a default whose switching key is gone refuses the new chat and binds nothing", async () => {
  const fake = defaulted({ token: null });
  const refused = await refusal(sessionEnv(created(), fake.deps));
  assert.equal(refused.code, "no-token");
  assert.equal(refused.message, "no-token|Team|");
  assert.equal("new" in fake.stored().agents, false);
});

test("a default whose key Anthropic rejects (expired or revoked) refuses the new chat", async () => {
  const fake = defaulted({ check: "rejected" });
  assert.equal((await refusal(sessionEnv(created(), fake.deps))).code, "token-rejected");
  assert.equal("new" in fake.stored().agents, false);
});

test("a key the network could not confirm still opens the chat on the default", async () => {
  const fake = defaulted({ check: "unknown" });
  assert.equal((await sessionEnv(created(), fake.deps))?.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat01-team");
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

test("no accounts with a key and a logged-out directory: the refusal says to add one", async () => {
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

test("a refusal never carries the token", async () => {
  const fake = defaulted({ token: "sk-ant-oat01-secret", check: "rejected" });
  const refused = await refusal(sessionEnv(created(), fake.deps));
  assert.equal(refused.message.includes("sk-ant-oat01-secret"), false);
  assert.equal(fake.lines.join("\n").includes("sk-ant-oat01-secret"), false);
});

test("an account with no token login recorded leaves the session alone", async () => {
  const env = await sessionEnv(
    { agentId: "a1", workspaceId: "w1", provider: "claude", cwd: "/w/acme", env: { PATH: "/bin" } },
    { ...deps({ token: "sk-ant-oat01-example" }), readRegistry: async () => registry() },
  );
  assert.equal(env, undefined);
});

test("an account with no minted token leaves the session alone", async () => {
  const env = await sessionEnv(
    { agentId: "a1", workspaceId: "w1", provider: "claude", cwd: "/w/acme", env: { PATH: "/bin" } },
    deps({ token: null }),
  );
  assert.equal(env, undefined);
});

test("a Keychain failure leaves the session alone and says so once", async () => {
  const lines: string[] = [];
  const env = await sessionEnv(
    { agentId: "a1", workspaceId: "w1", provider: "claude", cwd: "/w/acme", env: {} },
    {
      ...deps({ token: null }),
      readMintedToken: async () => {
        throw new Error("locked");
      },
      log: (l) => lines.push(l),
    },
  );
  assert.equal(env, undefined);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /leaving the session alone/);
});

test("the token is never put in a log line", async () => {
  const lines: string[] = [];
  await sessionEnv(
    { agentId: "a1", workspaceId: "w1", provider: "claude", cwd: "/w/acme", env: {} },
    { ...deps({ token: "sk-ant-oat01-secret" }), log: (l) => lines.push(l) },
  );
  assert.equal(lines.join("\n").includes("sk-ant-oat01-secret"), false);
});

test("a provider this plugin does not know is left alone", async () => {
  assert.equal(await sessionEnv(request({ provider: "copilot" }), deps({ token: null })), undefined);
});

test("an unrecognised provider is rejected before the registry is ever read", async () => {
  let asked = false;
  const answer = await sessionEnv(
    request({ provider: "copilot" }),
    {
      ...deps({ token: null }),
      readRegistry: async () => {
        asked = true;
        return registry();
      },
    },
  );
  assert.equal(answer, undefined);
  assert.equal(asked, false);
});

test("an account for another provider cannot apply to this session", async () => {
  const codex = { ...work, id: "cdx", provider: "codex" as const, home: "/w/.codex" };
  const mixed = registry({ accounts: [codex], agents: { ag1: "cdx" } });
  assert.equal(
    await sessionEnv(request(), { ...deps({ token: null }), readRegistry: async () => mixed }),
    undefined,
  );
});

test("nothing bound leaves the session exactly as Paseo built it", async () => {
  const bare = registry({ agents: {} });
  assert.equal(
    await sessionEnv(request(), { ...deps({ token: null }), readRegistry: async () => bare }),
    undefined,
  );
});

test("a failure anywhere is a no-op, not a session that will not start", async () => {
  const boom = {
    ...deps({ token: null }),
    readRegistry: async () => {
      throw new Error("disk on fire");
    },
  };
  assert.equal(await sessionEnv(request(), boom), undefined);
});

test("every failure the hook can hit says so once and leaves the session alone", async () => {
  const lines: string[] = [];
  const failures: Array<Partial<Parameters<typeof sessionEnv>[1]>> = [
    {
      readRegistry: async () => {
        throw new Error("disk on fire");
      },
    },
    {
      readMintedToken: async () => {
        throw new Error("the Keychain will not answer");
      },
    },
  ];
  for (const failure of failures) {
    const answer = await sessionEnv(
      request(),
      { ...deps({ token: null }), ...failure, log: (line) => lines.push(line) },
    );
    // A session on the wrong account beats a session that does not start.
    assert.equal(answer, undefined);
  }
  assert.equal(lines.length, failures.length);
  for (const line of lines) assert.match(line, /leaving the session alone/);
});

const codexAccount = { id: "cdx", label: "Codex", provider: "codex" as const, home: "/w/.codex-work" };

test("a codex session is pointed at its directory", async () => {
  const bound = registry({ accounts: [codexAccount], agents: { ag1: "cdx" } });
  const answer = await sessionEnv(request({ provider: "codex" }), {
    ...deps({ token: null }),
    readRegistry: async () => bound,
    directoryExists: async () => true,
  });
  assert.deepEqual(answer, { PATH: "/usr/bin", CODEX_HOME: "/w/.codex-work" });
});

test("a codex account needs no minted token, and none is read for it", async () => {
  // A Keychain read could put a dialog in front of a starting session.
  let readToken = false;
  const answer = await sessionEnv(request({ provider: "codex" }), {
    ...deps({ token: null }),
    readRegistry: async () => registry({ accounts: [codexAccount], agents: { ag1: "cdx" } }),
    readMintedToken: async () => {
      readToken = true;
      return null;
    },
    directoryExists: async () => true,
  });
  assert.equal(readToken, false);
  assert.deepEqual(answer, { PATH: "/usr/bin", CODEX_HOME: "/w/.codex-work" });
});

test("a codex directory that is gone leaves the session alone", async () => {
  const gone = { ...codexAccount, home: "/w/gone" };
  const answer = await sessionEnv(request({ provider: "codex" }), {
    ...deps({ token: null }),
    readRegistry: async () => registry({ accounts: [gone], agents: { ag1: "cdx" } }),
    directoryExists: async () => false,
  });
  assert.equal(answer, undefined);
});
