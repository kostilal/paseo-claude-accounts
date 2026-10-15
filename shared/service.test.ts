import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceName } from "./service.ts";

const DEFAULT = "/Users/me/.claude";

test("the default directory keeps the unhashed name", async () => {
  assert.equal(await serviceName(DEFAULT, DEFAULT), "Claude Code-credentials");
});

test("a trailing slash does not change the answer", async () => {
  assert.equal(await serviceName(`${DEFAULT}/`, DEFAULT), "Claude Code-credentials");
});

test("every other directory is hashed", async () => {
  // The first eight hex characters of the SHA-256 of the path, as Claude Code names them.
  const cases: Array<[string, string]> = [
    ["/Users/me/.claude-work", "1e91dd84"],
    ["/Users/me/.claude-personal", "ec5d0230"],
    ["/Users/me/Work/acme/.claude-data", "cf50dada"],
    ["/home/test/.claude-work-data", "bf81d3f5"],
  ];
  for (const [dir, hash] of cases) {
    assert.equal(await serviceName(dir, DEFAULT), `Claude Code-credentials-${hash}`);
  }
});

test("a trailing slash on a hashed directory hashes the same path", async () => {
  assert.equal(await serviceName("/Users/me/.claude-work/", DEFAULT), "Claude Code-credentials-1e91dd84");
});
