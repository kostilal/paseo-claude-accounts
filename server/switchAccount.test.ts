import { test } from "node:test";
import assert from "node:assert/strict";
import { type Registry, applyBinding } from "../shared/registry.ts";
import type { ChatFacts } from "./chatAccount.ts";
import { type SwitchDeps, switchAccount } from "./switchAccount.ts";

const work = { id: "work", label: "Work", provider: "claude" as const, home: "/w/acme/.claude-data" };
const home = { id: "home", label: "Home", provider: "claude" as const, home: "/Users/me/.claude" };

function registry(overrides: Partial<Registry> = {}): Registry {
  return { version: 2, accounts: [work, home], agents: {}, ...overrides };
}

function deps(log: string[], overrides: Partial<SwitchDeps> = {}, writes: Registry[] = []): SwitchDeps {
  let stored = registry();
  return {
    readRegistry: async () => stored,
    writeRegistry: async (value) => {
      log.push("write");
      writes.push(value);
      stored = value;
    },
    exists: async () => true,
    identify: async () => ({ loggedIn: true, email: "", orgName: "", subscriptionType: "" }),
    reload: async () => {
      log.push("reload");
      return { code: "" as const, error: "" };
    },
    ...overrides,
  };
}

const input = { agentId: "ag1", accountId: "home" };

test("this one agent is what gets bound, and nothing else", async () => {
  let written: Registry | null | undefined;
  const result = await switchAccount(
    input,
    deps([], { writeRegistry: async (value) => void (written = value) }),
  );
  assert.equal(result.code, "");
  assert.equal(written?.agents.ag1, "home");
  assert.deepEqual(Object.keys(written?.agents ?? {}), ["ag1"]);
});

test("an account that does not exist is refused before anything is touched", async () => {
  const log: string[] = [];
  const result = await switchAccount({ ...input, accountId: "nope" }, deps(log));
  assert.equal(result.code, "unknown-account");
  assert.deepEqual(log, []);
});

test("a provider the table does not carry is refused rather than half-applied", async () => {
  // Only reachable through a hand-edited registry; must still be a refusal, not a TypeError.
  const alien = { id: "cur", label: "Cursor", provider: "cursor" as unknown as "claude", home: "/w/.cursor" };
  const log: string[] = [];
  const result = await switchAccount(
    { ...input, accountId: "cur" },
    deps(log, { readRegistry: async () => registry({ accounts: [work, alien] }) }),
  );
  assert.equal(result.code, "unsupported-provider");
  assert.deepEqual(log, []);
});

test("a switch binds the directory, then reloads the session onto its login", async () => {
  const codex = { id: "cdx", label: "Codex", provider: "codex" as const, home: "/w/.codex-work" };
  const log: string[] = [];
  const result = await switchAccount(
    { ...input, accountId: "cdx" },
    deps(log, {
      readRegistry: async () => registry({ accounts: [work, codex] }),
      identify: async () => ({ loggedIn: true, email: "p@example.com", orgName: "Personal", subscriptionType: "pro" }),
    }),
  );
  assert.equal(result.code, "");
  // Binding written first, then the session reloaded.
  assert.deepEqual(log, ["write", "reload"]);
});

test("a directory nobody is logged into is refused before anything is touched", async () => {
  const log: string[] = [];
  const result = await switchAccount(
    input,
    deps(log, { identify: async () => ({ loggedIn: false, email: "", orgName: "", subscriptionType: "" }) }),
  );
  assert.equal(result.code, "not-logged-in");
  assert.deepEqual(log, []);
});

test("a directory that is gone is refused before anything is touched", async () => {
  const log: string[] = [];
  const result = await switchAccount(input, deps(log, { exists: async () => false }));
  assert.equal(result.code, "missing-directory");
  assert.deepEqual(log, []);
});

test("a switch to the account already bound still restarts the session", async () => {
  // The binding may be written while the session is still on the old account.
  const log: string[] = [];
  const result = await switchAccount(
    input,
    deps(log, { readRegistry: async () => registry({ agents: { ag1: "home" } }) }),
  );
  assert.equal(result.code, "");
  assert.deepEqual(log, ["write", "reload"]);
});

