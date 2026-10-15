import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, envFor, isProviderId, providerForHome } from "./providers.ts";

const claude = { provider: "claude" as const, home: "/Users/me/.claude" };
const codex = { provider: "codex" as const, home: "/Users/me/.codex-work" };

test("a claude session is given the token and nothing else", () => {
  assert.deepEqual(envFor(claude, "sk-ant-oat01-example"), {
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-example",
  });
});

test("no config directory is named, so the session keeps the one it already has", () => {
  const env = envFor(claude, "sk-ant-oat01-example");
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
});

test("a claude session with no token is given nothing at all", () => {
  assert.deepEqual(envFor(claude, null), {});
});

test("a codex session is pointed at its directory and given no token", () => {
  assert.deepEqual(envFor(codex, null), { CODEX_HOME: "/Users/me/.codex-work" });
});

test("a codex session ignores a token even when one is offered", () => {
  // A Claude token handed to a Codex session would look like it worked while doing nothing.
  assert.deepEqual(envFor(codex, "sk-ant-oat01-example"), { CODEX_HOME: "/Users/me/.codex-work" });
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
