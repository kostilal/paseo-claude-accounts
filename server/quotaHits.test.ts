import { test } from "node:test";
import assert from "node:assert/strict";
import { type QuotaFs, createQuotaHits, rawBar, readLines, withHits } from "./quotaHits.ts";
import type { UsageResult } from "./usage.ts";

const NOW = Date.parse("2026-11-25T14:20:00Z");
const RESET = Date.parse("2026-11-25T16:10:00Z");

const owner = (accountUuid: string, organizationUuid = "org-1") =>
  JSON.stringify({ type: "session-owner", accountUuid, organizationUuid, sessionId: "s" });
const refusal = (rateLimitType: string, resetsAt = RESET / 1000, status = "rejected", timestamp?: string) =>
  JSON.stringify({
    type: "assistant",
    isApiErrorMessage: true,
    message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your 5-hour limit" }] },
    ...(timestamp === undefined ? {} : { timestamp }),
    error: "rate_limit",
    quotaLimits: { status, resetsAt, rateLimitType, overageStatus: "rejected", isUsingOverage: false },
  });

const answer = (timestamp: string, model = "claude-opus-5-5") =>
  JSON.stringify({ type: "assistant", timestamp, message: { model, content: [{ type: "text", text: "done" }] } });

const ok = (fiveHour: UsageResult["fiveHour"], sevenDay: UsageResult["sevenDay"] = { utilization: 79, resetsAt: "2026-11-27T14:00:00Z" }): UsageResult => ({
  state: "ok",
  fiveHour,
  sevenDay,
  error: "",
});

test("a refusal is pinned on the owner in force when it was written", () => {
  const { hits, owner: last } = readLines(
    [owner("acc-a"), refusal("five_hour"), owner("acc-b"), JSON.stringify({ type: "user" })],
    null,
  );
  assert.deepEqual(hits, [{ accountId: "acc-a", orgId: "org-1", window: "fiveHour", resetsAt: RESET, at: 0 }]);
  assert.deepEqual(last, { accountId: "acc-b", orgId: "org-1" });
});

test("a model's reply is an answer to the owner in force; an error in its place is not", () => {
  const { answered, hits } = readLines(
    [
      answer("2026-11-25T13:00:00Z"),
      owner("acc-a"),
      answer("2026-11-25T14:00:00Z"),
      refusal("five_hour", RESET / 1000, "rejected", "2026-11-25T14:03:00Z"),
      JSON.stringify({ type: "assistant", isApiErrorMessage: true, timestamp: "2026-11-25T14:05:00Z", message: { model: "claude-opus-5-5" } }),
      answer("2026-11-25T14:06:00Z", "<synthetic>"),
      owner("acc-b"),
      answer("2026-11-25T14:10:00Z"),
    ],
    null,
  );
  assert.equal(hits[0]?.at, Date.parse("2026-11-25T14:03:00Z"));
  assert.deepEqual(
    [...answered],
    [
      ["acc-a\norg-1", Date.parse("2026-11-25T14:00:00Z")],
      ["acc-b\norg-1", Date.parse("2026-11-25T14:10:00Z")],
    ],
  );
});

test("refusals with no owner, of unknown windows, or not rejected are ignored", () => {
  const { hits } = readLines(
    [refusal("five_hour"), owner("acc-a"), refusal("overage"), refusal("five_hour", RESET / 1000, "allowed"), "{not json"],
    null,
  );
  assert.deepEqual(hits, []);
});

test("a live refusal fills the window the endpoint left out", () => {
  const result = withHits(ok(null), [{ accountId: "a", orgId: "o", window: "fiveHour", resetsAt: RESET, at: 0 }], NOW);
  assert.equal(result.state, "ok");
  assert.deepEqual(result.fiveHour, { utilization: 100, resetsAt: new Date(RESET).toISOString() });
  assert.equal(result.sevenDay?.utilization, 79);
});

