import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginRpcContract } from "@getpaseo/plugin";
import { accountView, listAccounts } from "../shared/accounts.ts";
import type { Registry } from "../shared/registry.ts";
import { switchAccountRpc, switchAllRpc } from "../shared/switch.ts";
import { chatRpc, describeAccounts, describeRpc, moveCheckRpc, OPERATIONS } from "./capabilities.ts";
import { type SwitchDeps, switchAccount } from "./switchAccount.ts";
import { type Chat, switchAll } from "./switchAll.ts";

const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

// What a caller would send for each operation; the ones left out take no arguments.
const EXAMPLES: Record<string, Record<string, unknown>> = {
  chat_account: { agentId: ID },
  chat_account_fresh: { agentId: ID },
  chat_move_check: { agentId: ID, account: "work" },
  switch_chat: { agentId: ID, account: "work" },
  switch_all: { account: "work" },
};

// The names index.server.ts registers them under.
const CONTRACTS: Record<string, PluginRpcContract> = { listAccounts, chatRpc, moveCheckRpc, switchAccountRpc, switchAllRpc };

// God Mode's rule for field names whose text it never passes on.
const SECRET = /token|secret|password|passwd|credential|cookie|bearer|authorization|api.?key|private.?key/i;

/** Not done, the way `paseo.capabilities/1` reads an answer: an outcome text field is not empty. */
function refused(id: string, answer: object): boolean {
  const fields = [OPERATIONS.find((op) => op.id === id)?.outcome?.error ?? []].flat();
  return fields.some((field) => {
    const value = (answer as Record<string, unknown>)[field];
    return typeof value === "string" && value.trim() !== "";
  });
}

const work = {
  id: "work",
  label: "Work",
  provider: "claude" as const,
  home: "/Users/me/.claude-work",
  tokenLogin: "alice@example.com",
  tokenOrg: "org-work",
};

function fakeRegistry() {
  let stored: Registry = { version: 2, accounts: [work], agents: {} };
  const log: string[] = [];
  const deps: Omit<SwitchDeps, "reload"> = {
    readRegistry: async () => stored,
    writeRegistry: async (value) => {
      log.push("write");
      stored = value;
    },
    exists: async () => true,
    identify: async () => ({ loggedIn: true, email: "", orgName: "", subscriptionType: "" }),
  };
  return { deps, log, stored: () => stored };
}

test("the description matches its own contract and travels as plain JSON", () => {
  const described = describeAccounts();
  // The daemon parses the answer with this schema, so whatever it would drop is lost.
  assert.deepEqual(describeRpc.output.parse(described), described);
  assert.deepEqual(JSON.parse(JSON.stringify(described)), described);
  assert.equal(describeRpc.name, "meta.describe");
  assert.equal(describeAccounts(), described, "rendered once");
});

