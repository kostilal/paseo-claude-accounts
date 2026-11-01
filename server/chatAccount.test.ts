import { test } from "node:test";
import assert from "node:assert/strict";
import type { Identity } from "../shared/parse.ts";
import type { Registry } from "../shared/registry.ts";
import { type ChatFacts, type ResolveDeps, readChatAccount, resolveChatAccount, toChatFacts } from "./chatAccount.ts";
import type { LimitsView } from "./limits.ts";
import type { SessionDir } from "./sessionDir.ts";
import type { OpenRecord } from "./sessionLedger.ts";

const DEFAULT_DIR = "/Users/me/.claude";

const one = { id: "account-1", label: "Account one", provider: "claude" as const, home: "/Users/me/.claude-account-1" };
const five = { id: "account-5", label: "Account five", provider: "claude" as const, home: "/Users/me/.claude-account-5" };
const shop = { id: "shop", label: "shop", provider: "claude" as const, home: "/Users/me/projects/shop/.claude-data" };
const cdx = { id: "cdx", label: "Codex one", provider: "codex" as const, home: "/Users/me/.codex-account-1" };

function registry(overrides: Partial<Registry> = {}): Registry {
  return { version: 2, accounts: [one, five, shop, cdx], agents: {}, ...overrides };
}

function chat(overrides: Partial<ChatFacts> = {}): ChatFacts {
  return {
    id: "ag1",
    provider: "claude",
    cwd: "/Users/me/projects/family",
    title: "Budget export",
    project: "family",
    status: "idle",
    busy: false,
    archived: false,
    sessionId: "s1",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function resolveDeps(options: { registry?: Partial<Registry>; live?: SessionDir; record?: OpenRecord; asked?: unknown[] } = {}): ResolveDeps {
  return {
    readRegistry: async () => registry(options.registry),
    live: async (agentId, provider) => {
      options.asked?.push([agentId, provider]);
      return options.live ?? { found: false, configDir: null };
    },
    ledger: () => options.record,
    defaultDir: () => DEFAULT_DIR,
  };
}

const record = (injected: string | undefined): OpenRecord => ({ at: 1_500, reason: "refresh", provider: "claude", injected });

// ---- what Paseo says about a chat -------------------------------------------------------------

const agent = {
  id: "ag1",
  provider: "claude",
  cwd: "/Users/me/projects/shop",
  title: "Fix the login",
  status: "idle",
  createdAt: "2026-10-01T00:00:00.000Z",
  persistence: { sessionId: "s1" },
};

test("a chat is known by its exact id only, even though Paseo answers for a prefix or a title too", () => {
  assert.equal(toChatFacts(null, "ag1"), null);
  assert.equal(toChatFacts({ agent, project: null }, "ag"), null);
  assert.equal(toChatFacts({ agent, project: null }, "Fix the login"), null);
  assert.equal(toChatFacts({ agent, project: null }, "ag1")?.id, "ag1");
});

test("a chat is named by what it has: its project, else its folder, and its title if any", () => {
  assert.equal(toChatFacts({ agent, project: { projectName: "shop" } }, "ag1")?.project, "shop");
  assert.equal(toChatFacts({ agent, project: null }, "ag1")?.project, "shop");
  assert.equal(toChatFacts({ agent: { ...agent, title: null }, project: null }, "ag1")?.title, "");
});

test("a turn is running when Paseo says running or initializing, or reports an active turn", () => {
  const busy = (patch: object) => toChatFacts({ agent: { ...agent, ...patch }, project: null }, "ag1")?.busy;
  assert.equal(busy({ status: "running" }), true);
  assert.equal(busy({ status: "initializing" }), true);
  assert.equal(busy({ status: "idle", activeTurn: { turnId: "t1", startedAt: null } }), true);
  assert.equal(busy({ status: "idle", activeTurn: null }), false);
  assert.equal(busy({ status: "closed" }), false);
  assert.equal(busy({ status: "error" }), false);
});

test("archived, the saved session and the creation time come through", () => {
  const facts = toChatFacts({ agent: { ...agent, archivedAt: "2026-10-30T00:00:00.000Z" }, project: null }, "ag1");
  assert.equal(facts?.archived, true);
  assert.equal(facts?.sessionId, "s1");
  assert.equal(facts?.createdAt, "2026-10-01T00:00:00.000Z");
  assert.equal(toChatFacts({ agent, project: null }, "ag1")?.archived, false);
  assert.equal(toChatFacts({ agent: { ...agent, persistence: null }, project: null }, "ag1")?.sessionId, null);
});

// ---- which account a chat is on ----------------------------------------------------------------

test("a running claude process that agrees with the binding is the proof", async () => {
  const live: SessionDir = { found: true, configDir: "/p/.claude-data", credentialDir: five.home };
  const resolved = await resolveChatAccount(chat(), resolveDeps({ live, registry: { agents: { ag1: "account-5" } } }));
  assert.equal(resolved.basis, "process");
  assert.equal(resolved.account?.id, "account-5");
  assert.equal(resolved.bound, "account-5");
  assert.equal(resolved.note, "");
});

test("a process that runs elsewhere than the binding says is what the chat is on, and the disagreement is named", async () => {
  const live: SessionDir = { found: true, configDir: "/p/.claude-data", credentialDir: five.home };
  const resolved = await resolveChatAccount(chat(), resolveDeps({ live, registry: { agents: { ag1: "account-1" } } }));
  assert.equal(resolved.basis, "process");
  assert.equal(resolved.account?.id, "account-5");
  assert.equal(resolved.bound, "account-1");
  assert.match(resolved.note, /binding says account-1/);
  assert.match(resolved.note, /running process uses account-5/);
});

test("an unbound chat whose process runs on a registered folder is on that account, and says it is not bound", async () => {
  const live: SessionDir = { found: true, configDir: shop.home };
  const resolved = await resolveChatAccount(chat(), resolveDeps({ live }));
  assert.equal(resolved.account?.id, "shop");
  assert.equal(resolved.bound, "");
  assert.match(resolved.note, /not bound/);
});

test("a process on a folder nobody registered names no account", async () => {
  const live: SessionDir = { found: true, configDir: "/p/.claude-data", credentialDir: "/Users/me/.claude-account-9" };
  const resolved = await resolveChatAccount(chat(), resolveDeps({ live }));
  assert.equal(resolved.basis, "process");
  assert.equal(resolved.account, null);
  assert.match(resolved.note, /not in the account list/);
});

test("the default directory is an account only when it is registered", async () => {
  const live: SessionDir = { found: true, configDir: "/p/.claude-data", credentialDir: "" };
  assert.equal((await resolveChatAccount(chat(), resolveDeps({ live }))).account, null);
  const home = { id: "home", label: "Home", provider: "claude" as const, home: DEFAULT_DIR };
  const resolved = await resolveChatAccount(chat(), resolveDeps({ live, registry: { accounts: [one, home] } }));
  assert.equal(resolved.account?.id, "home");
});

test("without a process, how the session was last opened is the proof", async () => {
  const resolved = await resolveChatAccount(chat(), resolveDeps({ record: record(five.home), registry: { agents: { ag1: "account-5" } } }));
  assert.equal(resolved.basis, "session");
  assert.equal(resolved.account?.id, "account-5");
  assert.equal(resolved.note, "");
});

test("a binding changed after the session opened is named, and the session's account stands", async () => {
  const resolved = await resolveChatAccount(chat(), resolveDeps({ record: record(five.home), registry: { agents: { ag1: "account-1" } } }));
  assert.equal(resolved.basis, "session");
  assert.equal(resolved.account?.id, "account-5");
  assert.match(resolved.note, /binding says account-1/);
  assert.match(resolved.note, /opened on account-5/);
});

test("a session the hook left alone has no account to name", async () => {
  const resolved = await resolveChatAccount(chat(), resolveDeps({ record: record(undefined), registry: { agents: { ag1: "account-1" } } }));
  assert.equal(resolved.basis, "none");
  assert.equal(resolved.account, null);
  assert.equal(resolved.bound, "account-1");
  assert.match(resolved.note, /left .*alone/);
});

test("without a process or a record, the binding is what the chat will open on", async () => {
  const resolved = await resolveChatAccount(chat(), resolveDeps({ registry: { agents: { ag1: "account-5" } } }));
  assert.equal(resolved.basis, "binding");
  assert.equal(resolved.account?.id, "account-5");
  assert.match(resolved.note, /will open on account-5/);
});

test("a binding to an account that is gone names none", async () => {
  const resolved = await resolveChatAccount(chat(), resolveDeps({ registry: { agents: { ag1: "ghost" } } }));
  assert.equal(resolved.basis, "none");
  assert.equal(resolved.account, null);
  assert.equal(resolved.bound, "ghost");
  assert.match(resolved.note, /no longer/);
});

test("an unbound chat with no process has no account, and the default is never put in its place", async () => {
  const resolved = await resolveChatAccount(chat(), resolveDeps({ registry: { defaults: { claude: "account-1" } } }));
  assert.equal(resolved.basis, "none");
  assert.equal(resolved.account, null);
  assert.equal(resolved.bound, "");
  assert.match(resolved.note, /cannot be told/);
});

test("a leftover Docker process is not a session: the chat is read as having none", async () => {
  // The lookup answers for the claude executable only, so such a process arrives as not found.
  const resolved = await resolveChatAccount(chat(), resolveDeps({ live: { found: false, configDir: null }, registry: { agents: { ag1: "account-1" } } }));
  assert.equal(resolved.basis, "binding");
  assert.equal(resolved.account?.id, "account-1");
});

test("a provider the plugin does not run has no account here", async () => {
  const resolved = await resolveChatAccount(chat({ provider: "opencode" }), resolveDeps({ registry: { agents: { ag1: "account-1" } } }));
  assert.equal(resolved.basis, "none");
  assert.equal(resolved.account, null);
  assert.match(resolved.note, /does not manage/);
});

test("a codex chat is read through its own provider", async () => {
  const asked: unknown[] = [];
  const live: SessionDir = { found: true, configDir: cdx.home };
  const resolved = await resolveChatAccount(chat({ provider: "codex" }), resolveDeps({ live, asked }));
  assert.equal(resolved.account?.id, "cdx");
  assert.deepEqual(asked, [["ag1", "codex"]]);
});

// ---- the whole answer --------------------------------------------------------------------------

const limits: LimitsView = {
  usage: "ok",
  fiveHour: { utilization: 42, left: 58, resetsAt: "2026-10-31T19:10:00Z", resetsInSeconds: 7800, resetsIn: "2 h 10 min" },
  sevenDay: { utilization: 61, left: 39, resetsAt: "2026-11-03T10:00:00Z", resetsInSeconds: 234_000, resetsIn: "2 d 17 h" },
  usageAt: "2026-10-31T16:56:50.000Z",
  usageAgeSeconds: 190,
  usageStale: false,
  usageHeldSeconds: 0,
  usageError: "",
};

const who: Identity = { loggedIn: true, email: "five@example.com", orgName: "Five Inc", subscriptionType: "max" };

function readDeps(overrides: Partial<Parameters<typeof readChatAccount>[1]> = {}, options: Parameters<typeof resolveDeps>[0] = {}) {
  const calls: Array<[string, boolean]> = [];
  const deps = {
    ...resolveDeps({ registry: { agents: { ag1: "account-5" } }, ...options }),
    chat: async (id: string) => (id === "ag1" ? chat() : null),
    identity: async () => who,
    limits: async (account: { id: string }, force: boolean) => {
      calls.push([account.id, force]);
      return limits;
    },
    ...overrides,
  };
  return { deps, calls };
}

test("an id that is not a chat's exact id is an error and nothing else", async () => {
  const { deps, calls } = readDeps();
  const answer = await readChatAccount({ agentId: "ag", force: false }, deps);
  assert.match(answer.error, /no chat has exactly this id/);
  assert.equal(answer.account, "");
  assert.equal(answer.usage, "not-measured");
  assert.deepEqual(calls, []);
});

test("a chat on a known account answers who it is on and how much is left", async () => {
  const { deps } = readDeps();
  const answer = await readChatAccount({ agentId: "ag1", force: false }, deps);
  assert.equal(answer.error, "");
  assert.equal(answer.account, "account-5");
  assert.equal(answer.accountName, "Account five");
  assert.equal(answer.bound, "account-5");
  assert.equal(answer.email, "five@example.com");
  assert.equal(answer.orgName, "Five Inc");
  assert.equal(answer.subscriptionType, "max");
  assert.equal(answer.basis, "binding");
  assert.equal(answer.usage, "ok");
  assert.equal(answer.fiveHour?.left, 58);
  assert.equal(answer.usageAgeSeconds, 190);
  assert.equal(answer.title, "Budget export");
  assert.equal(answer.project, "family");
  assert.equal(answer.turn, "idle");
  assert.equal(answer.archived, false);
  assert.equal(answer.provider, "claude");
});

test("a running turn reads as running, and an archived chat is still read", async () => {
  const { deps } = readDeps({ chat: async () => chat({ busy: true, status: "running", archived: true }) });
  const answer = await readChatAccount({ agentId: "ag1", force: false }, deps);
  assert.equal(answer.turn, "running");
  assert.equal(answer.archived, true);
});

test("force reaches the limits read, which is asked about the chat's own account only", async () => {
  const { deps, calls } = readDeps();
  await readChatAccount({ agentId: "ag1", force: true }, deps);
  assert.deepEqual(calls, [["account-5", true]]);
});

test("a chat with no account is not measured, and never given someone else's numbers", async () => {
  const { deps, calls } = readDeps({}, { registry: { agents: {}, defaults: { claude: "account-1" } } });
  const answer = await readChatAccount({ agentId: "ag1", force: false }, deps);
  assert.equal(answer.account, "");
  assert.equal(answer.basis, "none");
  assert.equal(answer.usage, "not-measured");
  assert.equal(answer.fiveHour, null);
  assert.deepEqual(calls, []);
  assert.match(answer.note, /cannot be told/);
});

test("a codex chat has no meter and is not measured", async () => {
  const { deps, calls } = readDeps({ chat: async () => chat({ provider: "codex" }) }, { registry: { agents: { ag1: "cdx" } } });
  const answer = await readChatAccount({ agentId: "ag1", force: false }, deps);
  assert.equal(answer.account, "cdx");
  assert.equal(answer.usage, "unsupported");
  assert.deepEqual(calls, []);
});

test("an account that could not be identified in time still answers, by its label", async () => {
  const { deps } = readDeps({ identity: async () => null });
  const answer = await readChatAccount({ agentId: "ag1", force: false }, deps);
  assert.equal(answer.accountName, "Account five");
  assert.equal(answer.email, "");
  assert.equal(answer.subscriptionType, "");
  assert.equal(answer.usage, "ok", "its allowance is still asked for");
});

test("a logged-out account says so and is not measured", async () => {
  const { deps, calls } = readDeps({ identity: async () => ({ ...who, loggedIn: false }) });
  const answer = await readChatAccount({ agentId: "ag1", force: false }, deps);
  assert.equal(answer.usage, "unauthorised");
  assert.match(answer.usageError, /nobody is logged in/);
  assert.deepEqual(calls, []);
});
