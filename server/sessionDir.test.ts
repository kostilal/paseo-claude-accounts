import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSessionDirs, liveLoginDir, parseSessionDir } from "./sessionDir.ts";

const listing = [
  "/usr/bin/other HOME=/Users/me",
  "/opt/homebrew/bin/claude --verbose HOME=/Users/me PASEO_AGENT_ID=a1 CLAUDE_CONFIG_DIR=/Users/me/work/.claude-data PATH=/bin",
  "/opt/homebrew/bin/claude --verbose HOME=/Users/me PASEO_AGENT_ID=a2 PATH=/bin",
].join("\n");

test("the directory comes from the agent's own process", () => {
  assert.deepEqual(parseSessionDir(listing, "a1"), { found: true, configDir: "/Users/me/work/.claude-data" });
});

test("a process without the variable runs on the default directory", () => {
  assert.deepEqual(parseSessionDir(listing, "a2"), { found: true, configDir: null });
});

test("no process means not found, and an id prefix does not match", () => {
  assert.deepEqual(parseSessionDir(listing, "a3"), { found: false, configDir: null });
  assert.deepEqual(parseSessionDir(listing, "a"), { found: false, configDir: null });
});

test("one listing serves several callers, and a failing ps reads as not found", async () => {
  let calls = 0;
  const dirs = createSessionDirs(60_000, async () => {
    calls += 1;
    return listing;
  });
  await dirs("a1");
  await dirs("a2");
  assert.equal(calls, 1);
  const broken = createSessionDirs(60_000, async () => Promise.reject(new Error("no ps")));
  assert.deepEqual(await broken("a1"), { found: false, configDir: null });
});

// A line as `ps -axE` prints it: the command, then the environment it runs with.
const claude = (agent: string, env: string) =>
  `/Users/me/.local/bin/claude --verbose HOME=/Users/me PASEO_AGENT_ID=${agent} ${env} PATH=/bin`;

test("the credential variable is read, since it and not the config directory decides the login", () => {
  const listing = claude("a1", "CLAUDE_CONFIG_DIR=/p/.claude-data CLAUDE_SECURESTORAGE_CONFIG_DIR=/Users/me/.claude-account-5");
  const live = parseSessionDir(listing, "a1");
  assert.deepEqual(live, { found: true, configDir: "/p/.claude-data", credentialDir: "/Users/me/.claude-account-5" });
  assert.equal(liveLoginDir(live, "claude", "/Users/me/.claude"), "/Users/me/.claude-account-5");
});

test("an empty credential variable is the default directory, an absent one follows the config directory", () => {
  const empty = parseSessionDir(claude("a1", "CLAUDE_CONFIG_DIR=/p/.claude-data CLAUDE_SECURESTORAGE_CONFIG_DIR="), "a1");
  assert.equal(empty.credentialDir, "");
  assert.equal(liveLoginDir(empty, "claude", "/Users/me/.claude"), "/Users/me/.claude");

  const absent = parseSessionDir(claude("a1", "CLAUDE_CONFIG_DIR=/p/.claude-data"), "a1");
  assert.equal(absent.credentialDir, undefined);
  assert.equal(liveLoginDir(absent, "claude", "/Users/me/.claude"), "/p/.claude-data");

  const neither = parseSessionDir(claude("a1", "HOME=/Users/me"), "a1");
  assert.equal(liveLoginDir(neither, "claude", "/Users/me/.claude"), "/Users/me/.claude");
});

test("processes that merely inherited the environment are not the chat's session", () => {
  // Docker Desktop and adb, started from a chat, outlive it and keep that chat's variables.
  const listing = [
    "/Applications/Docker.app/Contents/MacOS/com.docker.backend HOME=/Users/me PASEO_AGENT_ID=a1 CLAUDE_SECURESTORAGE_CONFIG_DIR=/Users/me/.claude-account-5",
    "/usr/local/bin/adb fork-server server HOME=/Users/me PASEO_AGENT_ID=a2 CLAUDE_SECURESTORAGE_CONFIG_DIR=/Users/me/.claude-account-5",
  ].join("\n");
  assert.deepEqual(parseSessionDir(listing, "a1"), { found: false, configDir: null });
  assert.deepEqual(parseSessionDir(listing, "a2"), { found: false, configDir: null });
});

test("the claude process wins over a leftover descendant of the same chat", () => {
  const listing = [
    "/Applications/Docker.app/Contents/MacOS/com.docker.backend HOME=/Users/me PASEO_AGENT_ID=a1 CLAUDE_SECURESTORAGE_CONFIG_DIR=/Users/me/.claude-account-5",
    claude("a1", "CLAUDE_SECURESTORAGE_CONFIG_DIR=/Users/me/.claude-account-1"),
  ].join("\n");
  assert.equal(parseSessionDir(listing, "a1").credentialDir, "/Users/me/.claude-account-1");
});

test("a claude started through node is still the claude process", () => {
  const listing =
    "node /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js --verbose HOME=/Users/me PASEO_AGENT_ID=a1 CLAUDE_CONFIG_DIR=/p/.claude-data";
  assert.deepEqual(parseSessionDir(listing, "a1"), { found: true, configDir: "/p/.claude-data" });
});

test("of several claude processes the newest, listed last, is reported, and a disagreement is flagged", () => {
  const listing = [
    claude("a1", "CLAUDE_SECURESTORAGE_CONFIG_DIR=/Users/me/.claude-account-1"),
    claude("a1", "CLAUDE_SECURESTORAGE_CONFIG_DIR=/Users/me/.claude-account-2"),
  ].join("\n");
  assert.deepEqual(parseSessionDir(listing, "a1"), {
    found: true,
    configDir: null,
    credentialDir: "/Users/me/.claude-account-2",
    ambiguous: true,
  });
  const agreeing = [claude("a1", "CLAUDE_SECURESTORAGE_CONFIG_DIR=/x"), claude("a1", "CLAUDE_SECURESTORAGE_CONFIG_DIR=/x")].join("\n");
  assert.equal(parseSessionDir(agreeing, "a1").ambiguous, undefined);
});

test("a codex chat is read from its codex process and CODEX_HOME", () => {
  const listing = "/opt/homebrew/bin/codex app-server HOME=/Users/me PASEO_AGENT_ID=c1 CODEX_HOME=/Users/me/.codex-account-1";
  const live = parseSessionDir(listing, "c1", "codex");
  assert.deepEqual(live, { found: true, configDir: "/Users/me/.codex-account-1" });
  assert.equal(liveLoginDir(live, "codex", "/Users/me/.claude"), "/Users/me/.codex-account-1");
  assert.equal(parseSessionDir(listing, "c1", "claude").found, false, "a codex process is not a claude one");
  const bare = parseSessionDir("/opt/homebrew/bin/codex app-server PASEO_AGENT_ID=c2", "c2", "codex");
  assert.equal(liveLoginDir(bare, "codex", "/Users/me/.claude"), join(homedir(), ".codex"));
});

test("a fresh read skips the cache, which a read right after a restart needs", async () => {
  let calls = 0;
  const dirs = createSessionDirs(60_000, async () => {
    calls += 1;
    return claude("a1", "CLAUDE_CONFIG_DIR=/p/.claude-data");
  });
  await dirs("a1");
  await dirs("a1");
  assert.equal(calls, 1);
  await dirs("a1", { fresh: true });
  assert.equal(calls, 2);
});
