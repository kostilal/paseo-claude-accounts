import { test } from "node:test";
import assert from "node:assert/strict";
import type { PaseoApi } from "./paseo.ts";
import type { Registry } from "../shared/registry.ts";
import { type Chat, type SwitchAllDeps, listChats, switchAll } from "./switchAll.ts";

const work = { id: "work", label: "Work", provider: "claude" as const, home: "/w/acme/.claude-data" };
const personal = { id: "personal", label: "Personal", provider: "claude" as const, home: "/Users/me/.claude" };
const codex = { id: "codex", label: "Codex", provider: "codex" as const, home: "/Users/me/.codex" };

const CHATS: Chat[] = [
  { id: "idle", provider: "claude", status: "idle" },
  { id: "err", provider: "claude", status: "error" },
  { id: "busy", provider: "claude", status: "running" },
  { id: "shut", provider: "claude", status: "closed" },
  { id: "cx", provider: "codex", status: "idle" },
];

function deps(log: string[], overrides: Partial<SwitchAllDeps> = {}) {
  let stored: Registry = {
    version: 2,
    accounts: [work, personal, codex],
    agents: { idle: "work", busy: "work", cx: "codex" },
  };
  const value: SwitchAllDeps = {
    readRegistry: async () => stored,
    writeRegistry: async (next) => {
      log.push("write");
      stored = next;
    },
    exists: async () => true,
    identify: async () => ({ loggedIn: true, email: "", orgName: "", subscriptionType: "" }),
    chats: async () => CHATS,
    reload: async (agentId) => {
      log.push(`reload ${agentId}`);
      return { code: "" as const, error: "" };
    },
    ...overrides,
  };
  return { deps: value, stored: () => stored };
}

test("every idle chat of the provider is bound in one write, then the open ones restart", async () => {
  const log: string[] = [];
  const fake = deps(log);
  const result = await switchAll("personal", fake.deps);
  assert.deepEqual(result, { code: "", moved: 3, restarted: 2, failed: 0, skipped: 1, error: "" });
  assert.equal(log[0], "write");
  assert.deepEqual(log.slice(1).sort(), ["reload err", "reload idle"]);
  assert.deepEqual(fake.stored().agents, { idle: "personal", err: "personal", busy: "work", shut: "personal", cx: "codex" });
});

test("a chat in the middle of a turn is neither rebound nor restarted", async () => {
  const log: string[] = [];
  const fake = deps(log, {
    chats: async () => [
      { id: "busy", provider: "claude", status: "running" },
      { id: "starting", provider: "claude", status: "initializing" },
    ],
  });
  const result = await switchAll("personal", fake.deps);
  assert.deepEqual(result, { code: "", moved: 0, restarted: 0, failed: 0, skipped: 2, error: "" });
  assert.deepEqual(log, ["write"], "only the default is recorded; nothing restarted");
  assert.equal(fake.stored().agents.busy, "work");
});

test("a closed chat is bound but not started", async () => {
  const log: string[] = [];
  await switchAll("personal", deps(log).deps);
  assert.equal(log.includes("reload shut"), false);
});

test("a chat of another provider keeps its account and is not restarted", async () => {
  const log: string[] = [];
  const fake = deps(log);
  await switchAll("personal", fake.deps);
  assert.equal(fake.stored().agents.cx, "codex");
  assert.equal(log.includes("reload cx"), false);
});

test("a target the hook could not act on is refused before anything is touched", async () => {
  const log: string[] = [];
  const loggedOut = deps(log, { identify: async () => ({ loggedIn: false, email: "", orgName: "", subscriptionType: "" }) });
  const result = await switchAll("work", loggedOut.deps);
  assert.equal(result.code, "not-logged-in");
  assert.deepEqual(log, []);
  assert.equal((await switchAll("gone", deps(log).deps)).code, "unknown-account");
  assert.deepEqual(log, []);
});

test("a failed restart puts back only that chat's previous binding", async () => {
  const log: string[] = [];
  const fake = deps(log, {
    reload: async (agentId) =>
      agentId === "idle" ? { code: "reload-failed" as const, error: "agent busy" } : { code: "" as const, error: "" },
  });
  const result = await switchAll("personal", fake.deps);
  assert.deepEqual(result, { code: "", moved: 2, restarted: 1, failed: 1, skipped: 1, error: "agent busy" });
  assert.deepEqual(fake.stored().agents, { idle: "work", err: "personal", busy: "work", shut: "personal", cx: "codex" });
});

test("a failed restart of a chat that was never bound leaves it unbound again", async () => {
  const log: string[] = [];
  const fake = deps(log, {
    chats: async () => [{ id: "fresh", provider: "claude", status: "idle" }],
    reload: async () => ({ code: "paseo-not-found" as const, error: "" }),
  });
  const result = await switchAll("personal", fake.deps);
  assert.equal(result.failed, 1);
  assert.equal(result.error, "paseo-not-found");
  assert.equal("fresh" in fake.stored().agents, false);
});

