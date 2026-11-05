import { test } from "node:test";
import assert from "node:assert/strict";
import type { Identity } from "../shared/parse.ts";
import type { Registry } from "../shared/registry.ts";
import type { ChatFacts, Resolved } from "./chatAccount.ts";
import { chatFactsOf } from "./chatAccount.ts";
import { type MoveDeps, type MoveReadDeps, checkMove, readMoveCheck } from "./moveCheck.ts";

const one = { id: "account-1", label: "Account one", provider: "claude" as const, home: "/Users/me/.claude-account-1" };
const five = { id: "account-5", label: "Account five", provider: "claude" as const, home: "/Users/me/.claude-account-5" };
const cdx = { id: "cdx", label: "Codex one", provider: "codex" as const, home: "/Users/me/.codex-account-1" };

function registry(overrides: Partial<Registry> = {}): Registry {
  return { version: 2, accounts: [one, five, cdx], agents: { ag1: "account-1" }, ...overrides };
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

const loggedIn: Identity = { loggedIn: true, email: "", orgName: "", subscriptionType: "" };

function deps(overrides: Partial<MoveDeps> = {}): MoveDeps {
  return {
    readRegistry: async () => registry(),
    chat: async () => chat(),
    exists: async () => true,
    identify: async () => loggedIn,
    unsaved: async () => false,
    ...overrides,
  };
}

const move = { agentId: "ag1", accountId: "account-5" };

/** A chat as Paseo reports it, through what the plugin makes of a profile. */
const reported = (provider: string) =>
  chatFactsOf(
    { agent: { id: "ag1", provider, cwd: "/Users/me/shop", title: null, status: "idle", persistence: { sessionId: "s1" } }, project: null },
    "ag1",
    async (name) => (name === "claude-work" ? { family: "claude", configDir: null } : null),
  );

test("a chat of a Claude profile moves like a Claude chat, onto Claude accounts only", async () => {
  const chatOf = { chat: () => reported("claude-work") };
  assert.equal((await checkMove(move, deps(chatOf))).ok, true);
  const toCodex = await checkMove({ agentId: "ag1", accountId: "cdx" }, deps(chatOf));
  assert.equal(toCodex.ok, false);
  if (!toCodex.ok) assert.equal(toCodex.code, "provider-mismatch");
});

test("a chat of a provider nobody extends still cannot be moved", async () => {
  const verdict = await checkMove(move, deps({ chat: () => reported("opencode") }));
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "unsupported-provider");
});

test("the first-turn guard sees a profile's chat as Claude's, whose transcripts it can check", async () => {
  let seen = "";
  const verdict = await checkMove(
    move,
    deps({
      chat: () => reported("claude-work"),
      unsaved: async (_agentId, chat) => {
        seen = chat?.provider ?? "";
        return true;
      },
    }),
  );
  assert.equal(seen, "claude");
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "first-turn");
});

test("a chat that can move to an account that can take it is allowed", async () => {
  const verdict = await checkMove(move, deps());
  assert.equal(verdict.ok, true);
  if (verdict.ok) {
    assert.equal(verdict.target.id, "account-5");
    assert.equal(verdict.chat?.id, "ag1");
  }
});

test("each reason a move cannot happen is its own code", async () => {
  const refused = async (overrides: Partial<MoveDeps>, input = move) => {
    const verdict = await checkMove(input, deps(overrides));
    return verdict.ok ? "ok" : verdict.code;
  };
  assert.equal(await refused({ chat: async () => null }), "unknown-chat");
  assert.equal(await refused({ chat: async () => chat({ archived: true }) }), "archived");
  assert.equal(await refused({}, { ...move, accountId: "nope" }), "unknown-account");
  assert.equal(await refused({}, { ...move, accountId: "cdx" }), "provider-mismatch");
  assert.equal(await refused({ exists: async () => false }), "missing-directory");
  assert.equal(await refused({ identify: async () => ({ ...loggedIn, loggedIn: false }) }), "not-logged-in");
  assert.equal(await refused({ unsaved: async () => true }), "first-turn");
});

test("a single codex chat is not moved, since its history lives in its own folder", async () => {
  const verdict = await checkMove({ agentId: "ag1", accountId: "cdx" }, deps({ chat: async () => chat({ provider: "codex" }) }));
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "unsupported-provider");
});

test("a chat of a provider the plugin does not run is refused", async () => {
  const verdict = await checkMove(move, deps({ chat: async () => chat({ provider: "opencode" }) }));
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "unsupported-provider");
});