test("a refusal overrides a lower reported number, and a reading with no windows becomes ok", () => {
  const hit = [{ accountId: "a", orgId: "o", window: "fiveHour" as const, resetsAt: RESET, at: 0 }];
  assert.equal(withHits(ok({ utilization: 40, resetsAt: "x" }), hit, NOW).fiveHour?.utilization, 100);
  const none: UsageResult = { state: "none", fiveHour: null, sevenDay: null, error: "" };
  assert.equal(withHits(none, hit, NOW).state, "ok");
});

test("a refusal whose window has reset, or a reading with no numbers, is left alone", () => {
  const past = [{ accountId: "a", orgId: "o", window: "fiveHour" as const, resetsAt: NOW - 1, at: 0 }];
  assert.equal(withHits(ok(null), past, NOW).fiveHour, null);
  const expired: UsageResult = { state: "expired", fiveHour: null, sevenDay: null, error: "" };
  const live = [{ accountId: "a", orgId: "o", window: "fiveHour" as const, resetsAt: RESET, at: 0 }];
  assert.equal(withHits(expired, live, NOW), expired);
});

function memoryFs(files: Map<string, string>): QuotaFs {
  return {
    list: async (path) => {
      const prefix = `${path}/`;
      const names = new Set<string>();
      for (const file of files.keys()) if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split("/")[0]!);
      return [...names];
    },
    stat: async (path) => {
      const text = files.get(path);
      return text === undefined ? null : { size: Buffer.byteLength(text), mtimeMs: NOW };
    },
    read: async (path, from, to) => Buffer.from(files.get(path) ?? "").subarray(from, to).toString("utf8"),
  };
}

test("transcripts are read incrementally, and subagent transcripts are not read", async () => {
  const main = "/h/.claude/projects/p/s1.jsonl";
  const sub = "/h/.claude/projects/p/s1/subagents/agent-1.jsonl";
  const files = new Map([
    [main, `${owner("acc-a")}\n${refusal("five_hour")}\n`],
    [sub, `${owner("acc-c")}\n${refusal("five_hour")}\n`],
  ]);
  let now = NOW;
  const hits = createQuotaHits({ fs: memoryFs(files), now: () => now });
  hits.watch(["/h/.claude"]);
  await hits.refresh();
  assert.equal(hits.of("acc-a", "org-1").length, 1);
  assert.equal(hits.of("acc-c", "org-1").length, 0);

  // A refusal written later, half a line at a time, is read once it is complete.
  const line = refusal("five_hour", RESET / 1000 + 600);
  files.set(main, `${files.get(main)}${owner("acc-b")}\n${line.slice(0, 20)}`);
  now += 60_000;
  await hits.refresh();
  assert.equal(hits.of("acc-b", "org-1").length, 0);
  files.set(main, `${files.get(main)}${line.slice(20)}\n`);
  now += 60_000;
  await hits.refresh();
  assert.equal(hits.of("acc-b", "org-1").length, 1);

  // A rewritten (shorter) file is read again from the start.
  files.set(main, `${owner("acc-a")}\n`);
  now += 60_000;
  await hits.refresh();
  assert.equal(hits.of("acc-a", "org-1").length, 0);
  assert.equal(hits.of("acc-b", "org-1").length, 0);
});

test("a refresh within a minute of the last one reads nothing", async () => {
  const main = "/h/.claude/projects/p/s1.jsonl";
  const files = new Map([[main, `${owner("acc-a")}\n`]]);
  let now = NOW;
  const hits = createQuotaHits({ fs: memoryFs(files), now: () => now });
  hits.watch(["/h/.claude"]);
  await hits.refresh();
  files.set(main, `${files.get(main)}${refusal("five_hour")}\n`);
  now += 10_000;
  await hits.refresh();
  assert.equal(hits.of("acc-a", "org-1").length, 0);
  now += 60_000;
  await hits.refresh();
  assert.equal(hits.of("acc-a", "org-1").length, 1);
});