test("a chat the daemon lists but has not loaded keeps its new binding, like a closed one", async () => {
  // `paseo agent reload` answers "Agent not found" for it: nothing runs, so nothing to restart.
  const log: string[] = [];
  const fake = deps(log, {
    reload: async (agentId) =>
      agentId === "idle"
        ? { code: "reload-failed" as const, error: "Command failed: paseo agent reload idle\nError: Agent not found: idle" }
        : { code: "" as const, error: "" },
  });
  const result = await switchAll("personal", fake.deps);
  assert.deepEqual(result, { code: "", moved: 3, restarted: 1, failed: 0, skipped: 1, error: "" });
  assert.equal(fake.stored().agents.idle, "personal");
});

test("no chats of the provider still records the default, and restarts nothing", async () => {
  const log: string[] = [];
  const fake = deps(log, { chats: async () => [] });
  const result = await switchAll("personal", fake.deps);
  assert.deepEqual(result, { code: "", moved: 0, restarted: 0, failed: 0, skipped: 0, error: "" });
  assert.deepEqual(log, ["write"]);
  assert.deepEqual(fake.stored().defaults, { claude: "personal" });
});

test("the account becomes its provider's default, other providers' defaults stay", async () => {
  const log: string[] = [];
  const fake = deps(log);
  const before = await fake.deps.readRegistry();
  await fake.deps.writeRegistry({ ...before, defaults: { codex: "codex", claude: "work" } });
  await switchAll("personal", fake.deps);
  assert.deepEqual(fake.stored().defaults, { codex: "codex", claude: "personal" });
});

test("a refused move leaves the default alone", async () => {
  const log: string[] = [];
  const fake = deps(log, { identify: async () => ({ loggedIn: false, email: "", orgName: "", subscriptionType: "" }) });
  await switchAll("work", fake.deps);
  assert.equal(fake.stored().defaults, undefined);
});

test("restarts run a few at a time, not all at once", async () => {
  let running = 0;
  let peak = 0;
  const many = Array.from({ length: 20 }, (_, n) => ({ id: `c${n}`, provider: "claude", status: "idle" }));
  const result = await switchAll(
    "personal",
    deps([], {
      chats: async () => many,
      reload: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return { code: "" as const, error: "" };
      },
    }).deps,
  );
  assert.equal(result.restarted, 20);
  assert.ok(peak > 1 && peak <= 6, `peak ${peak}`);
});

test("listChats follows every page and leaves archived chats out", async () => {
  const pages = [
    {
      entries: [{ agent: { id: "a", provider: "claude", status: "idle", archivedAt: null, persistence: { sessionId: "s-a" } } }],
      pageInfo: { hasMore: true, nextCursor: "p2", prevCursor: null },
    },
    {
      entries: [
        { agent: { id: "b", provider: "codex", status: "closed" } },
        { agent: { id: "old", provider: "claude", status: "closed", archivedAt: "2026-10-01T00:00:00Z" } },
      ],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: "p1" },
    },
  ];
  const cursors: Array<string | undefined> = [];
  const paseo = {
    agents: {
      list: async (options: { page: { cursor?: string } }) => {
        cursors.push(options.page.cursor);
        return pages[cursors.length - 1];
      },
    },
  } as unknown as PaseoApi;
  assert.deepEqual(await listChats(paseo), [
    { id: "a", provider: "claude", status: "idle", sessionId: "s-a", createdAt: null },
    { id: "b", provider: "codex", status: "closed", sessionId: null, createdAt: null },
  ]);
  assert.deepEqual(cursors, [undefined, "p2"]);
});

test("moving all chats clears every workspace's account for the provider, and only for it", async () => {
  const fake = deps([]);
  const seeded = await fake.deps.readRegistry();
  await fake.deps.writeRegistry({
    ...seeded,
    workspaces: { wks_1: { claude: "work" }, wks_2: { claude: "work", codex: "codex" } },
  });
  await switchAll("personal", fake.deps);
  assert.deepEqual(fake.stored().workspaces, { wks_2: { codex: "codex" } });
});

test("an idle chat whose first turn was never saved is skipped, not restarted into a broken session", async () => {
  const log: string[] = [];
  const now = new Date().toISOString();
  const chats: Chat[] = [
    { id: "saved", provider: "claude", status: "idle", sessionId: "s-saved", createdAt: now },
    { id: "unsaved", provider: "claude", status: "idle", sessionId: "s-unsaved", createdAt: now },
    { id: "fresh", provider: "claude", status: "idle", sessionId: null, createdAt: now },
    // Long past its first turn: moved even though no transcript was found for it.
    { id: "old", provider: "claude", status: "idle", sessionId: "s-old", createdAt: "2026-01-01T00:00:00Z" },
  ];
  const fake = deps(log, { chats: async () => chats, hasTranscript: async (id) => id === "s-saved" });
  const result = await switchAll("personal", fake.deps);
  assert.equal(result.skipped, 1);
  assert.deepEqual(log.slice(1).sort(), ["reload fresh", "reload old", "reload saved"]);
  assert.equal(fake.stored().agents.unsaved, undefined, "its binding is not touched");
});