test("an unknown chat is refused before anything else is looked at", async () => {
  let looked = 0;
  const verdict = await checkMove(move, deps({ chat: async () => null, exists: async () => (looked++, true), identify: async () => (looked++, loggedIn) }));
  assert.equal(verdict.ok, false);
  assert.equal(looked, 0);
});

test("without a chat lookup the account alone is checked, as before", async () => {
  const verdict = await checkMove({ agentId: "ag1", accountId: "cdx" }, deps({ chat: undefined }));
  assert.equal(verdict.ok, true);
  const unknown = await checkMove({ agentId: "ag1", accountId: "nope" }, deps({ chat: undefined }));
  assert.equal(unknown.ok, false);
});

test("the first turn is asked about with the chat, so Paseo is not asked twice", async () => {
  const seen: Array<[string, string | null]> = [];
  await checkMove(move, deps({ unsaved: async (agentId, found) => (seen.push([agentId, found?.id ?? null]), false) }));
  assert.deepEqual(seen, [["ag1", "ag1"]]);
});

// ---- the dry run God Mode shows before it asks ----------------------------------------------------

function readDeps(overrides: Partial<MoveReadDeps> = {}): MoveReadDeps {
  const resolved: Resolved = { basis: "binding", account: one, bound: "account-1", note: "" };
  return {
    ...deps(),
    current: async () => resolved,
    identity: async (account) => ({ ...loggedIn, email: `${account.id}@example.com` }),
    ...overrides,
  };
}

test("the answer names the chat, where it is, where it would go, and says nothing is wrong", async () => {
  const answer = await readMoveCheck(move, readDeps());
  assert.deepEqual(answer, {
    title: "Budget export",
    project: "family",
    turn: "idle",
    current: "account-1 (account-1@example.com)",
    to: "account-5 (account-5@example.com)",
    code: "",
    error: "",
  });
});

test("a turn in progress is part of what is shown, since the move cuts it off", async () => {
  const answer = await readMoveCheck(move, readDeps({ chat: async () => chat({ busy: true, status: "running" }) }));
  assert.equal(answer.turn, "running");
});

test("an account that cannot be told is said so, and an unnamed login is shown by its label alone", async () => {
  const unknown: Resolved = { basis: "none", account: null, bound: "", note: "not bound" };
  const answer = await readMoveCheck(move, readDeps({ current: async () => unknown, identity: async () => null }));
  assert.equal(answer.current, "unknown");
  assert.equal(answer.to, "account-5");
});

test("a refusal says why in a sentence as well as in a code", async () => {
  const answer = await readMoveCheck({ ...move, accountId: "cdx" }, readDeps());
  assert.equal(answer.code, "provider-mismatch");
  assert.match(answer.error, /Claude/);
  assert.match(answer.error, /Codex/);
  const archived = await readMoveCheck(move, readDeps({ chat: async () => chat({ archived: true }) }));
  assert.equal(archived.code, "archived");
  assert.match(archived.error, /archived/);
  const codexChat = await readMoveCheck({ agentId: "ag1", accountId: "cdx" }, readDeps({ chat: async () => chat({ provider: "codex" }) }));
  assert.equal(codexChat.code, "unsupported-provider");
  assert.match(codexChat.error, /history/);
});

test("every field a confirmation shows is a string, whatever the verdict", async () => {
  const scenarios: Array<[Partial<MoveReadDeps>, string]> = [
    [{}, "account-5"],
    [{ chat: async () => null }, "account-5"],
    [{ chat: async () => chat({ archived: true }) }, "account-5"],
    [{}, "nope"],
    [{}, "cdx"],
    [{ exists: async () => false }, "account-5"],
    [{ identify: async () => ({ ...loggedIn, loggedIn: false }) }, "account-5"],
    [{ unsaved: async () => true }, "account-5"],
    [{ chat: async () => chat({ provider: "codex" }) }, "cdx"],
  ];
  for (const [overrides, accountId] of scenarios) {
    const answer = await readMoveCheck({ agentId: "ag1", accountId }, readDeps(overrides));
    for (const field of ["title", "project", "turn", "current", "to", "code", "error"] as const) {
      assert.equal(typeof answer[field], "string", `${field} for ${accountId}`);
    }
  }
});

test("an unknown chat is still answered, with its error and an account named as asked", async () => {
  const answer = await readMoveCheck(move, readDeps({ chat: async () => null }));
  assert.equal(answer.code, "unknown-chat");
  assert.match(answer.error, /no chat has exactly this id/);
  assert.equal(answer.title, "");
});
