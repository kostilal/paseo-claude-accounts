import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRST_TURN_MS, type TranscriptFs, transcriptExists, unsavedSession } from "./transcript.ts";

function fakeFs(files: string[]): TranscriptFs & { listed: string[] } {
  const listed: string[] = [];
  return {
    listed,
    readdir: async (path) => {
      listed.push(path);
      const prefix = `${path}/`;
      const below = files.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length).split("/")[0]!);
      if (below.length === 0) throw new Error("ENOENT");
      return [...new Set(below)];
    },
    isFile: async (path) => files.includes(path),
  };
}

test("a transcript is found in any project folder of any config directory", async () => {
  const fs = fakeFs(["/Users/me/.claude-work/projects/-w-app/abc.jsonl"]);
  assert.equal(await transcriptExists("abc", ["/Users/me/.claude", "/Users/me/.claude-work"], fs), true);
});

test("no transcript, an unrelated one, or no projects folder at all: not found", async () => {
  const fs = fakeFs(["/Users/me/.claude/projects/-w-app/other.jsonl"]);
  assert.equal(await transcriptExists("abc", ["/Users/me/.claude", "/gone"], fs), false);
});

const NOW = Date.parse("2026-10-20T12:00:00Z");
const young = new Date(NOW - 5_000).toISOString();

test("only a young Claude chat with a recorded session and no transcript is unsaved", async () => {
  const none = async () => false;
  const chat = (over: Partial<{ provider: string; sessionId: string | null; createdAt: string | null }>) => ({
    provider: "claude",
    sessionId: "abc",
    createdAt: young,
    ...over,
  });
  assert.equal(await unsavedSession(chat({}), none, NOW), true);
  assert.equal(await unsavedSession(chat({}), async () => true, NOW), false);
  assert.equal(await unsavedSession(chat({ sessionId: null }), none, NOW), false, "never started: starts afresh");
  assert.equal(await unsavedSession(chat({ sessionId: "" }), none, NOW), false);
  assert.equal(await unsavedSession(chat({ provider: "codex" }), none, NOW), false, "Codex keeps its own sessions");
});

test("a chat older than its first turn can be is never held back, even with no transcript found", async () => {
  // A transcript in a folder the plugin does not know about must not block a switch for good.
  const old = new Date(NOW - FIRST_TURN_MS - 1).toISOString();
  let looked = false;
  const lookup = async () => ((looked = true), false);
  assert.equal(await unsavedSession({ provider: "claude", sessionId: "abc", createdAt: old }, lookup, NOW), false);
  assert.equal(looked, false, "nothing is read for it");
});

test("a chat whose age is unknown is let through", async () => {
  const none = async () => false;
  assert.equal(await unsavedSession({ provider: "claude", sessionId: "abc", createdAt: null }, none, NOW), false);
  assert.equal(await unsavedSession({ provider: "claude", sessionId: "abc", createdAt: "garbage" }, none, NOW), false);
  assert.equal(await unsavedSession({ provider: "claude", sessionId: "abc" }, none, NOW), false);
});