test("a failed reload puts the binding back, so the next attempt is not refused", async () => {
  const log: string[] = [];
  const writes: Registry[] = [];
  const result = await switchAccount(
    input,
    deps(
      log,
      {
        reload: async () => {
          log.push("reload");
          return { code: "reload-failed" as const, error: "boom" };
        },
      },
      writes,
    ),
  );
  assert.equal(result.code, "reload-failed");
  assert.deepEqual(log, ["write", "reload", "write"]);
  assert.equal(writes[0]?.agents.ag1, "home", "the switch wrote the target");
  assert.deepEqual(writes[1]?.agents, {}, "the rollback restored what was there before");
});

test("a reload that failed keeps its code and its message", async () => {
  const result = await switchAccount(
    input,
    deps([], { reload: async () => ({ code: "reload-failed" as const, error: "boom" }) }),
  );
  assert.equal(result.code, "reload-failed");
  assert.equal(result.error, "boom");
});

test("a chat whose first turn is not saved yet is refused before anything is touched", async () => {
  const log: string[] = [];
  const asked: string[] = [];
  const result = await switchAccount(input, deps(log, { unsaved: async (agentId) => (asked.push(agentId), true) }));
  assert.equal(result.code, "first-turn");
  assert.deepEqual(log, [], "neither written nor restarted");
  assert.deepEqual(asked, ["ag1"]);
});

test("a chat whose session is saved switches as usual", async () => {
  const log: string[] = [];
  const result = await switchAccount(input, deps(log, { unsaved: async () => false }));
  assert.equal(result.code, "");
  assert.deepEqual(log, ["write", "reload"]);
});

// ---- a switch that knows the chat it moves ---------------------------------------------------------

