import { test } from "node:test";
import assert from "node:assert/strict";
import { BUNDLED_PASEO, paseoPaths, reloadAgent } from "./reload.ts";

test("the binary inside the application bundle is preferred", async () => {
  const calls: Array<[string, string[]]> = [];
  const result = await reloadAgent("ag1", {
    exists: async (path) => path === BUNDLED_PASEO,
    run: async (file, args) => {
      calls.push([file, args]);
    },
  });
  assert.equal(result.code, "");
  assert.deepEqual(calls, [[BUNDLED_PASEO, ["agent", "reload", "ag1"]]]);
});

test("without the bundle it falls back to whatever is on PATH", async () => {
  const calls: Array<[string, string[]]> = [];
  const result = await reloadAgent("ag1", {
    exists: async () => false,
    run: async (file, args) => {
      calls.push([file, args]);
    },
  });
  assert.equal(result.code, "");
  assert.deepEqual(calls, [["paseo", ["agent", "reload", "ag1"]]]);
});

test("no paseo anywhere is reported as itself, not as a failed switch", async () => {
  const result = await reloadAgent("ag1", {
    exists: async () => false,
    run: async () => {
      const error: NodeJS.ErrnoException = new Error("spawn paseo ENOENT");
      error.code = "ENOENT";
      throw error;
    },
  });
  assert.equal(result.code, "paseo-not-found");
});

test("a reload that ran and failed keeps its own message", async () => {
  const result = await reloadAgent("ag1", {
    exists: async () => true,
    run: async () => {
      throw new Error("agent not found");
    },
  });
  assert.equal(result.code, "reload-failed");
  assert.match(result.error, /agent not found/);
});

test("the system bundle is tried before the one in the user's Applications folder", () => {
  assert.deepEqual(paseoPaths("/Users/me"), [
    BUNDLED_PASEO,
    "/Users/me/Applications/Paseo.app/Contents/Resources/bin/paseo",
  ]);
});

test("a bundle in the user's Applications folder is used when the system one is missing", async () => {
  const userBundle = paseoPaths()[1]!;
  const calls: string[] = [];
  await reloadAgent("ag1", {
    exists: async (path) => path === userBundle,
    run: async (file) => {
      calls.push(file);
    },
  });
  assert.deepEqual(calls, [userBundle]);
});
