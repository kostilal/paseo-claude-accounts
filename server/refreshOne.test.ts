import { test } from "node:test";
import assert from "node:assert/strict";
import type { Account } from "../shared/registry.ts";
import type { UsageInfo } from "./limits.ts";
import { createRefreshOne } from "./refreshOne.ts";
import { type UsageResult, createUsage } from "./usage.ts";

const NOW = 1_000_000;

const mine: Account = { id: "mine", label: "Mine", provider: "claude", home: "/h/.claude-mine" };
const twin: Account = { id: "twin", label: "Twin", provider: "claude", home: "/h/.claude-twin" };

const ok = (utilization: number): UsageResult => ({
  state: "ok",
  fiveHour: { utilization, resetsAt: "2026-10-31T19:00:00Z" },
  sevenDay: { utilization: 62, resetsAt: "2026-11-03T10:00:00Z" },
  error: "",
});
const expired: UsageResult = { state: "expired", fiveHour: null, sevenDay: null, error: "" };

interface Stage {
  cached?: UsageResult;
  stale?: boolean;
  /** What a measurement answers, and the info it leaves behind. */
  measured?: { result: UsageResult; info: UsageInfo };
  info?: UsageInfo;
}

function setup(stages: Record<string, Stage>, siblings: Account[] = [], authorised: (home: string) => boolean = () => false) {
  const asked: string[] = [];
  const refresh = createRefreshOne({
    usage: {
      authorised,
      cached: (home) => stages[home]?.cached ?? null,
      stale: (_home, force) => force === true && (stages[_home]?.stale ?? false),
      measure: async (home, _default, manual) => {
        asked.push(`${home}:${manual ? "manual" : "background"}`);
        const stage = stages[home];
        if (stage?.measured === undefined) return expired;
        stage.info = stage.measured.info;
        return stage.measured.result;
      },
      info: (home) => stages[home]?.info ?? null,
    },
    defaultDir: () => "/h/.claude",
    account: async (id) => [mine, twin].find((account) => account.id === id) ?? null,
    siblings: async () => siblings,
    readMs: 50,
    now: () => NOW,
  });
  return { refresh, asked };
}

const measured = (at: number, heldUntil: number | null = null): UsageInfo => ({ measuredAt: at, heldUntil });

test("a due reading is measured as a person's press and reported updated", async () => {
  const { refresh, asked } = setup({
    [mine.home]: { cached: ok(10), stale: true, info: measured(NOW - 300_000), measured: { result: ok(18), info: measured(NOW) } },
  });
  const answer = await refresh("mine");
  assert.equal(answer.outcome, "updated");
  assert.equal(answer.usage, "ok");
  assert.equal(answer.fiveHour?.utilization, 18);
  assert.equal(answer.measuredAt, NOW);
  assert.deepEqual(asked, [`${mine.home}:manual`]);
});

test("nothing cached is measured, and its first reading counts as updated", async () => {
  const { refresh, asked } = setup({ [mine.home]: { measured: { result: ok(3), info: measured(NOW) } } });
  assert.equal((await refresh("mine")).outcome, "updated");
  assert.equal(asked.length, 1);
});

test("a reading inside the floor is given back without a measurement", async () => {
  const { refresh, asked } = setup({ [mine.home]: { cached: ok(10), info: measured(NOW - 20_000) } });
  const answer = await refresh("mine");
  assert.equal(answer.outcome, "recent");
  assert.equal(answer.fiveHour?.utilization, 10);
  assert.equal(answer.measuredAt, NOW - 20_000);
  assert.deepEqual(asked, []);
});

test("numbers held through a 429 are reported held, with the wait, and nothing is measured", async () => {
  const until = NOW + 1_500_000;
  const { refresh, asked } = setup({ [mine.home]: { cached: ok(10), info: measured(NOW - 100_000, until) } });
  const answer = await refresh("mine");
  assert.equal(answer.outcome, "held");
  assert.equal(answer.heldUntil, until);
  assert.equal(answer.fiveHour?.utilization, 10);
  assert.deepEqual(asked, []);
});

test("a measurement that lands on a 429 and keeps the old numbers is held, not updated", async () => {
  const until = NOW + 1_500_000;
  const { refresh } = setup({
    [mine.home]: { cached: ok(10), stale: true, info: measured(NOW - 700_000), measured: { result: ok(10), info: measured(NOW - 700_000, until) } },
  });
  const answer = await refresh("mine");
  assert.equal(answer.outcome, "held");
  assert.equal(answer.heldUntil, until);
});

test("another directory of the login answers when the account's own cannot", async () => {
  const { refresh, asked } = setup(
    {
      [mine.home]: { cached: expired, stale: true, measured: { result: expired, info: measured(NOW) } },
      [twin.home]: { cached: ok(61), info: measured(NOW - 5_000) },
    },
    [twin],
  );
  const answer = await refresh("mine");
  assert.equal(answer.outcome, "recent");
  assert.equal(answer.fiveHour?.utilization, 61);
  assert.equal(answer.measuredAt, NOW - 5_000);
  assert.deepEqual(asked, [`${mine.home}:manual`]);
});

