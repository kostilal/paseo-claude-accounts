import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountById,
  applyBinding,
  emptyRegistry,
  hiddenHomes,
  parseRegistry,
  registerAccount,
  removeAccounts,
  unhideHomes,
  resolveAccount,
  defaultAccount,
  setDefault,
  type Registry,
} from "./registry.ts";

const work = { id: "work", label: "work", provider: "claude" as const, home: "/w/acme/.claude-data" };
const home = { id: "default", label: "default", provider: "claude" as const, home: "/Users/me/.claude" };

function registry(): Registry {
  return { version: 2, accounts: [work, home], agents: {}, hidden: [] };
}

test("an unbound chat resolves to no account; a bound one to its account", () => {
  const base = registry();
  assert.equal(resolveAccount(base, { agentId: "ag1" }), null);
  const pinned = { ...base, agents: { ag1: "work" } };
  assert.equal(resolveAccount(pinned, { agentId: "ag1" })?.id, "work");
});

test("a binding to an account that no longer exists resolves to null, not to a guess", () => {
  const base = { ...registry(), agents: { ag1: "gone" } };
  assert.equal(resolveAccount(base, { agentId: "ag1" }), null);
});

test("clearing a binding deletes the key rather than storing an empty string", () => {
  const bound = applyBinding(registry(), { agentId: "ag1", account: "work" });
  assert.equal(bound.agents.ag1, "work");
  const cleared = applyBinding(bound, { agentId: "ag1", account: null });
  assert.equal(Object.hasOwn(cleared.agents, "ag1"), false);
});

test("absent, malformed and other versions are not readable", () => {
  assert.equal(parseRegistry(undefined), null);
  assert.equal(parseRegistry("not an object"), null);
  assert.equal(parseRegistry({ version: 1, default: null, projects: {}, agents: {} }), null);
  assert.equal(parseRegistry({ version: 99 }), null);
});

test("an account with an unknown provider makes the file unreadable", () => {
  const bad = { ...registry(), accounts: [{ ...work, provider: "cursor" }] };
  assert.equal(parseRegistry(bad), null);
});

test("a version 2 file is returned as it stands", () => {
  assert.deepEqual(parseRegistry(registry()), registry());
});

test("missing collections default to empty", () => {
  assert.deepEqual(parseRegistry({ version: 2 }), emptyRegistry());
});

test("fields that are no longer used are dropped on read", () => {
  const legacy = { ...registry(), default: "default", projects: { prj_a: "work" } };
  assert.deepEqual(parseRegistry(legacy), registry());
});

test("0.1.x switching-key fields are dropped on read", () => {
  const legacy = { ...registry(), accounts: [{ ...work, tokenLogin: "alice@example.com", tokenOrg: "org-team" }, home] };
  const loaded = parseRegistry(legacy)!;
  assert.deepEqual(loaded, registry());
  assert.equal(Object.hasOwn(accountById(loaded, "work") ?? {}, "tokenLogin"), false);
  assert.equal(Object.hasOwn(accountById(loaded, "work") ?? {}, "tokenOrg"), false);
});

// Deleting accounts and hiding their directories

/** A login held by two registered directories, the shape a grouped row's `accountIds` has. */
const workTwin = { id: "work-2", label: "work-2", provider: "claude" as const, home: "/Users/me/.claude-work" };

function grouped(): Registry {
  return {
    ...registry(),
    accounts: [work, workTwin, home],
    agents: { ag1: "work", ag2: "work-2", ag3: "default" },
  };
}

test("a version 2 file without a hidden list reads with nothing hidden", () => {
  const { hidden: _hidden, ...old } = registry();
  const loaded = parseRegistry(old)!;
  assert.deepEqual(loaded.hidden, []);
  assert.equal(loaded.version, 2);
});

test("deleting a grouped row removes every member, and every binding that named one", () => {
  const result = removeAccounts(grouped(), ["work", "work-2"]);
  assert.ok(result.ok);
  assert.deepEqual(result.removed, ["work", "work-2"]);
  assert.deepEqual(result.hidden, ["/Users/me/.claude-work", "/w/acme/.claude-data"]);
  assert.deepEqual(result.registry.accounts.map((account) => account.id), ["default"]);
  assert.deepEqual(result.registry.agents, { ag3: "default" });
  assert.deepEqual([...hiddenHomes(result.registry)].sort(), result.hidden);
});

test("the input registry is not mutated", () => {
  const before = grouped();
  const snapshot = structuredClone(before);
  removeAccounts(before, ["work"]);
  assert.deepEqual(before, snapshot);
});

