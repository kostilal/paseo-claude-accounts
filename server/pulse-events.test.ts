import { test } from "node:test";
import assert from "node:assert/strict";
import { PULSE_EVENTS_CAPACITY, createEventRing } from "./pulse-events.ts";

/**
 * The feed Pulse reads with a cursor (contract paseo.pulse/1, §2.4): ids that sort, the newest
 * on first contact, everything after a cursor oldest first, and a gap whenever something newer
 * than the cursor may be gone.
 */

const T0 = Date.parse("2026-11-08T10:00:00Z");

function rig(capacity?: number) {
  let clock = T0;
  const ring = createEventRing({ capacity, now: () => clock });
  const push = (n: number) => {
    for (let i = 0; i < n; i += 1) ring.push("window_warning", { used: i }, { at: new Date(clock).toISOString(), key: `k${clock}:${i}` });
  };
  return { ring, push, advance: (ms: number) => void (clock += ms) };
}

test("ids sort in the order things happened, also within one millisecond and with the clock stepping back", () => {
  const r = rig();
  r.push(3);
  r.advance(-5_000);
  r.push(1);
  const ids = r.ring.read({}).events.map((event) => event.id);
  assert.equal(ids.length, 4);
  assert.deepEqual([...ids].sort(), ids);
  assert.equal(new Set(ids).size, 4);
});

test("first contact: the newest, oldest first, no gap; then only what came after the cursor", () => {
  const r = rig();
  assert.deepEqual(r.ring.read({}), { events: [], cursor: "", head: "", gap: false });
  r.push(5);
  const first = r.ring.read({ limit: 2 });
  assert.deepEqual(first.events.map((event) => event.fields?.used), [3, 4]);
  assert.equal(first.cursor, first.head);
  assert.equal(first.gap, false);

  const nothing = r.ring.read({ after: first.cursor });
  assert.deepEqual(nothing, { events: [], cursor: first.cursor, head: first.head, gap: false });
  r.advance(1_000);
  r.push(1);
  const next = r.ring.read({ after: first.cursor });
  assert.equal(next.events.length, 1);
  assert.equal(next.cursor, next.events[0]?.id);
  assert.equal(next.head, next.cursor);
  assert.equal(next.gap, false);
});

test("a page is at most `limit`, and the cursor walks through the rest", () => {
  const r = rig();
  r.push(7);
  const all = r.ring.read({});
  const start = r.ring.read({ after: "0" });
  assert.equal(start.gap, true, "a cursor from before this process may have missed something");
  const one = r.ring.read({ after: all.events[0]?.id, limit: 3 });
  assert.deepEqual(one.events.map((event) => event.fields?.used), [1, 2, 3]);
  const two = r.ring.read({ after: one.cursor, limit: 3 });
  assert.deepEqual(two.events.map((event) => event.fields?.used), [4, 5, 6]);
  assert.equal(two.cursor, all.head);
  assert.equal(r.ring.read({ limit: 1_000 }).events.length, 7, "limit is clamped, not refused");
});

test("the buffer keeps the newest ones; a cursor behind what it let go reads as a gap, once", () => {
  const r = rig(3);
  r.push(1);
  const seen = r.ring.read({}).cursor;
  r.advance(1_000);
  r.push(4);
  const page = r.ring.read({ after: seen });
  assert.equal(page.gap, true);
  assert.deepEqual(page.events.map((event) => event.fields?.used), [1, 2, 3]);
  const again = r.ring.read({ after: page.cursor });
  assert.equal(again.gap, false, "caught up");
  assert.equal(PULSE_EVENTS_CAPACITY >= 200, true, "the contract keeps at least the newest 200");
});

test("a restart: an empty buffer, and the old cursor reads as a gap that the next read has closed", () => {
  const before = rig();
  before.push(2);
  const cursor = before.ring.read({}).cursor;
  // A new process, a little later.
  let clock = T0 + 60_000;
  const ring = createEventRing({ now: () => clock });
  const page = ring.read({ after: cursor });
  assert.equal(page.gap, true);
  assert.deepEqual(page.events, []);
  assert.ok(page.cursor > cursor, "the cursor moves to where the gap ends");
  assert.equal(ring.read({ after: page.cursor }).gap, false);
  clock += 1_000;
  ring.push("window_critical", { used: 96 }, { at: new Date(clock).toISOString(), key: "window:1" });
  const next = ring.read({ after: page.cursor });
  assert.deepEqual([next.events.length, next.gap], [1, false]);
});

test("the same key is one event, however often it is pushed", () => {
  const r = rig();
  for (let i = 0; i < 5; i += 1) r.ring.push("window_critical", { used: 96 }, { at: new Date(T0).toISOString(), key: "window:2026-11-08T10:00:00.000Z" });
  assert.equal(r.ring.read({}).events.length, 1);
});