const claudeChat = (overrides: Partial<ChatFacts> = {}): ChatFacts => ({
  id: "ag1",
  provider: "claude",
  cwd: "/w/acme",
  title: "Budget export",
  project: "acme",
  status: "idle",
  busy: false,
  archived: false,
  sessionId: "s1",
  createdAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const codex = { id: "cdx", label: "Codex", provider: "codex" as const, home: "/w/.codex-work" };

test("a chat that does not exist is refused before anything is touched", async () => {
  const log: string[] = [];
  const result = await switchAccount(input, deps(log, { chat: async () => null }));
  assert.equal(result.code, "unknown-chat");
  assert.deepEqual(log, []);
});

test("an archived chat is refused, since a restart would bring it back from the archive", async () => {
  const log: string[] = [];
  const result = await switchAccount(input, deps(log, { chat: async () => claudeChat({ archived: true }) }));
  assert.equal(result.code, "archived");
  assert.deepEqual(log, [], "neither written nor restarted");
});

test("an account of another provider is refused: the hook would ignore it and the binding would lie", async () => {
  const log: string[] = [];
  const result = await switchAccount(
    { ...input, accountId: "cdx" },
    deps(log, { chat: async () => claudeChat(), readRegistry: async () => registry({ accounts: [work, codex] }) }),
  );
  assert.equal(result.code, "provider-mismatch");
  assert.deepEqual(log, []);
});

test("a single codex chat is not moved: its history lives in the folder it would leave", async () => {
  const log: string[] = [];
  const result = await switchAccount(
    { ...input, accountId: "cdx" },
    deps(log, { chat: async () => claudeChat({ provider: "codex" }), readRegistry: async () => registry({ accounts: [work, codex] }) }),
  );
  assert.equal(result.code, "unsupported-provider");
  assert.deepEqual(log, []);
});

test("a closed chat only gets its binding: it takes the account when it next opens", async () => {
  const log: string[] = [];
  const result = await switchAccount(input, deps(log, { chat: async () => claudeChat({ status: "closed" }) }));
  assert.equal(result.code, "");
  assert.equal(result.applied, "next-open");
  assert.equal(result.to, "home");
  assert.deepEqual(log, ["write"], "no restart for a chat that is not running");
});

test("a turn in progress is reported as cut off, and an idle chat is not", async () => {
  const busy = await switchAccount(input, deps([], { chat: async () => claudeChat({ busy: true, status: "running" }) }));
  assert.equal(busy.code, "");
  assert.equal(busy.interrupted, true);
  const idle = await switchAccount(input, deps([], { chat: async () => claudeChat() }));
  assert.equal(idle.interrupted, false);
});

test("the answer says where the chat was and where it is now", async () => {
  const result = await switchAccount(
    input,
    deps([], { chat: async () => claudeChat(), readRegistry: async () => registry({ agents: { ag1: "work" } }) }),
  );
  assert.equal(result.from, "work");
  assert.equal(result.to, "home");
  const refused = await switchAccount({ ...input, accountId: "nope" }, deps([], { chat: async () => claudeChat() }));
  assert.equal(refused.to, "", "nothing moved");
});

// The registry is shared with the hook, which binds new chats while a restart is running.
function shared() {
  let stored = registry();
  return {
    stored: () => stored,
    set: (next: Registry) => (stored = next),
    base: {
      chat: async () => claudeChat(),
      readRegistry: async () => stored,
      update: async (change: (registry: Registry) => Registry) => (stored = change(stored)),
    } satisfies Partial<SwitchDeps>,
  };
}

test("a failed restart puts back this chat's binding and nothing else, even if other chats were bound meanwhile", async () => {
  const store = shared();
  const result = await switchAccount(
    input,
    deps([], {
      ...store.base,
      reload: async () => {
        store.set(applyBinding(store.stored(), { agentId: "other", account: "work" }));
        return { code: "reload-failed" as const, error: "boom" };
      },
    }),
  );
  assert.equal(result.code, "reload-failed");
  assert.equal(result.to, "");
  assert.deepEqual(store.stored().agents, { other: "work" });
});

test("a binding somebody else changed during the restart is not undone by a failure", async () => {
  const store = shared();
  await switchAccount(
    input,
    deps([], {
      ...store.base,
      reload: async () => {
        store.set(applyBinding(store.stored(), { agentId: "ag1", account: "work" }));
        return { code: "reload-failed" as const, error: "boom" };
      },
    }),
  );
  assert.equal(store.stored().agents.ag1, "work");
});

test("the write goes through the shared queue when there is one, never around it", async () => {
  const store = shared();
  let queued = 0;
  let direct = 0;
  await switchAccount(
    input,
    deps([], {
      ...store.base,
      update: async (change) => {
        queued += 1;
        return store.set(change(store.stored()));
      },
      writeRegistry: async () => void (direct += 1),
    }),
  );
  assert.ok(queued >= 1);
  assert.equal(direct, 0);
  assert.equal(store.stored().agents.ag1, "home");
});

test("a restart still running when the time is up is pending: it is kept, not undone", { timeout: 3_000 }, async () => {
  const store = shared();
  const result = await switchAccount(
    input,
    deps([], {
      ...store.base,
      chat: async () => claudeChat({ busy: true, status: "running" }),
      budgetMs: 10,
      reload: () => new Promise(() => {}),
    }),
  );
  assert.equal(result.code, "");
  assert.equal(result.applied, "pending");
  assert.equal(result.interrupted, true);
  assert.equal(store.stored().agents.ag1, "home", "the hook already ran at the start of the restart");
});

test("a verified switch says so, and the check is given the chat, the account and when it began", async () => {
  const seen: unknown[] = [];
  const result = await switchAccount(
    input,
    deps([], {
      chat: async () => claudeChat(),
      now: () => 1_234,
      verify: async (chat, target, since) => (seen.push([chat?.id, target.id, since]), { verdict: "match" as const, reason: "" }),
    }),
  );
  assert.equal(result.code, "");
  assert.equal(result.applied, "verified");
  assert.deepEqual(seen, [["ag1", "home", 1_234]]);
});

test("a session that did not take the account is reported and the binding is put back", async () => {
  const store = shared();
  const result = await switchAccount(
    input,
    deps([], {
      ...store.base,
      verify: async () => ({ verdict: "mismatch" as const, reason: "the hook left the session alone" }),
    }),
  );
  assert.equal(result.code, "not-applied");
  assert.match(result.error, /left the session alone/);
  assert.equal(result.to, "");
  assert.deepEqual(store.stored().agents, {});
});

test("a switch nothing can confirm is done but unverified, and keeps its binding", async () => {
  const store = shared();
  const result = await switchAccount(
    input,
    deps([], { ...store.base, verify: async () => ({ verdict: "unknown" as const, reason: "no record" }) }),
  );
  assert.equal(result.code, "");
  assert.equal(result.applied, "unverified");
  assert.equal(store.stored().agents.ag1, "home");
});

test("with nothing to verify by, nothing is claimed", async () => {
  const result = await switchAccount(input, deps([], { chat: async () => claudeChat() }));
  assert.equal(result.applied, "");
});