test("one unknown id refuses the whole request", () => {
  const result = removeAccounts(grouped(), ["work", "nobody"]);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.unknown.includes("nobody"));
});

test("a relative path or a bare slash names nothing", () => {
  assert.equal(removeAccounts(grouped(), ["w/acme/.claude-data"]).ok, false);
  assert.equal(removeAccounts(grouped(), ["/"]).ok, false);
});

test("hiding a suggestion records its canonical path and removes no account", () => {
  const result = removeAccounts(grouped(), ["/Users/me/.claude-spare/"]);
  assert.ok(result.ok);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.hidden, ["/Users/me/.claude-spare"]);
  assert.equal(result.registry.accounts.length, 3);
  assert.ok(hiddenHomes(result.registry).has("/Users/me/.claude-spare"));
});

test("a path that a registered account lives at removes that account too", () => {
  const result = removeAccounts(grouped(), ["/w/acme/.claude-data"]);
  assert.ok(result.ok);
  assert.deepEqual(result.removed, ["work"]);
});

test("hiding the same home twice records it once", () => {
  const first = removeAccounts(grouped(), ["/x/.claude-a"]);
  assert.ok(first.ok);
  const second = removeAccounts(first.registry, ["/x/.claude-a"]);
  assert.ok(second.ok);
  assert.deepEqual(second.hidden, []);
  assert.deepEqual(second.registry.hidden, ["/x/.claude-a"]);
});

test("registering a hidden home takes it back out of hidden, and nothing else", () => {
  const removed = removeAccounts(grouped(), ["work", "/x/.claude-a"]);
  assert.ok(removed.ok);
  const again = registerAccount(removed.registry, { ...work });
  assert.deepEqual(again.hidden, ["/x/.claude-a"]);
  assert.equal(accountById(again, "work")?.home, work.home);
  // Re-adding is not undo: the dropped binding stays dropped.
  assert.equal(again.agents.ag1, undefined);
});

test("registering into a registry that never had the field works", () => {
  const { hidden: _hidden, ...old } = registry();
  const added = registerAccount(old, workTwin);
  assert.deepEqual(added.hidden, []);
  assert.equal(added.accounts.length, 3);
});

test("unhiding takes exactly the named homes out of hidden, and touches nothing else", () => {
  const removed = removeAccounts(grouped(), ["work", "/x/.claude-a"]);
  assert.ok(removed.ok);
  const result = unhideHomes(removed.registry, ["/x/.claude-a"]);
  assert.deepEqual(result.restored, ["/x/.claude-a"]);
  assert.deepEqual(result.registry.hidden, [work.home]);
  assert.equal(accountById(result.registry, "work"), null);
});

test("unhiding a home that is not hidden is a harmless no-op", () => {
  const removed = removeAccounts(grouped(), ["/x/.claude-a"]);
  assert.ok(removed.ok);
  const result = unhideHomes(removed.registry, ["/nowhere", "/x/.claude-a/"]);
  assert.deepEqual(result.restored, ["/x/.claude-a"], "a trailing slash names the same home");
  assert.deepEqual(result.registry.hidden, []);
  const { hidden: _hidden, ...old } = registry();
  assert.deepEqual(unhideHomes(old, ["/x"]).restored, []);
});

test("a default names an account of its own provider, and goes when the account is removed", () => {
  const withDefault: Registry = { ...registry(), defaults: { claude: "work", codex: "work" } };
  assert.equal(defaultAccount(withDefault, "claude")?.id, "work");
  assert.equal(defaultAccount(withDefault, "codex"), null, "work is a Claude account");
  assert.equal(defaultAccount(registry(), "claude"), null);
  const removed = removeAccounts(withDefault, ["work"]);
  assert.ok(removed.ok);
  assert.deepEqual(removed.registry.defaults, {});
  assert.equal(parseRegistry({ ...withDefault })?.defaults?.claude, "work");
});

test("setting a default leaves every binding alone, and clearing it removes only that provider", () => {
  const base = { ...registry(), agents: { a1: "work" }, defaults: { codex: "cdx" } };
  const set = setDefault(base, "claude", "work");
  assert.deepEqual(set.defaults, { codex: "cdx", claude: "work" });
  assert.deepEqual(set.agents, { a1: "work" });
  assert.deepEqual(setDefault(set, "claude", null).defaults, { codex: "cdx" });
  assert.deepEqual(base.defaults, { codex: "cdx" }, "the input is not mutated");
});
