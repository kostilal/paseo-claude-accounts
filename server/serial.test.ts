import { test } from "node:test";
import assert from "node:assert/strict";
import { createSerial } from "./serial.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("calls run one at a time, in order, even when the first is slower", async () => {
  const serial = createSerial();
  const log: string[] = [];
  const slow = serial(async () => {
    log.push("a start");
    await tick();
    await tick();
    log.push("a end");
  });
  const fast = serial(async () => {
    log.push("b start");
    log.push("b end");
  });
  await Promise.all([slow, fast]);
  assert.deepEqual(log, ["a start", "a end", "b start", "b end"]);
});

test("a failed call rejects its own caller and does not stop the next", async () => {
  const serial = createSerial();
  const failed = serial(async () => {
    throw new Error("boom");
  });
  const next = serial(async () => "ran");
  await assert.rejects(failed, /boom/);
  assert.equal(await next, "ran");
});
