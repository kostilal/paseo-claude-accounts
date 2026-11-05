import { test } from "node:test";
import assert from "node:assert/strict";
import type { Account } from "../shared/registry.ts";
import { createChatLimits } from "./chatLimits.ts";
import type { UsageInfo } from "./limits.ts";
import type { UsageResult } from "./usage.ts";

const NOW = Date.parse("2026-10-31T17:00:00Z");

const mine: Account = { id: "mine", label: "Mine", provider: "claude", home: "/h/.claude-mine" };
const twin: Account = { id: "twin", label: "Twin", provider: "claude", home: "/h/.claude-twin" };
const third: Account = { id: "third", label: "Third", provider: "claude", home: "/h/.claude-third" };

const ok = (utilization: number): UsageResult => ({
  state: "ok",
  fiveHour: { utilization, resetsAt: "2026-10-31T19:00:00Z" },
  sevenDay: null,
  error: "",
});
const expired: UsageResult = { state: "expired", fiveHour: null, sevenDay: null, error: "" };

interface Stage {
  cached?: UsageResult;
  stale?: boolean;
  measured?: UsageResult | Promise<UsageResult>;
  info?: UsageInfo;
}

/** A usage cache with a script per directory, remembering every question it was asked. */
function setup(stages: Record<string, Stage>, siblings: Account[] = []) {
  const asked: string[] = [];
  const staleAsked: Array<[string, boolean]> = [];
  const limits = createChatLimits({
    usage: {
      cached: (home) => stages[home]?.cached ?? null,
      stale: (home, force) => (staleAsked.push([home, force === true]), stages[home]?.stale ?? false),
      measure: async (home, _default, manual) => {
        asked.push(`${home}:${manual ? "manual" : "background"}`);
        return stages[home]?.measured ?? expired;
      },
      info: (home) => stages[home]?.info ?? null,
    },
    defaultDir: () => "/h/.claude",
    siblings: async () => siblings,
    readMs: 30,
    now: () => NOW,
  });
  return { limits, asked, staleAsked };
}

const info = (secondsAgo: number): UsageInfo => ({ measuredAt: NOW - secondsAgo * 1000, heldUntil: null });

test("a reading that is not due is taken from the cache, and nothing is measured", async () => {
  const { limits, asked } = setup({ [mine.home]: { cached: ok(42), info: info(120) } });
  const view = await limits(mine, false);
  assert.equal(view.usage, "ok");
  assert.equal(view.fiveHour?.utilization, 42);
  assert.equal(view.usageAgeSeconds, 120);
  assert.deepEqual(asked, []);
});

test("a reading that is due is measured, never with a Keychain dialog a person is not there to answer", async () => {
  const { limits, asked } = setup({ [mine.home]: { cached: ok(10), stale: true, measured: ok(55), info: info(0) } });
  const view = await limits(mine, false);
  assert.equal(view.fiveHour?.utilization, 55);
  assert.deepEqual(asked, [`${mine.home}:background`]);
});

test("force reaches the cache, which decides what a Reload may retake", async () => {
  const { limits, staleAsked } = setup({ [mine.home]: { cached: ok(10), info: info(5) } });
  await limits(mine, true);
  assert.deepEqual(staleAsked, [[mine.home, true]]);
});

test("nothing cached and nothing measurable is not a zero", async () => {
  const { limits } = setup({ [mine.home]: { measured: new Promise(() => {}) } });
  const view = await limits(mine, false);
  assert.equal(view.usage, "not-measured");
  assert.equal(view.fiveHour, null);
});

test("a measurement that takes too long gives way to the cached numbers, which keep their age", async () => {
  const { limits } = setup({ [mine.home]: { cached: ok(30), stale: true, measured: new Promise(() => {}), info: info(900) } });
  const view = await limits(mine, false);
  assert.equal(view.fiveHour?.utilization, 30);
  assert.equal(view.usageAgeSeconds, 900);
  assert.equal(view.usageStale, true);
});

test("a login that cannot answer is read off another directory logged in to the same account", async () => {
  const { limits, asked } = setup(
    {
      [mine.home]: { cached: expired, stale: true, measured: expired, info: info(10) },
      [twin.home]: { cached: ok(61), info: info(200) },
    },
    [twin],
  );
  const view = await limits(mine, false);
  assert.equal(view.usage, "ok");
  assert.equal(view.fiveHour?.utilization, 61);
  assert.equal(view.usageAgeSeconds, 200, "the age is that of the reading used");
  assert.deepEqual(asked, [`${mine.home}:background`]);
});

test("with no other directory on the account, the answer is the account's own", async () => {
  const { limits } = setup({ [mine.home]: { cached: expired, info: info(3) } });
  const view = await limits(mine, false);
  assert.equal(view.usage, "expired");
  assert.equal(view.usageAgeSeconds, 3);
});

test("at most two other directories are tried, and the first that answers is used", async () => {
  const { limits, asked } = setup(
    {
      [mine.home]: { cached: expired },
      [twin.home]: { cached: expired, stale: true, measured: expired },
      [third.home]: { cached: expired, stale: true, measured: expired },
      "/h/.claude-fourth": { cached: ok(5) },
    },
    [twin, third, { id: "fourth", label: "Fourth", provider: "claude", home: "/h/.claude-fourth" }],
  );
  const view = await limits(mine, false);
  assert.equal(view.usage, "expired", "the third was never asked");
  assert.deepEqual(asked, [`${twin.home}:background`, `${third.home}:background`]);
});

test("a look at other directories that takes too long gives the account's own answer", async () => {
  const slow = createChatLimits({
    usage: {
      cached: (home) => (home === mine.home ? expired : null),
      stale: () => false,
      measure: async () => expired,
      info: () => info(7),
    },
    defaultDir: () => "/h/.claude",
    siblings: () => new Promise(() => {}),
    readMs: 20,
    now: () => NOW,
  });
  const view = await slow(mine, false);
  assert.equal(view.usage, "expired");
  assert.equal(view.usageAgeSeconds, 7);
});
