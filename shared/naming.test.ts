import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAUDE_DIR, displayName, uniqueId } from "./naming.ts";

test("a per-job directory is named for the job that owns it", () => {
  assert.equal(displayName("/Users/me/Documents/Work/Projects/acme/.claude-data"), "acme");
});

test("a home profile keeps what is left once the prefix is gone", () => {
  assert.equal(displayName("/Users/me/.claude-work-data"), "work");
  assert.equal(displayName("/Users/me/.claude-work"), "work");
});

test("the default directory is called default", () => {
  assert.equal(displayName("/Users/me/.claude"), "default");
});

test("a name already taken gains a number rather than colliding", () => {
  assert.equal(uniqueId("work", new Set()), "work");
  assert.equal(uniqueId("work", new Set(["work"])), "work-2");
  assert.equal(uniqueId("work", new Set(["work", "work-2"])), "work-3");
});

test("the default codex directory is called default", () => {
  assert.equal(displayName("/Users/me/.codex"), "default");
});

test("a codex profile keeps what is left once the prefix is gone", () => {
  assert.equal(displayName("/Users/me/.codex-work"), "work");
  assert.equal(displayName("/Users/me/.codex-account-2"), "account-2");
});

test("the codex branch does not disturb the claude answers", () => {
  assert.equal(displayName("/Users/me/.claude-codex-data"), "codex");
});

test("underscore and dot separators name a profile the same way a dash does", () => {
  assert.equal(displayName("/Users/me/.claude_personal"), "personal");
  assert.equal(displayName("/Users/me/.claude_x"), "x");
  assert.equal(displayName("/Users/me/.claude.x"), "x");
  assert.equal(displayName("/Users/me/.claude.work-data"), "work");
});

test("the directory pattern takes .claude and .claude plus a separator and a name", () => {
  for (const name of [".claude", ".claude-work", ".claude_personal", ".claude.x", ".claude-work-data"]) {
    assert.equal(CLAUDE_DIR.test(name), true, name);
  }
  for (const name of [".claudex", ".claude-", ".claude_", "claude", ".codex", "x.claude"]) {
    assert.equal(CLAUDE_DIR.test(name), false, name);
  }
});

test("a name that only resembles a profile keeps its own name", () => {
  assert.equal(displayName("/Users/me/.claudex"), ".claudex");
});