test("the other directories are not measured when the one the row reads answers", async () => {
  const { refresh, asked } = setup(
    { [mine.home]: { cached: ok(10), stale: true, info: measured(NOW - 300_000), measured: { result: ok(18), info: measured(NOW) } } },
    [twin],
  );
  assert.equal((await refresh("mine")).outcome, "updated");
  assert.deepEqual(asked, [`${mine.home}:manual`]);
});

test("when no directory can answer, the account's own failure is the answer", async () => {
  const failing: UsageResult = { state: "error", fiveHour: null, sevenDay: null, error: "boom" };
  const { refresh } = setup(
    {
      [mine.home]: { cached: failing, stale: true, measured: { result: failing, info: measured(NOW) } },
      [twin.home]: { cached: expired, info: measured(NOW - 5_000) },
    },
    [twin],
  );
  const answer = await refresh("mine");
  assert.equal(answer.outcome, "failed");
  assert.equal(answer.usage, "error");
  assert.equal(answer.error, "boom");
  assert.equal(answer.code, "");
});

test("an id with no account is refused with a code", async () => {
  const { refresh } = setup({});
  const answer = await refresh("ghost");
  assert.equal(answer.outcome, "failed");
  assert.equal(answer.code, "unknown-account");
  assert.equal(answer.measuredAt, null);
});

test("a call that outlasts its time answers failed instead of hanging", async () => {
  const refresh = createRefreshOne({
    usage: { authorised: () => false, cached: () => null, stale: () => true, measure: () => new Promise(() => {}), info: () => null },
    defaultDir: () => "/h/.claude",
    account: async () => mine,
    siblings: async () => [],
    readMs: 20,
    now: () => NOW,
  });
  const answer = await refresh("mine");
  assert.equal(answer.outcome, "failed");
  assert.match(answer.error, /did not finish/);
});

// The whole point of the button's limits: against the real cache, repeated presses do not reach
// the endpoint.
test("repeated presses reach the endpoint once per minute and not at all during a 429", async () => {
  let clock = NOW;
  let requests = 0;
  let status = 200;
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => {
      requests += 1;
      return status === 200
        ? ({ status: 200, text: async () => JSON.stringify({ five_hour: { utilization: 20, resets_at: "x" } }) } as Response)
        : ({ status: 429, headers: new Headers({ "retry-after": "1500" }), text: async () => "" } as Response);
    },
    version: async () => "2",
    now: () => clock,
  });
  const refresh = createRefreshOne({
    usage,
    defaultDir: () => "/h/.claude",
    account: async () => mine,
    siblings: async () => [],
    now: () => clock,
  });

  assert.equal((await refresh("mine")).outcome, "updated");
  assert.equal((await refresh("mine")).outcome, "recent");
  assert.equal(requests, 1);

  clock += 61_000;
  status = 429;
  const held = await refresh("mine");
  assert.equal(held.outcome, "held");
  assert.equal(held.fiveHour?.utilization, 20);
  assert.equal(requests, 2);

  clock += 61_000;
  assert.equal((await refresh("mine")).outcome, "held");
  assert.equal(requests, 2, "the wait is respected");
});

test("a press takes the reading a background read gave up on, Keychain dialog and all", async () => {
  const { refresh, asked } = setup({
    [mine.home]: {
      cached: { state: "unauthorised", fiveHour: null, sevenDay: null, error: "" },
      stale: false,
      info: measured(NOW - 1000),
      measured: { result: ok(18), info: measured(NOW) },
    },
  });
  assert.equal((await refresh("mine")).outcome, "updated");
  assert.deepEqual(asked, [`${mine.home}:manual`]);
});

test("a press measures the directory the row reads: the first allowed the Keychain, not the one pressed", async () => {
  const { refresh, asked } = setup(
    {
      [mine.home]: { cached: ok(10), stale: true, info: measured(NOW - 300_000), measured: { result: ok(30), info: measured(NOW) } },
      [twin.home]: { cached: ok(10), stale: true, info: measured(NOW - 300_000), measured: { result: ok(18), info: measured(NOW) } },
    },
    [twin],
    (home) => home === twin.home,
  );
  const answer = await refresh("mine");
  assert.equal(answer.outcome, "updated");
  assert.equal(answer.fiveHour?.utilization, 18);
  assert.deepEqual(asked, [`${twin.home}:manual`]);
});

test("with no directory allowed yet the one pressed is measured, Keychain dialog and all", async () => {
  const { refresh, asked } = setup(
    { [mine.home]: { cached: ok(10), stale: true, info: measured(NOW - 300_000), measured: { result: ok(30), info: measured(NOW) } } },
    [twin],
  );
  assert.equal((await refresh("mine")).outcome, "updated");
  assert.deepEqual(asked, [`${mine.home}:manual`]);
});
