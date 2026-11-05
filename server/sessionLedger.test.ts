import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionLedger } from "./sessionLedger.ts";

const open = (overrides: Partial<{ agentId: string; provider: string; reason: string; purpose: string }> = {}) => ({
  agentId: "a1",
  provider: "claude",
  reason: "refresh",
  purpose: "interactive",
  ...overrides,
});

test("what the hook injected is remembered per chat, with when and why", () => {
  const ledger = createSessionLedger(100, () => 1_000);
  ledger.note(open(), { PATH: "/bin", CLAUDE_SECURESTORAGE_CONFIG_DIR: "/Users/me/.claude-account-5" });
  assert.deepEqual(ledger.last("a1"), {
    at: 1_000,
    reason: "refresh",
    provider: "claude",
    injected: "/Users/me/.claude-account-5",
  });
  assert.equal(ledger.last("a2"), undefined);
});

test("an empty value is kept, since it is how the default directory is selected", () => {
  const ledger = createSessionLedger();
  ledger.note(open(), { CLAUDE_SECURESTORAGE_CONFIG_DIR: "" });
  assert.equal(ledger.last("a1")?.injected, "");
});

test("a session the hook left alone is recorded as nothing injected", () => {
  const ledger = createSessionLedger();
  ledger.note(open(), undefined);
  assert.equal(ledger.last("a1")?.injected, undefined);
  assert.ok(ledger.last("a1"), "the open itself is still on record");
  ledger.note(open({ agentId: "a2" }), { PATH: "/bin" });
  assert.equal(ledger.last("a2")?.injected, undefined);
});

test("a history-only open is not a session, so it is not recorded", () => {
  const ledger = createSessionLedger();
  ledger.note(open({ purpose: "history" }), { CLAUDE_SECURESTORAGE_CONFIG_DIR: "/x" });
  assert.equal(ledger.last("a1"), undefined);
});

test("a later open replaces an earlier one", () => {
  let now = 1;
  const ledger = createSessionLedger(100, () => now);
  ledger.note(open({ reason: "create" }), { CLAUDE_SECURESTORAGE_CONFIG_DIR: "/old" });
  now = 2;
  ledger.note(open(), { CLAUDE_SECURESTORAGE_CONFIG_DIR: "/new" });
  assert.deepEqual(ledger.last("a1"), { at: 2, reason: "refresh", provider: "claude", injected: "/new" });
});

test("codex records CODEX_HOME, and a provider the plugin does not run is not recorded", () => {
  const ledger = createSessionLedger();
  ledger.note(open({ provider: "codex" }), { CODEX_HOME: "/Users/me/.codex-account-1" });
  assert.equal(ledger.last("a1")?.injected, "/Users/me/.codex-account-1");
  ledger.note(open({ agentId: "a2", provider: "opencode" }), { CLAUDE_SECURESTORAGE_CONFIG_DIR: "/x" });
  assert.equal(ledger.last("a2"), undefined);
});

test("the oldest chats are forgotten past the limit", () => {
  const ledger = createSessionLedger(2);
  for (const agentId of ["a1", "a2", "a3"]) ledger.note(open({ agentId }), { CLAUDE_SECURESTORAGE_CONFIG_DIR: "/x" });
  assert.equal(ledger.last("a1"), undefined);
  assert.ok(ledger.last("a2"));
  assert.ok(ledger.last("a3"));
});
