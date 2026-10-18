import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateFromTokens } from "./migrate.ts";

async function tempFile(contents?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "accounts-migrate-"));
  const path = join(dir, "accounts.json");
  if (contents !== undefined) await writeFile(path, contents, "utf8");
  return path;
}

const legacy = JSON.stringify({
  version: 2,
  accounts: [
    { id: "work", label: "Work", provider: "claude", home: "/w/acme/.claude-data", tokenLogin: "alice@example.com", tokenOrg: "org-team" },
    { id: "home", label: "Home", provider: "claude", home: "/Users/me/.claude", tokenLogin: "bob@example.com" },
  ],
  agents: { ag1: "work" },
});

test("a 0.1.x file loses its switching-key fields and the Keychain is purged", async () => {
  const path = await tempFile(legacy);
  let purged = 0;
  await migrateFromTokens(path, () => {}, async () => void (purged += 1));

  assert.equal(purged, 1, "the plugin's Keychain service is swept once");
  const after = JSON.parse(await readFile(path, "utf8"));
  assert.equal(after.accounts.length, 2);
  for (const account of after.accounts) {
    assert.equal(Object.hasOwn(account, "tokenLogin"), false);
    assert.equal(Object.hasOwn(account, "tokenOrg"), false);
  }
  // The rest of the account survives.
  assert.equal(after.accounts[0].home, "/w/acme/.claude-data");
  assert.deepEqual(after.agents, { ag1: "work" });
});

test("an already-migrated file is left untouched and the Keychain is not swept", async () => {
  const current = JSON.stringify({ version: 2, accounts: [{ id: "work", label: "Work", provider: "claude", home: "/w/.claude-data" }], agents: {} });
  const path = await tempFile(current);
  let purged = 0;
  await migrateFromTokens(path, () => {}, async () => void (purged += 1));
  assert.equal(purged, 0);
  assert.equal(await readFile(path, "utf8"), current);
});

test("no state file is a no-op", async () => {
  const path = await tempFile();
  let purged = 0;
  await assert.doesNotReject(migrateFromTokens(path, () => {}, async () => void (purged += 1)));
  assert.equal(purged, 0);
});

test("an unreadable file is not rewritten and the Keychain is not swept", async () => {
  const path = await tempFile('{ "tokenLogin": not json');
  let purged = 0;
  await migrateFromTokens(path, () => {}, async () => void (purged += 1));
  assert.equal(purged, 0);
  assert.equal(await readFile(path, "utf8"), '{ "tokenLogin": not json');
});
