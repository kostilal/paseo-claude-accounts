import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { emptyRegistry } from "../shared/registry.ts";
import { loadRegistry, readRegistry, writeRegistry } from "./store.ts";

async function scratch(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "accounts-")), "accounts.json");
}

/** Everything in the directory apart from the state file itself. */
async function siblings(path: string): Promise<string[]> {
  return (await readdir(dirname(path))).filter((name) => name !== basename(path));
}

const quiet = () => {};

test("an absent file reads as an empty registry", async () => {
  assert.deepEqual(await readRegistry(await scratch()), emptyRegistry());
});

test("what is written comes back", async () => {
  const path = await scratch();
  const value = {
    version: 2 as const,
    accounts: [{ id: "work", label: "Work", provider: "claude" as const, home: "/w/acme/.claude-data" }],
    agents: { ag1: "work" },
    hidden: ["/Users/me/.claude-old"],
  };
  await writeRegistry(value, path);
  assert.deepEqual(await readRegistry(path), value);
});

test("a version 1 file is unreadable, not read as empty", async () => {
  const path = await scratch();
  await writeFile(
    path,
    JSON.stringify({ version: 1, default: "/Users/me/.claude", projects: {}, agents: {} }),
    "utf8",
  );
  const read = await loadRegistry(path);
  assert.equal(read.state, "unreadable");
  assert.deepEqual(read.registry, emptyRegistry());
});

test("unreadable content reads as an empty registry rather than throwing", async () => {
  const path = await scratch();
  await writeFile(path, "{ not json", "utf8");
  assert.deepEqual(await readRegistry(path), emptyRegistry());
});

test("an absent file and an unreadable one are different answers", async () => {
  const missing = await scratch();
  assert.equal((await loadRegistry(missing)).state, "absent");

  const broken = await scratch();
  await writeFile(broken, "{ not json", "utf8");
  assert.equal((await loadRegistry(broken)).state, "unreadable");

  const good = await scratch();
  await writeRegistry(emptyRegistry(), good, quiet);
  assert.equal((await loadRegistry(good)).state, "ok");
});

test("a state file this version cannot read is kept, not overwritten", async () => {
  const path = await scratch();
  const original = '{ "version": 2, "accounts": [ hand-edited into nonsense';
  await writeFile(path, original, "utf8");

  // What every writer does: read (which answers empty), modify, write.
  await writeRegistry(emptyRegistry(), path, quiet);

  const kept = await siblings(path);
  assert.equal(kept.length, 1, "the unreadable file should have been moved aside, not deleted");
  assert.match(kept[0]!, /\.unreadable-/);
  assert.equal(await readFile(join(dirname(path), kept[0]!), "utf8"), original);
});

test("an account whose provider this version does not know is not silently destroyed", async () => {
  // One unknown provider fails the whole file, so the bytes must survive the next write.
  const path = await scratch();
  const fromTheFuture = JSON.stringify({
    version: 2,
    accounts: [
      { id: "work", label: "Work", provider: "claude", home: "/w/acme/.claude-data" },
      { id: "gem", label: "Gem", provider: "gemini", home: "/w/gem/.gemini" },
    ],
    agents: {},
  });
  await writeFile(path, fromTheFuture, "utf8");
  assert.equal((await loadRegistry(path)).state, "unreadable");

  await writeRegistry(emptyRegistry(), path, quiet);
  const kept = await siblings(path);
  assert.equal(kept.length, 1);
  assert.equal(await readFile(join(dirname(path), kept[0]!), "utf8"), fromTheFuture);
});

test("an ordinary write leaves no aside copy and no temp file behind", async () => {
  const path = await scratch();
  await writeRegistry(emptyRegistry(), path, quiet);
  assert.deepEqual(await siblings(path), []);
  await writeRegistry(emptyRegistry(), path, quiet);
  assert.deepEqual(await siblings(path), []);
});
