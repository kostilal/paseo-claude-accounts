import { test } from "node:test";
import assert from "node:assert/strict";
import { SHELL_CONFIG_DIR, claudeEnv, claudePaths, defaultDir, findClaude, shellDirArg } from "./claude.ts";

const HOME = "/Users/me";

const base = {
  PATH: "/usr/bin",
  CLAUDE_CONFIG_DIR: "/Users/me/.claude-other",
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-inherited",
  ANTHROPIC_API_KEY: "sk-ant-api-inherited",
  ANTHROPIC_AUTH_TOKEN: "inherited",
  CLAUDE_SECURESTORAGE_CONFIG_DIR: "/Users/me/.claude-other",
};

test("the default directory is ~/.claude", () => {
  assert.equal(defaultDir(HOME), "/Users/me/.claude");
});

test("the default directory is reached by unsetting CLAUDE_CONFIG_DIR", () => {
  const env = claudeEnv("/Users/me/.claude", base, HOME);
  assert.equal(Object.hasOwn(env, "CLAUDE_CONFIG_DIR"), false);
});

test("a trailing slash still names the default directory", () => {
  const env = claudeEnv("/Users/me/.claude/", base, HOME);
  assert.equal(Object.hasOwn(env, "CLAUDE_CONFIG_DIR"), false);
});

test("any other directory is set explicitly", () => {
  assert.equal(claudeEnv("/Users/me/.claude-work", base, HOME).CLAUDE_CONFIG_DIR, "/Users/me/.claude-work");
  assert.equal(
    claudeEnv("/Users/me/Work/acme/.claude-data", {}, HOME).CLAUDE_CONFIG_DIR,
    "/Users/me/Work/acme/.claude-data",
  );
});

test("a .claude directory under some other home is not the default", () => {
  assert.equal(claudeEnv("/Users/other/.claude", {}, HOME).CLAUDE_CONFIG_DIR, "/Users/other/.claude");
});

test("inherited tokens, keys and the storage override are stripped", () => {
  for (const dir of ["/Users/me/.claude", "/Users/me/.claude-work"]) {
    const env = claudeEnv(dir, base, HOME);
    for (const name of [
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_SECURESTORAGE_CONFIG_DIR",
    ]) {
      assert.equal(Object.hasOwn(env, name), false, `${name} should be gone for ${dir}`);
    }
    assert.equal(env.PATH, "/usr/bin");
  }
});

test("the base environment is not mutated", () => {
  const before = { ...base };
  claudeEnv("/Users/me/.claude", base, HOME);
  claudeEnv("/Users/me/.claude-work", base, HOME);
  assert.deepEqual(base, before);
});

test("the shell argument is empty for the default directory and the path otherwise", () => {
  assert.equal(shellDirArg("/Users/me/.claude", HOME), "");
  assert.equal(shellDirArg("/Users/me/.claude/", HOME), "");
  assert.equal(shellDirArg("/Users/me/.claude-work", HOME), "/Users/me/.claude-work");
});

test("the shell prefix unsets the overrides and sets or unsets the directory from $1", () => {
  assert.match(SHELL_CONFIG_DIR, /^unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_SECURESTORAGE_CONFIG_DIR;/);
  assert.match(SHELL_CONFIG_DIR, /if \[ -n "\$1" \]; then export CLAUDE_CONFIG_DIR="\$1"; else unset CLAUDE_CONFIG_DIR; fi/);
});

test("claude is looked for in the known install locations, in order", () => {
  assert.deepEqual(claudePaths(HOME), [
    "/Users/me/.local/bin/claude",
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/Users/me/.claude/local/claude",
    "/Users/me/.npm-global/bin/claude",
  ]);
});

test("the first location that exists wins", async () => {
  const asked: string[] = [];
  const found = await findClaude(HOME, async (path) => {
    asked.push(path);
    return path === "/usr/local/bin/claude" || path === "/Users/me/.npm-global/bin/claude";
  });
  assert.equal(found, "/usr/local/bin/claude");
  assert.deepEqual(asked, claudePaths(HOME).slice(0, 3));
});

test("with no known location present, a bare claude is resolved through PATH", async () => {
  assert.equal(await findClaude(HOME, async () => false), "claude");
});
