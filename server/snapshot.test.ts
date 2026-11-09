import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountView, Overview } from "../shared/accounts.ts";
import { createSnapshot, keepLastGood } from "./snapshot.ts";

async function tempFile() {
  const dir = await mkdtemp(join(tmpdir(), "accounts-snapshot-"));
  return join(dir, "overview-snapshot.json");
}

function row(key: string, over: Partial<AccountView> = {}): AccountView {
  return {
    id: key,
    name: key,
    home: `/h/${key}`,
    provider: "claude",
    registered: true,
    key,
    loggedIn: true,
    email: `${key}@x`,
    orgName: "",
    subscriptionType: "",
    accountIds: [key],
    switchTo: key,
    isDefault: false,
    autoNow: false,
    usage: "ok",
    fiveHour: { utilization: 18, resetsAt: "2026-11-08T22:00:00Z" },
    sevenDay: null,
    usageErrorCode: "",
    usageError: "",
    usageAt: 100,
    heldUntil: null,
    rateLimitTier: "",
    ...over,
  };
}

const overview = (...accounts: AccountView[]): Overview => ({ accounts, hidden: [], error: "", overridingVar: "" });

const failedRow = (key: string) =>
  row(key, { usage: "error", fiveHour: null, sevenDay: null, usageError: "rate limited", usageAt: 200 });

test("a saved overview reads back, from memory and from the file in a fresh daemon", async () => {
  const path = await tempFile();
  const snapshot = createSnapshot({ path, now: () => 5_000, log: () => {} });
  await snapshot.save(overview(row("a")));
  assert.deepEqual(await snapshot.read(), { overview: overview(row("a")), savedAt: 5_000 });

  const restarted = createSnapshot({ path, now: () => 9_000, log: () => {} });
  assert.deepEqual(await restarted.read(), { overview: overview(row("a")), savedAt: 5_000 });
});

