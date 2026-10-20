import { test } from "node:test";
import assert from "node:assert/strict";
import type { Registry } from "../shared/registry.ts";
import { type SwitchDeps, switchAccount } from "./switchAccount.ts";

const work = { id: "work", label: "Work", provider: "claude" as const, home: "/w/acme/.claude-data" };
const home = { id: "home", label: "Home", provider: "claude" as const, home: "/Users/me/.claude" };

function registry(overrides: Partial<Registry> = {}): Registry {
  return { version: 2, accounts: [work, home], agents: {}, ...overrides };
}

function deps(log: string[], overrides: Partial<SwitchDeps> = {}): SwitchDeps {
  let stored = registry();
  return {
    readRegistry: async () => stored,
    writeRegistry: async (value) => {
      log.push("write");
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
  const written: Array<Record<string, string>> = [];
  const result = await switchAccount(
    input,
    deps(log, {
      writeRegistry: async (value) => {
        log.push("write");
        written.push(value.agents);
      },
      reload: async () => {
        log.push("reload");
        return { code: "reload-failed" as const, error: "boom" };
      },
    }),
  );
  assert.equal(result.code, "reload-failed");
  assert.deepEqual(log, ["write", "reload", "write"]);
  assert.equal(written[0]?.ag1, "home", "the switch wrote the target");
  assert.deepEqual(written[1], {}, "the rollback restored what was there before");
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
