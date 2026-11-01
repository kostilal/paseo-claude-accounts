import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeApplied } from "./applied.ts";
import type { OpenRecord } from "./sessionLedger.ts";
import type { SessionDir } from "./sessionDir.ts";

const target = { provider: "claude" as const, home: "/Users/me/.claude-account-3" };
const noProcess: SessionDir = { found: false, configDir: null };

function judge(overrides: { record?: OpenRecord; live?: SessionDir; target?: { provider: "claude" | "codex"; home: string } } = {}) {
  return judgeApplied({
    record: overrides.record,
    live: overrides.live ?? noProcess,
    provider: overrides.target?.provider ?? "claude",
    target: overrides.target ?? target,
    defaultDir: "/Users/me/.claude",
    since: 1_000,
  });
}

const opened = (injected: string | undefined, at = 1_500): OpenRecord => ({ at, reason: "refresh", provider: "claude", injected });

test("the hook gave the new session the account asked for", () => {
  assert.equal(judge({ record: opened(target.home) }).verdict, "match");
  assert.equal(judge({ record: opened(target.home, 1_000) }).verdict, "match", "the very moment the switch began counts");
});

test("an open from before the switch says nothing about it", () => {
  const result = judge({ record: opened(target.home, 999) });
  assert.equal(result.verdict, "unknown");
  assert.match(result.reason, /not .*since|since/i);
  assert.equal(judge({}).verdict, "unknown");
});

test("a session the hook left alone did not move, and says why", () => {
  const result = judge({ record: opened(undefined) });
  assert.equal(result.verdict, "mismatch");
  assert.match(result.reason, /left the session alone/);
});

test("a session given another account did not move either", () => {
  const result = judge({ record: opened("/Users/me/.claude-account-1") });
  assert.equal(result.verdict, "mismatch");
  assert.match(result.reason, /another account/);
});

test("the default directory is selected by an empty value", () => {
  const home = { provider: "claude" as const, home: "/Users/me/.claude" };
  assert.equal(judge({ target: home, record: opened("") }).verdict, "match");
  assert.equal(judge({ target: home, record: opened(home.home) }).verdict, "mismatch", "the path would be hashed into an empty item");
});

test("a codex session is pointed at the directory itself", () => {
  const cdx = { provider: "codex" as const, home: "/Users/me/.codex-account-1" };
  const record: OpenRecord = { at: 1_500, reason: "refresh", provider: "codex", injected: cdx.home };
  assert.equal(judge({ target: cdx, record }).verdict, "match");
});

test("a running process that agrees is proof on its own", () => {
  const live: SessionDir = { found: true, configDir: "/p/.claude-data", credentialDir: target.home };
  assert.equal(judge({ live }).verdict, "match");
});

test("a running process that disagrees with the hook's record is not taken for either", () => {
  const live: SessionDir = { found: true, configDir: "/p/.claude-data", credentialDir: "/Users/me/.claude-account-1" };
  const result = judge({ live, record: opened(target.home) });
  assert.equal(result.verdict, "unknown");
  assert.match(result.reason, /process/);
  // Without the hook's record a process alone is not enough to call it wrong: it may be the old one.
  assert.equal(judge({ live }).verdict, "unknown");
});
