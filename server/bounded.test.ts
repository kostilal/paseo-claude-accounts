import { test } from "node:test";
import assert from "node:assert/strict";
import { bounded } from "./bounded.ts";

const later = <T>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

test("a quick answer is the answer", async () => {
  assert.equal(await bounded(later("done", 1), 200, "gave up"), "done");
});

test("a slow one is replaced by the fallback, and its late answer is dropped", async () => {
  assert.equal(await bounded(later("done", 100), 5, "gave up"), "gave up");
});

test("work that fails counts as the fallback rather than throwing", async () => {
  assert.equal(await bounded(Promise.reject(new Error("no")), 200, "gave up"), "gave up");
});
