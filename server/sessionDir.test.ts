import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionDirs, parseSessionDir } from "./sessionDir.ts";

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
