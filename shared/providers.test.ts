import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, envFor, isProviderId, providerForHome } from "./providers.ts";

const DEFAULT_DIR = "/Users/me/.claude";
const claudeWork = { provider: "claude" as const, home: "/Users/me/.claude-work" };
const claudeDefault = { provider: "claude" as const, home: "/Users/me/.claude" };
const codex = { provider: "codex" as const, home: "/Users/me/.codex-work" };

test("a claude session is pointed at the account's credential directory, not its config dir", () => {
  // Only the credential variable is set, so the session keeps its own config directory
  // (transcript, settings, MCP) and only the login moves.
  assert.deepEqual(envFor(claudeWork, DEFAULT_DIR), { CLAUDE_SECURESTORAGE_CONFIG_DIR: "/Users/me/.claude-work" });
});

test("the default claude directory is reached with an empty value, not its path", () => {
  // Claude Code's Keychain item for the default dir is unsuffixed; the path would hash to a
  // different, empty item and read as logged out.
  assert.deepEqual(envFor(claudeDefault, DEFAULT_DIR), { CLAUDE_SECURESTORAGE_CONFIG_DIR: "" });
});

test("a trailing slash does not hide the default directory", () => {
  assert.deepEqual(envFor({ provider: "claude", home: "/Users/me/.claude/" }, DEFAULT_DIR), {
    CLAUDE_SECURESTORAGE_CONFIG_DIR: "",
  });
});

test("a codex session is pointed at its directory", () => {
  assert.deepEqual(envFor(codex, DEFAULT_DIR), { CODEX_HOME: "/Users/me/.codex-work" });
});

test("both providers are ids and both are now supported", () => {
  assert.equal(isProviderId("codex"), true);
  assert.equal(isProviderId("claude"), true);
  assert.equal(isProviderId("cursor"), false);
  assert.equal(PROVIDERS.claude.supported, true);
  assert.equal(PROVIDERS.codex.supported, true);
});

test("only claude can have its allowance measured", () => {
  assert.equal(PROVIDERS.claude.meterable, true);
  assert.equal(PROVIDERS.codex.meterable, false);
});

test("a directory names its own provider, and an unrelated one names none", () => {
  assert.equal(providerForHome("/Users/me/.claude"), "claude");
  assert.equal(providerForHome("/Users/me/.claude-work-data"), "claude");
  assert.equal(providerForHome("/Users/me/.claude-work"), "claude");
  assert.equal(providerForHome("/Users/me/.claude_personal"), "claude");
  assert.equal(providerForHome("/Users/me/.claude.x"), "claude");
  assert.equal(providerForHome("/Users/me/work/job/.claude-data"), "claude");
  assert.equal(providerForHome("/Users/me/.codex"), "codex");
  assert.equal(providerForHome("/Users/me/.codex-work"), "codex");
  assert.equal(providerForHome("/Users/me/Documents"), null);
  assert.equal(providerForHome("/Users/me/.claudex"), null);
  assert.equal(providerForHome("/Users/me/.claude-"), null);
});
