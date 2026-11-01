import { test } from "node:test";
import assert from "node:assert/strict";
import { humanDuration, viewLimits } from "./limits.ts";

const NOW = Date.parse("2026-10-31T17:00:00Z");

const reading = {
  state: "ok" as const,
  fiveHour: { utilization: 42, resetsAt: "2026-10-31T19:10:00Z" },
  sevenDay: { utilization: 61, resetsAt: "2026-11-03T10:00:00Z" },
  error: "",
};

test("each window says what is used, what is left and when it resets, in words and in seconds", () => {
  const view = viewLimits(reading, { measuredAt: NOW - 190_000, heldUntil: null }, NOW);
  assert.equal(view.usage, "ok");
  assert.deepEqual(view.fiveHour, {
    utilization: 42,
    left: 58,
    resetsAt: "2026-10-31T19:10:00Z",
    resetsInSeconds: 7800,
    resetsIn: "2 h 10 min",
  });
  assert.equal(view.sevenDay?.left, 39);
  assert.equal(view.sevenDay?.resetsIn, "2 d 17 h");
});

test("the age of the numbers is when they were measured, not when they were asked for", () => {
  const view = viewLimits(reading, { measuredAt: NOW - 190_000, heldUntil: null }, NOW);
  assert.equal(view.usageAt, new Date(NOW - 190_000).toISOString());
  assert.equal(view.usageAgeSeconds, 190);
  assert.equal(view.usageStale, false);
  assert.equal(view.usageHeldSeconds, 0);
});

test("numbers become stale after ten minutes", () => {
  assert.equal(viewLimits(reading, { measuredAt: NOW - 599_000, heldUntil: null }, NOW).usageStale, false);
  assert.equal(viewLimits(reading, { measuredAt: NOW - 601_000, heldUntil: null }, NOW).usageStale, true);
});

test("numbers kept while the endpoint rate-limits are stale, and say how long they are held", () => {
  const view = viewLimits(reading, { measuredAt: NOW - 120_000, heldUntil: NOW + 1_380_000 }, NOW);
  assert.equal(view.usageHeldSeconds, 1380);
  assert.equal(view.usageStale, true);
  assert.equal(view.usageAgeSeconds, 120);
  // A hold that is over holds nothing.
  assert.equal(viewLimits(reading, { measuredAt: NOW - 120_000, heldUntil: NOW - 1 }, NOW).usageHeldSeconds, 0);
});

test("a window that has already reset makes the reading stale: the percentage no longer holds", () => {
  const old = { ...reading, fiveHour: { utilization: 97, resetsAt: "2026-10-31T16:30:00Z" } };
  const view = viewLimits(old, { measuredAt: NOW - 60_000, heldUntil: null }, NOW);
  assert.equal(view.usageStale, true);
  assert.equal(view.fiveHour?.resetsInSeconds, 0);
  assert.equal(view.fiveHour?.resetsIn, "already passed");
});

test("left never leaves 0 to 100, and keeps a fraction", () => {
  const over = { ...reading, fiveHour: { utilization: 103, resetsAt: "" }, sevenDay: { utilization: 37.5, resetsAt: "" } };
  const view = viewLimits(over, null, NOW);
  assert.equal(view.fiveHour?.left, 0);
  assert.equal(view.sevenDay?.left, 62.5);
});

test("a window with no reset time says so rather than inventing one", () => {
  const view = viewLimits({ ...reading, fiveHour: { utilization: 0, resetsAt: "" } }, null, NOW);
  assert.equal(view.fiveHour?.resetsInSeconds, null);
  assert.equal(view.fiveHour?.resetsIn, "");
});

test("no reading at all is not measured, never a zero", () => {
  const view = viewLimits(null, null, NOW);
  assert.equal(view.usage, "not-measured");
  assert.equal(view.fiveHour, null);
  assert.equal(view.sevenDay, null);
  assert.equal(view.usageAt, "");
  assert.equal(view.usageAgeSeconds, null);
  assert.equal(view.usageStale, false);
});

test("an answer without numbers carries its state and error, and is not called stale", () => {
  const view = viewLimits({ state: "expired", fiveHour: null, sevenDay: null, error: "" }, { measuredAt: NOW - 5_000, heldUntil: null }, NOW);
  assert.equal(view.usage, "expired");
  assert.equal(view.fiveHour, null);
  assert.equal(view.usageStale, false);
  assert.equal(view.usageAgeSeconds, 5);
  const failed = viewLimits({ state: "error", fiveHour: null, sevenDay: null, error: "rate limited by the usage endpoint" }, null, NOW);
  assert.equal(failed.usageError, "rate limited by the usage endpoint");
});

test("durations read the way a person says them", () => {
  assert.equal(humanDuration(0), "under a minute");
  assert.equal(humanDuration(59), "under a minute");
  assert.equal(humanDuration(60), "1 min");
  assert.equal(humanDuration(3540), "59 min");
  assert.equal(humanDuration(3600), "1 h");
  assert.equal(humanDuration(7800), "2 h 10 min");
  assert.equal(humanDuration(86_400), "1 d");
  assert.equal(humanDuration(90_000), "1 d 1 h");
  assert.equal(humanDuration(234_000), "2 d 17 h");
});
