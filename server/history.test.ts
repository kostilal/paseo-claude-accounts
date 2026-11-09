import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appended, createHistory } from "./history.ts";
import type { UsageResult } from "./usage.ts";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 8, 12);
const fiveResets = "2026-11-08T15:00:00.000Z";
const weekResets = "2026-11-12T09:00:00.000Z";

const ok = (five: number | null, week: number | null): UsageResult => ({
  state: "ok",
  fiveHour: five === null ? null : { utilization: five, resetsAt: fiveResets },
  sevenDay: week === null ? null : { utilization: week, resetsAt: weekResets },
  error: "",
});

async function fresh(now = () => NOW) {
  const path = join(await mkdtemp(join(tmpdir(), "accounts-history-")), "state", "usage-history.json");
  return { path, history: createHistory({ path, now, log: () => {} }) };
}

test("a reading is kept and read back as a sample with its reset times", async () => {
  const { history } = await fresh();
  await history.record("/a", ok(40, 10), NOW);
  assert.deepEqual(await history.samplesOf(["/a"]), [
    { t: NOW, five: { used: 40, resetsAt: Date.parse(fiveResets) }, week: { used: 10, resetsAt: Date.parse(weekResets) } },
  ]);
});

test("a window the account does not have stays null", async () => {
  const { history } = await fresh();
  await history.record("/a", ok(null, 10), NOW);
  assert.equal((await history.samplesOf(["/a"]))[0]!.five, null);
});

test("only ok readings are history", async () => {
  const { history } = await fresh();
  await history.record("/a", { state: "error", fiveHour: null, sevenDay: null, error: "boom" }, NOW);
  assert.deepEqual(await history.samplesOf(["/a"]), []);
});

test("it survives a restart, and the file is private", async () => {
  const { path, history } = await fresh();
  await history.record("/a", ok(40, 10), NOW);
  const again = createHistory({ path, now: () => NOW, log: () => {} });
  assert.equal((await again.samplesOf(["/a"])).length, 1);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("the readings of a login's directories are merged, oldest first", async () => {
  const { history } = await fresh();
  await history.record("/a", ok(40, 10), NOW - HOUR);
  await history.record("/b", ok(50, 11), NOW - 2 * HOUR);
  await history.record("/a", ok(60, 12), NOW);
  assert.deepEqual((await history.samplesOf(["/a", "/b", "/a"])).map((sample) => sample.t), [NOW - 2 * HOUR, NOW - HOUR, NOW]);
});

test("a quiet stretch keeps only its first and latest reading", () => {
  const same = (t: number): [number, null, null, number, number] => [t, null, null, 10, 99];
  let rows = appended([], same(NOW), NOW + 3 * HOUR);
  rows = appended(rows, same(NOW + HOUR), NOW + 3 * HOUR);
  rows = appended(rows, same(NOW + 2 * HOUR), NOW + 3 * HOUR);
  rows = appended(rows, same(NOW + 3 * HOUR), NOW + 3 * HOUR);
  assert.deepEqual(rows.map((row) => row[0]), [NOW, NOW + 3 * HOUR]);
});

test("a change starts a new run instead of replacing the last row", () => {
  const row = (t: number, used: number): [number, null, null, number, number] => [t, null, null, used, 99];
  const rows = appended([row(NOW, 10), row(NOW + HOUR, 10)], row(NOW + 2 * HOUR, 11), NOW + 2 * HOUR);
  assert.deepEqual(rows.map((item) => item[3]), [10, 10, 11]);
});

test("readings older than a week and a day are dropped", () => {
  const row = (t: number): [number, null, null, number, number] => [t, null, null, 1, 99];
  const rows = appended([row(NOW - 9 * 24 * HOUR), row(NOW - HOUR)], [NOW, null, null, 2, 99], NOW);
  assert.deepEqual(rows.map((item) => item[0]), [NOW - HOUR, NOW]);
});

test("a file that is not ours reads as empty and is replaced by the next reading", async () => {
  const { path, history } = await fresh();
  await history.record("/a", ok(1, 1), NOW);
  await writeFile(path, "not json", "utf8");
  const again = createHistory({ path, now: () => NOW, log: () => {} });
  assert.deepEqual(await again.samplesOf(["/a"]), []);
  await again.record("/b", ok(2, 2), NOW);
  assert.ok(JSON.parse(await readFile(path, "utf8")).homes["/b"]);
});

test("a write that fails is logged and never reaches the caller", async () => {
  const lines: string[] = [];
  const history = createHistory({ path: "/dev/null/nope/history.json", now: () => NOW, log: (line) => lines.push(line) });
  await history.record("/a", ok(1, 1), NOW);
  assert.equal(lines.length, 1);
  assert.equal((await history.samplesOf(["/a"])).length, 1);
});