test("the file holds emails, so only its owner can read it", async () => {
  const path = await tempFile();
  await createSnapshot({ path, log: () => {} }).save(overview(row("a")));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("no file and an unreadable file both read as no snapshot", async () => {
  const absent = createSnapshot({ path: await tempFile(), log: () => {} });
  assert.deepEqual(await absent.read(), { overview: null, savedAt: null });

  const path = await tempFile();
  await writeFile(path, "{ not json");
  assert.deepEqual(await createSnapshot({ path, log: () => {} }).read(), { overview: null, savedAt: null });

  const wrongShape = await tempFile();
  await writeFile(wrongShape, JSON.stringify({ savedAt: "yesterday", overview: 3 }));
  assert.deepEqual(await createSnapshot({ path: wrongShape, log: () => {} }).read(), { overview: null, savedAt: null });
});

test("an unreadable file is replaced by the next save", async () => {
  const path = await tempFile();
  await writeFile(path, "{ not json");
  const snapshot = createSnapshot({ path, now: () => 1_000, log: () => {} });
  await snapshot.save(overview(row("a")));
  assert.equal((await createSnapshot({ path, log: () => {} }).read()).savedAt, 1_000);
});

test("a failed write is logged and resolves, and the snapshot still works from memory", async () => {
  const lines: string[] = [];
  const dir = await mkdtemp(join(tmpdir(), "accounts-snapshot-"));
  // A directory where the file should be: the write cannot replace it.
  const path = join(dir, "overview-snapshot.json");
  await mkdir(path);
  const snapshot = createSnapshot({ path, now: () => 3_000, log: (line) => lines.push(line) });
  await snapshot.save(overview(row("a")));
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /could not save/);
  assert.equal((await snapshot.read()).savedAt, 3_000);
});

test("a row that lost its numbers keeps the last good ones in the snapshot", async () => {
  const path = await tempFile();
  let clock = 1_000;
  const snapshot = createSnapshot({ path, now: () => clock, log: () => {} });
  await snapshot.save(overview(row("a", { usageAt: 150 })));
  clock = 2_000;
  await snapshot.save(overview(failedRow("a")));

  const kept = (await snapshot.read()).overview?.accounts[0];
  assert.equal(kept?.usage, "ok");
  assert.equal(kept?.fiveHour?.utilization, 18);
  assert.equal(kept?.usageAt, 150);
  assert.equal(kept?.usageError, "", "the numbers shown come with the state they were read in");
});

test("keeping the last good numbers survives several failures in a row", () => {
  const first = keepLastGood(overview(row("a")), null);
  const second = keepLastGood(overview(failedRow("a")), first);
  const third = keepLastGood(overview(failedRow("a")), second);
  assert.equal(third.accounts[0]?.usage, "ok");
  assert.equal(third.accounts[0]?.fiveHour?.utilization, 18);
});

test("a real answer stands: no numbers and `none`, a new reading, and other rows", () => {
  const previous = overview(row("a"), row("b"));
  const none = row("a", { usage: "none", fiveHour: null, sevenDay: null });
  const updated = row("b", { fiveHour: { utilization: 40, resetsAt: "x" } });
  const merged = keepLastGood(overview(none, updated), previous);
  assert.equal(merged.accounts[0]?.usage, "none");
  assert.equal(merged.accounts[0]?.fiveHour, null);
  assert.equal(merged.accounts[1]?.fiveHour?.utilization, 40);
});

test("a row with nothing to keep stays as it is", () => {
  const previous = overview(row("a", { usage: "unauthorised", fiveHour: null, sevenDay: null }));
  const merged = keepLastGood(overview(row("a", { usage: "expired", fiveHour: null, sevenDay: null })), previous);
  assert.equal(merged.accounts[0]?.usage, "expired");
  const unmatched = keepLastGood(overview(failedRow("new")), previous);
  assert.equal(unmatched.accounts[0]?.usage, "error");
});

test("an unchanged overview is written again only after five minutes", async () => {
  const path = await tempFile();
  let clock = 1_000;
  const snapshot = createSnapshot({ path, now: () => clock, log: () => {} });
  const savedAt = async () => (JSON.parse(await readFile(path, "utf8")) as { savedAt: number }).savedAt;

  await snapshot.save(overview(row("a")));
  assert.equal(await savedAt(), 1_000);
  clock += 4 * 60_000;
  await snapshot.save(overview(row("a")));
  assert.equal(await savedAt(), 1_000);
  assert.equal((await snapshot.read()).savedAt, clock, "memory is told even when the disk is not");

  clock += 60_000;
  await snapshot.save(overview(row("a")));
  assert.equal(await savedAt(), clock);
});

test("a changed overview is written at once", async () => {
  const path = await tempFile();
  let clock = 1_000;
  const snapshot = createSnapshot({ path, now: () => clock, log: () => {} });
  await snapshot.save(overview(row("a")));
  clock += 1_000;
  await snapshot.save(overview(row("a", { fiveHour: { utilization: 44, resetsAt: "x" } })));
  const file = JSON.parse(await readFile(path, "utf8")) as { savedAt: number; overview: Overview };
  assert.equal(file.savedAt, 2_000);
  assert.equal(file.overview.accounts[0]?.fiveHour?.utilization, 44);
});

test("no temp files are left behind", async () => {
  const path = await tempFile();
  await createSnapshot({ path, log: () => {} }).save(overview(row("a")));
  const dir = path.slice(0, path.lastIndexOf("/"));
  assert.deepEqual(await readdir(dir), ["overview-snapshot.json"]);
  await chmod(dir, 0o700);
});

test("a row that lost its tier to a failed profile read keeps the last one", async () => {
  const overviewOf = (accounts: AccountView[]): Overview => ({ accounts, hidden: [], error: "", overridingVar: "" });
  const before = overviewOf([row("k", { rateLimitTier: "default_claude_max_20x" })]);
  const after = overviewOf([row("k", { rateLimitTier: "" })]);
  assert.equal(keepLastGood(after, before).accounts[0]!.rateLimitTier, "default_claude_max_20x");
});
