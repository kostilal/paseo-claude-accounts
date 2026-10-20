import { test } from "node:test";
import assert from "node:assert/strict";
import { type Candidate, FULL_AT, WARN_AT, nearlyFull, pickAuto } from "./auto.ts";

const account = (id: string) => ({ id, label: id, provider: "claude" as const, home: `/Users/me/.claude-${id}` });
const bar = (utilization: number, resetsAt: string) => ({ utilization, resetsAt });

function candidate(id: string, fiveHour: [number, string] | null, sevenDay: [number, string] | null): Candidate {
  return {
    account: account(id),
    known: true,
    fiveHour: fiveHour === null ? null : bar(...fiveHour),
    sevenDay: sevenDay === null ? null : bar(...sevenDay),
  };
}

const unknown = (id: string): Candidate => ({ account: account(id), known: false, fiveHour: null, sevenDay: null });

const picked = (candidates: Candidate[]) => pickAuto(candidates)?.id ?? null;

test("among accounts with room, the one whose week resets soonest is picked, however full", () => {
  assert.equal(
    picked([
      candidate("late", [10, "2026-10-20T15:00:00Z"], [10, "2026-10-25T00:00:00Z"]),
      candidate("soon", [60, "2026-10-20T15:00:00Z"], [80, "2026-10-21T00:00:00Z"]),
    ]),
    "soon",
  );
});

test("equal weekly resets go to the emptier five-hour window", () => {
  const week: [number, string] = [20, "2026-10-22T00:00:00Z"];
  assert.equal(
    picked([candidate("busy", [70, "2026-10-20T15:00:00Z"], week), candidate("idle", [5, "2026-10-20T16:00:00Z"], week)]),
    "idle",
  );
});

test("an account full in either window is passed over while another has room", () => {
  const room = candidate("room", [10, "2026-10-20T15:00:00Z"], [10, "2026-10-26T00:00:00Z"]);
  const hourFull = candidate("hour-full", [FULL_AT, "2026-10-20T15:00:00Z"], [10, "2026-10-21T00:00:00Z"]);
  const weekFull = candidate("week-full", [10, "2026-10-20T15:00:00Z"], [FULL_AT, "2026-10-21T00:00:00Z"]);
  assert.equal(picked([hourFull, weekFull, room]), "room");
});

test("a week just under the limit still counts as room", () => {
  assert.equal(
    picked([
      candidate("nearly", [10, "2026-10-20T15:00:00Z"], [FULL_AT - 1, "2026-10-21T00:00:00Z"]),
      candidate("later", [0, "2026-10-20T15:00:00Z"], [0, "2026-10-27T00:00:00Z"]),
    ]),
    "nearly",
  );
});

test("an account whose allowance could not be read comes after any with room, before full ones", () => {
  const full = candidate("full", [100, "2026-10-20T15:00:00Z"], [10, "2026-10-21T00:00:00Z"]);
  const room = candidate("room", [10, "2026-10-20T15:00:00Z"], [10, "2026-10-26T00:00:00Z"]);
  assert.equal(picked([unknown("blind"), room, full]), "room");
  assert.equal(picked([full, unknown("blind")]), "blind");
});

test("when every account is full, the one with room again soonest is picked", () => {
  assert.equal(
    picked([
      // Its five-hour window frees up soon, but the week is full until the 24th.
      candidate("week-bound", [100, "2026-10-20T13:00:00Z"], [100, "2026-10-24T00:00:00Z"]),
      candidate("hour-bound", [100, "2026-10-20T15:00:00Z"], [50, "2026-10-21T00:00:00Z"]),
    ]),
    "hour-bound",
  );
});

test("a missing window counts as empty, and a missing reset sorts last", () => {
  assert.equal(
    picked([candidate("no-week", [10, "2026-10-20T15:00:00Z"], null), candidate("week", null, [50, "2026-10-23T00:00:00Z"])]),
    "week",
  );
});

test("the same readings always give the same account, so chats started together land together", () => {
  const same: [number, string] = [10, "2026-10-21T00:00:00Z"];
  const candidates = [candidate("b", same, same), candidate("a", same, same)];
  assert.equal(picked(candidates), "a");
  assert.equal(picked([...candidates].reverse()), "a");
});

test("nothing to pick from picks nothing", () => {
  assert.equal(pickAuto([]), null);
});

test("the warning starts below the limit, so there is time to decide", () => {
  assert.ok(WARN_AT < FULL_AT);
  assert.equal(nearlyFull(bar(WARN_AT - 1, "")), false);
  assert.equal(nearlyFull(bar(WARN_AT, "")), true);
  assert.equal(nearlyFull(null), false);
});

test("a five-hour window that is nearly spent waits behind every account with room, whatever its week", () => {
  const hot = candidate("hot", [WARN_AT + 4, "2026-10-20T15:00:00Z"], [10, "2026-10-21T00:00:00Z"]);
  const cool = candidate("cool", [0, "2026-10-20T15:00:00Z"], [10, "2026-10-26T00:00:00Z"]);
  assert.equal(picked([hot, cool]), "cool");
});

test("a nearly spent account still comes before full ones, and after unread ones", () => {
  const hot = candidate("hot", [WARN_AT + 1, "2026-10-20T15:00:00Z"], [10, "2026-10-21T00:00:00Z"]);
  const hotter = candidate("hotter", [WARN_AT + 3, "2026-10-20T15:00:00Z"], [10, "2026-10-20T20:00:00Z"]);
  const full = candidate("full", [100, "2026-10-20T13:00:00Z"], [10, "2026-10-21T00:00:00Z"]);
  assert.equal(picked([full, hotter, hot]), "hot", "the emptier five-hour window, not the sooner week");
  assert.equal(picked([hot, unknown("blind")]), "blind");
});

test("most-room picks the account with the most left in its fuller window, whatever its week", () => {
  const soon = candidate("soon", [10, "2026-10-20T15:00:00Z"], [80, "2026-10-21T00:00:00Z"]);
  const roomy = candidate("roomy", [30, "2026-10-20T15:00:00Z"], [20, "2026-10-26T00:00:00Z"]);
  assert.equal(pickAuto([soon, roomy], "burn-first")?.id, "soon");
  assert.equal(pickAuto([soon, roomy], "most-room")?.id, "roomy");
});

test("most-room still passes over a nearly spent five-hour window and full accounts", () => {
  const hot = candidate("hot", [WARN_AT + 2, "2026-10-20T15:00:00Z"], [0, "2026-10-26T00:00:00Z"]);
  const busy = candidate("busy", [50, "2026-10-20T15:00:00Z"], [60, "2026-10-26T00:00:00Z"]);
  const full = candidate("full", [100, "2026-10-20T15:00:00Z"], [0, "2026-10-26T00:00:00Z"]);
  assert.equal(pickAuto([hot, full, busy], "most-room")?.id, "busy");
});