test("every operation points at an RPC index.server.ts registers", async () => {
  const source = await readFile(join(import.meta.dirname, "..", "index.server.ts"), "utf8");
  const handled = new Set([...source.matchAll(/server\.handle\((\w+),/g)].map((match) => match[1]));
  assert.ok(handled.has("describeRpc"));
  for (const op of OPERATIONS) {
    const name = Object.keys(CONTRACTS).find((key) => CONTRACTS[key] === op.contract);
    assert.ok(name !== undefined && handled.has(name), `${op.id} → ${op.contract.name}`);
  }
});

test("what an operation advertises, merged under its fixed arguments, reaches the handler as sent", () => {
  for (const op of OPERATIONS) {
    const args = EXAMPLES[op.id] ?? {};
    assert.doesNotThrow(() => op.input.parse(args), `${op.id} accepts its example`);
    assert.deepEqual(op.contract.input.parse({ ...args, ...op.fixed }), { ...args, ...op.fixed }, `${op.id} reaches ${op.contract.name}`);
  }
});

test("fixed arguments are not offered to the caller", () => {
  for (const op of describeAccounts().operations) {
    const offered = Object.keys((op.input.properties as Record<string, unknown> | undefined) ?? {});
    for (const key of Object.keys(op.fixed ?? {})) assert.ok(!offered.includes(key), `${op.id} hides ${key}`);
  }
});

test("one read is the default, and every action is confirmed with a text first", () => {
  const ops = describeAccounts().operations;
  assert.equal(new Set(ops.map((op) => op.id)).size, ops.length);
  assert.deepEqual(ops.filter((op) => op.default).map((op) => op.id), ["accounts"]);
  for (const op of ops) {
    if (op.kind === "read") {
      assert.equal(op.risk, undefined, `${op.id} is a read`);
      continue;
    }
    assert.equal(op.risk, "disruptive", op.id);
    assert.equal(op.confirm, "always", op.id);
    assert.ok(op.confirmText, `${op.id} says what will happen`);
  }
});

test("nothing that opens a terminal, touches the Keychain or forgets an account is offered", () => {
  const offered = new Set(describeAccounts().operations.map((op) => op.method));
  assert.deepEqual([...offered].sort(), ["accounts.chat", "accounts.list", "accounts.move-check", "accounts.switch", "accounts.switch-all"]);
});

test("the texts fit the contract's limits, so none is cut", () => {
  const described = describeAccounts();
  assert.ok(described.summary.length <= 300);
  for (const op of described.operations) {
    assert.ok(op.title.length <= 80, op.id);
    assert.ok(op.description.length <= 600, `${op.id}: ${op.description.length}`);
    assert.ok((op.confirmText ?? "").length <= 600, op.id);
  }
});

test("the fresh read measures now and the main one does not", () => {
  const byId = Object.fromEntries(describeAccounts().operations.map((op) => [op.id, op]));
  assert.deepEqual(byId.accounts.fixed, { refresh: false, force: false });
  assert.deepEqual(byId.accounts_fresh.fixed, { refresh: true, force: true });
  assert.equal(byId.accounts_fresh.kind, "read");
});

test("a switch's target is a read its arguments fill, showing fields that read answers", () => {
  const ops = describeAccounts().operations;
  assert.ok(ops.find((op) => op.id === "switch_chat")?.target, "a single switch names its chat");
  for (const op of ops.filter((candidate) => candidate.target)) {
    const target = op.target!;
    const read = ops.find((candidate) => candidate.id === target.read);
    assert.equal(read?.kind, "read", `${op.id} reads ${target.read}`);
    const given = [...Object.keys((op.input.properties as object | undefined) ?? {}), ...Object.keys(op.fixed ?? {})];
    const takes = Object.keys((read!.input.properties as object | undefined) ?? {});
    for (const [to, from] of Object.entries(target.args)) {
      assert.ok(given.includes(from), `${op.id} has ${from}`);
      assert.ok(takes.includes(to), `${read!.id} takes ${to}`);
    }
    for (const required of (read!.input.required as string[] | undefined) ?? []) assert.ok(required in target.args, required);
    const contract = OPERATIONS.find((candidate) => candidate.id === read!.id)!.contract;
    const answers = Object.keys((contract.output as unknown as { shape: object }).shape);
    for (const field of target.show) assert.ok(answers.includes(field), `${read!.id} answers ${field}`);
  }
});

test("a single switch reads as refused exactly when nothing changed", async () => {
  const reload = async () => ({ code: "" as const, error: "" });
  const unknown = fakeRegistry();
  const declined = await switchAccount({ agentId: ID, accountId: "nope" }, { ...unknown.deps, reload });
  assert.ok(refused("switch_chat", declined));
  assert.deepEqual(unknown.log, []);

  const failing = fakeRegistry();
  const failed = await switchAccount(
    { agentId: ID, accountId: "work" },
    { ...failing.deps, reload: async () => ({ code: "reload-failed" as const, error: "agent busy" }) },
  );
  assert.ok(refused("switch_chat", failed));
  assert.deepEqual(failing.stored().agents, {}, "the binding is rolled back");

  const working = fakeRegistry();
  const done = await switchAccount({ agentId: ID, accountId: "work" }, { ...working.deps, reload });
  assert.equal(refused("switch_chat", done), false);
  assert.deepEqual(working.stored().agents, { [ID]: "work" });
});

test("moving all chats reads as refused only when nothing was moved, not when one restart failed", async () => {
  const chats: Chat[] = [
    { id: "a", provider: "claude", status: "idle" },
    { id: "b", provider: "claude", status: "idle" },
  ];
  const unknown = fakeRegistry();
  const declined = await switchAll("nope", { ...unknown.deps, chats: async () => chats, reload: async () => ({ code: "", error: "" }) });
  assert.ok(refused("switch_all", declined));
  assert.deepEqual(unknown.log, []);

  const partly = fakeRegistry();
  const result = await switchAll("work", {
    ...partly.deps,
    chats: async () => chats,
    reload: async (id) => (id === "b" ? { code: "reload-failed" as const, error: "agent busy" } : { code: "" as const, error: "" }),
  });
  assert.equal(result.moved, 1);
  assert.notEqual(result.error, "");
  assert.equal(refused("switch_all", result), false, "chat a did move");
});

test("nothing read out is a secret, and the account rows carry no secret text", () => {
  for (const op of describeAccounts().operations) {
    for (const field of op.output?.fields ?? []) assert.ok(!SECRET.test(field), `${op.id}: ${field}`);
  }
  for (const [key, schema] of Object.entries(accountView.shape)) {
    if (SECRET.test(key)) assert.equal(schema.safeParse("text").success, false, `${key} holds no text`);
  }
});

test("the operations are exactly the ones God Mode is meant to find, and the old chat read is gone", () => {
  assert.deepEqual(
    OPERATIONS.map((op) => op.id),
    ["accounts", "accounts_fresh", "chat_account", "chat_account_fresh", "chat_move_check", "switch_chat", "switch_all"],
  );
});

test("the chat read comes in a cached and a measured-now form, like the accounts read", () => {
  const byId = Object.fromEntries(describeAccounts().operations.map((op) => [op.id, op]));
  assert.deepEqual(byId.chat_account.fixed, { force: false });
  assert.deepEqual(byId.chat_account_fresh.fixed, { force: true });
  assert.equal(byId.chat_account.method, "accounts.chat");
  assert.equal(byId.chat_account_fresh.method, "accounts.chat");
  assert.equal(byId.chat_account.kind, "read");
  assert.equal(byId.chat_account_fresh.kind, "read");
});

test("a switch is confirmed against the dry run, which needs the chat and the account", () => {
  const ops = Object.fromEntries(describeAccounts().operations.map((op) => [op.id, op]));
  assert.deepEqual(ops.switch_chat.target, {
    read: "chat_move_check",
    args: { agentId: "agentId", account: "account" },
    show: ["title", "project", "current", "to", "turn"],
  });
  assert.equal(ops.chat_move_check.kind, "read");
  assert.deepEqual((ops.chat_move_check.input.required as string[]).sort(), ["account", "agentId"]);
  assert.deepEqual(ops.chat_move_check.outcome, { error: ["code", "error"] });
});

test("a refused dry run and a refused switch both read as not done", () => {
  assert.ok(refused("chat_move_check", { code: "archived", error: "the chat is archived" }));
  assert.equal(refused("chat_move_check", { code: "", error: "" }), false);
  assert.ok(refused("chat_account", { error: "no chat has exactly this id" }));
  assert.ok(refused("switch_chat", { code: "not-applied", error: "left alone" }));
  // Not done is a code or an error; "pending" and "unverified" are done.
  assert.equal(refused("switch_chat", { code: "", error: "", applied: "pending" }), false);
  assert.equal(refused("switch_chat", { code: "", error: "", applied: "unverified" }), false);
});

test("the answers name what a listener needs, and every field they name exists in the RPC they read from", () => {
  const ops = Object.fromEntries(describeAccounts().operations.map((op) => [op.id, op]));
  const fields = (id: string) => ops[id].output?.fields ?? [];
  const wanted = ["account", "accountName", "email", "subscriptionType", "basis", "note", "fiveHour", "sevenDay", "usageAt", "usageAgeSeconds", "usageStale", "usageHeldSeconds"];
  for (const field of wanted) assert.ok(fields("chat_account").includes(field), "chat_account shows " + field);
  assert.deepEqual(fields("chat_account"), fields("chat_account_fresh"));
  for (const field of ["code", "error", "from", "to", "applied", "interrupted"]) assert.ok(fields("switch_chat").includes(field), field);
  const shape = (contract: { output: unknown }) => Object.keys((contract.output as { shape: object }).shape);
  for (const field of fields("chat_account")) assert.ok(shape(chatRpc).includes(field), "chat answers " + field);
  for (const field of fields("chat_move_check")) assert.ok(shape(moveCheckRpc).includes(field), "move-check answers " + field);
  for (const field of fields("switch_chat")) assert.ok(shape(switchAccountRpc).includes(field), "switch answers " + field);
});

test("the essentials of each read are in the first 300 characters, which is all the speech text shows", () => {
  const ops = Object.fromEntries(describeAccounts().operations.map((op) => [op.id, op]));
  const head = ops.chat_account.description.slice(0, 300);
  assert.match(head, /never assume the default account/);
  assert.match(head, /basis/);
  assert.match(head, /usageStale|usageAgeSeconds/);
  assert.match(ops.accounts.description, /chat_account/, "the list points at the chat read: isDefault is not a chat's account");
  assert.match(ops.chat_move_check.description.slice(0, 300), /changes nothing/);
});

test("the plugin says it also tells which account a chat runs on, and answers to the words for it", () => {
  const described = describeAccounts();
  assert.match(described.summary, /chat/i);
  for (const alias of ["quota", "limits", "subscription"]) assert.ok(described.aliases.includes(alias), alias);
  assert.ok(described.aliases.length <= 20);
});