test("rawBar gives back the endpoint's own bar behind an overlaid one", () => {
  const hit = [{ accountId: "a", orgId: "o", window: "fiveHour" as const, resetsAt: RESET, at: 0 }];
  const reported = { utilization: 40, resetsAt: "x" };
  const over = withHits(ok(reported), hit, NOW);
  assert.equal(over.fiveHour?.utilization, 100);
  assert.equal(rawBar(over.fiveHour), reported);
  assert.equal(rawBar(withHits(ok(null), hit, NOW).fiveHour), null);
  assert.equal(rawBar(over.sevenDay), over.sevenDay);
});

test("a refusal stops counting once the same login is answered after it, in any chat", async () => {
  const chatA = "/h/.claude/projects/p/a.jsonl";
  const chatB = "/h/.claude/projects/q/b.jsonl";
  const files = new Map([
    [chatA, `${owner("acc-a")}\n${answer("2026-11-25T14:00:00Z")}\n${refusal("five_hour", RESET / 1000, "rejected", "2026-11-25T14:03:00Z")}\n`],
    [chatB, `${owner("acc-b")}\n${answer("2026-11-25T14:10:00Z")}\n`],
  ]);
  let now = NOW;
  const hits = createQuotaHits({ fs: memoryFs(files), now: () => now });
  hits.watch(["/h/.claude"]);
  await hits.refresh();
  // Another login's answer does not lift it.
  assert.equal(hits.of("acc-a", "org-1").length, 1);

  // The server lifted the limit before the time it gave: a chat on the same login is answered.
  files.set(chatB, `${files.get(chatB)}${owner("acc-a")}\n${answer("2026-11-25T15:04:00Z")}\n`);
  now += 60_000;
  await hits.refresh();
  assert.equal(hits.of("acc-a", "org-1").length, 0);

  // A new refusal after that answer counts again.
  files.set(chatA, `${files.get(chatA)}${refusal("five_hour", RESET / 1000, "rejected", "2026-11-25T15:10:00Z")}\n`);
  now += 60_000;
  await hits.refresh();
  assert.equal(hits.of("acc-a", "org-1").length, 1);
});

test("an answer is dated by its request: one already streaming when the limit hit does not lift it", async () => {
  const chatA = "/h/.claude/projects/p/a.jsonl";
  const chatB = "/h/.claude/projects/q/b.jsonl";
  const request = (timestamp: string) => JSON.stringify({ type: "api-request", timestamp });
  const files = new Map([
    [chatA, `${owner("acc-a")}\n${refusal("five_hour", RESET / 1000, "rejected", "2026-11-25T14:03:00Z")}\n`],
    // Accepted at 14:02:50, its text written at 14:03:40, after the refusal.
    [chatB, `${request("2026-11-25T14:02:50Z")}\n${owner("acc-a")}\n${answer("2026-11-25T14:03:40Z")}\n`],
  ]);
  let now = NOW;
  const hits = createQuotaHits({ fs: memoryFs(files), now: () => now });
  hits.watch(["/h/.claude"]);
  await hits.refresh();
  assert.equal(hits.of("acc-a", "org-1").length, 1);

  // A request sent after the refusal, answered, lifts it.
  files.set(chatB, `${files.get(chatB)}${request("2026-11-25T15:04:00Z")}\n${answer("2026-11-25T15:04:05Z")}\n`);
  now += 60_000;
  await hits.refresh();
  assert.equal(hits.of("acc-a", "org-1").length, 0);
});

test("a refusal with no time holds until its reset, whatever answers there are", async () => {
  const chat = "/h/.claude/projects/p/a.jsonl";
  const files = new Map([[chat, `${owner("acc-a")}\n${refusal("five_hour")}\n${answer("2026-11-25T15:04:00Z")}\n`]]);
  const hits = createQuotaHits({ fs: memoryFs(files), now: () => NOW });
  hits.watch(["/h/.claude"]);
  await hits.refresh();
  assert.equal(hits.of("acc-a", "org-1").length, 1);
});
