import { test } from "node:test";
import assert from "node:assert/strict";
import type { AccountView } from "../shared/accounts.ts";
import type { Registry } from "../shared/registry.ts";
import { createEventRing } from "./pulse-events.ts";
import { createPulse, loginId, pulseLoginsOf } from "./pulse.ts";
import { createPulseRefresh } from "./pulseRefresh.ts";
import { type Entry, type UsageResult, createUsage } from "./usage.ts";

/**
 * A read of the Pulse snapshot keeps the usage fresh at the user's interval while nothing else
 * measures it. The usage cache here is the real one (server/usage.ts), with a fake clock, a fake
 * endpoint and fake saved readings, so the interval, the 429 hold and the single reading per
 * directory are the plugin's own rules and not a copy of them.
 */

const T0 = Date.parse("2026-11-14T10:00:00Z");
const MINUTE = 60_000;
const INTERVAL = 10 * MINUTE;
const EMAIL = "roman.secret@example.com";
const DEFAULT_DIR = "/Users/me/.claude";

const row = (id: string): AccountView => ({
  id,
  name: id,
  home: `/Users/me/.claude-${id}`,
  provider: "claude",
  registered: true,
  key: JSON.stringify(["login", `${id}.${EMAIL}`, "Org"]),
  loggedIn: true,
  email: `${id}.${EMAIL}`,
  orgName: "Org",
  subscriptionType: "max",
  accountIds: [id],
  switchTo: id,
  isDefault: false,
  autoNow: false,
  usage: "ok",
  fiveHour: { utilization: 10, resetsAt: new Date(T0 + 3 * 3_600_000).toISOString() },
  sevenDay: null,
  usageErrorCode: "",
  usageError: "",
  usageAt: T0 - 20 * MINUTE,
  heldUntil: null,
  rateLimitTier: "default_claude_max_20x",
});

const reading = (used: number): UsageResult => ({
  state: "ok",
  fiveHour: { utilization: used, resetsAt: new Date(T0 + 3 * 3_600_000).toISOString() },
  sevenDay: null,
  error: "",
});

/** A reading on disk, taken `age` ago. */
const kept = (age: number, over: Partial<Entry> = {}): Entry => ({
  at: T0 - age,
  measuredAt: T0 - age,
  heldUntil: null,
  result: reading(10),
  onForce: "floor",
  ...over,
});

const ok = (used: number) => ({ status: 200, text: async () => JSON.stringify({ five_hour: { utilization: used, resets_at: new Date(T0 + 3 * 3_600_000).toISOString() } }) }) as Response;

interface Options {
  ids?: string[];
  /** What is on disk per account id. */
  saved?: Record<string, Entry>;
  respond?: () => Response | Promise<Response>;
  /** When the stored token expires; null when the item says nothing. */
  expiresAt?: number | null;
  /** More directories logged in to the first login, by account id. */
  siblings?: string[];
}

function rig(options: Options = {}) {
  let clock = T0;
  const ids = options.ids ?? ["a"];
  const rows = ids.map(row);
  const siblings = options.siblings ?? [];
  rows[0] = { ...rows[0]!, accountIds: [rows[0]!.id, ...siblings] };
  const homes = [...ids, ...siblings].map((id) => ({ id, label: id, provider: "claude" as const, home: `/Users/me/.claude-${id}` }));
  const registry: Registry = { version: 2, accounts: homes, agents: {} };
  let requests = 0;
  let respond = options.respond ?? (() => ok(55));
  const usage = createUsage(
    {
      readCredential: async () => ({ token: "token", expiresAt: options.expiresAt ?? null }),
      request: async () => {
        requests += 1;
        return respond();
      },
      version: async () => "2.1.300",
      now: () => clock,
      saved: { load: () => Object.entries(options.saved ?? {}).map(([id, entry]) => [`/Users/me/.claude-${id}`, entry] as const), save: () => {} },
      log: () => {},
    },
    () => INTERVAL,
  );
  // Every reading the refresher starts, so a test can wait for them to land.
  const started: Promise<UsageResult>[] = [];
  const measured: string[] = [];
  const logs: string[] = [];
  const refresher = createPulseRefresh({
    rows: async () => ({ rows, registry }),
    usage: {
      ...usage,
      measure: (dir, defaultDir, manual) => {
        measured.push(dir);
        const result = usage.measure(dir, defaultDir, manual);
        started.push(result);
        return result;
      },
    },
    defaultDir: () => DEFAULT_DIR,
    intervalMs: () => INTERVAL,
    now: () => clock,
    log: (line) => logs.push(line),
  });
  const kicks: Promise<void>[] = [];
  const pulse = createPulse({
    ring: createEventRing({ now: () => clock }),
    logins: async () => pulseLoginsOf(rows, { registry, cached: usage.cached, info: usage.info }),
    refresh: () => kicks.push(refresher.kick()),
    now: () => clock,
    settleMs: 0,
  });
  pulse.setShown(true);
  return {
    pulse,
    refresher,
    usage,
    measured,
    logs,
    requests: () => requests,
    advance: (ms: number) => void (clock += ms),
    respondWith: (next: () => Response | Promise<Response>) => void (respond = next),
    /** Every kick done and every reading it started landed. */
    landed: async () => {
      await Promise.all(kicks);
      await Promise.all(started);
    },
  };
}

test("a stale login is refreshed once, and the log names it by id, never by email", async () => {
  const r = rig({ saved: { a: kept(11 * MINUTE) } });
  await r.refresher.kick();
  await r.refresher.kick();
  await Promise.all([r.refresher.kick(), r.refresher.kick()]);
  await r.landed();
  assert.equal(r.requests(), 1);
  assert.deepEqual(r.measured, ["/Users/me/.claude-a"]);
  assert.equal(r.usage.cached("/Users/me/.claude-a")?.fiveHour?.utilization, 55);
  // Fresh now: the next reads leave it alone.
  await r.refresher.kick();
  await r.landed();
  assert.equal(r.requests(), 1);
  assert.equal(r.logs.length, 1);
  assert.match(r.logs[0]!, new RegExp(loginId(row("a").key)));
  assert.doesNotMatch(r.logs.join("\n"), /@|example\.com/);
});

test("concurrent reads while a refresh is under way start one fetch per login", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const r = rig({
    ids: ["a", "b"],
    saved: { a: kept(11 * MINUTE), b: kept(11 * MINUTE) },
    respond: async () => {
      await gate;
      return ok(60);
    },
  });
  await Promise.all([r.refresher.kick(), r.refresher.kick(), r.refresher.kick()]);
  // Past the interval and still running: a running refresh is not started again.
  r.advance(INTERVAL + MINUTE);
  await Promise.all([r.pulse.snapshot({}), r.pulse.snapshot({}), r.refresher.kick()]);
  release();
  await r.landed();
  assert.equal(r.requests(), 2);
  assert.deepEqual([...r.measured].sort(), ["/Users/me/.claude-a", "/Users/me/.claude-b"]);
});

test("a login measured within the interval is left alone", async () => {
  const r = rig({ saved: { a: kept(5 * MINUTE) } });
  await r.pulse.snapshot({});
  await r.landed();
  assert.equal(r.requests(), 0);
  assert.deepEqual(r.measured, []);
  assert.deepEqual(r.logs, []);
});

test("a directory never read before (not authorised) is not read from here: no Keychain prompt with no window open", async () => {
  const r = rig({ ids: ["a", "b"], saved: { a: kept(11 * MINUTE) } });
  await r.refresher.kick();
  await r.landed();
  assert.deepEqual(r.measured, ["/Users/me/.claude-a"], "only the login with a reading the plugin made before");
  assert.equal(r.requests(), 1);
});

test("a dependency that throws for one login neither stops the others nor reaches the caller", async () => {
  const r = rig({ ids: ["a", "b"], saved: { a: kept(11 * MINUTE), b: kept(11 * MINUTE) } });
  const info = r.usage.info;
  const refresher = createPulseRefresh({
    rows: async () => ({ rows: ["a", "b"].map(row), registry: { version: 2, accounts: ["a", "b"].map((id) => ({ id, label: id, provider: "claude" as const, home: `/Users/me/.claude-${id}` })), agents: {} } }),
    usage: { ...r.usage, info: (dir) => { if (dir.endsWith("-a")) throw new Error("broken"); return info(dir); } },
    defaultDir: () => DEFAULT_DIR,
    intervalMs: () => INTERVAL,
    now: () => T0,
    log: () => {},
  });
  await assert.doesNotReject(refresher.kick());
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(r.usage.cached("/Users/me/.claude-b")?.fiveHour?.utilization, 55, "b was refreshed even though a threw");
});

test("a login held by a 429 kept on disk is left alone until the wait is over", async () => {
  const wait = 25 * MINUTE;
  const r = rig({ saved: { a: kept(2 * MINUTE, { heldUntil: T0 - 2 * MINUTE + wait, freshFor: wait, onForce: "keep" }) } });
  r.advance(INTERVAL);
  await r.refresher.kick();
  r.advance(12 * MINUTE);
  await r.refresher.kick();
  await r.landed();
  assert.equal(r.requests(), 0);
  r.advance(2 * MINUTE);
  await r.refresher.kick();
  await r.landed();
  assert.equal(r.requests(), 1);
});

test("a hold on one directory of a login keeps its other directories from being asked meanwhile", async () => {
  const wait = 25 * MINUTE;
  // The held one has no numbers to keep, so the per-login read would move on to the sibling.
  const held = kept(MINUTE, { heldUntil: T0 - MINUTE + wait, freshFor: wait, onForce: "keep", result: { state: "error", fiveHour: null, sevenDay: null, error: "rate limited" } });
  const r = rig({ siblings: ["a2"], saved: { a: held, a2: kept(11 * MINUTE) } });
  r.advance(INTERVAL);
  await r.refresher.kick();
  await r.landed();
  assert.deepEqual(r.measured, []);
  r.advance(15 * MINUTE);
  await r.refresher.kick();
  await r.landed();
  assert.equal(r.measured.length, 1);
});

test("a 429 met by the refresh holds the login for the retry-after it named", async () => {
  const r = rig({
    saved: { a: kept(11 * MINUTE) },
    respond: () => ({ status: 429, headers: new Headers({ "retry-after": String(40 * 60) }), text: async () => "" }) as Response,
  });
  await r.refresher.kick();
  await r.landed();
  assert.equal(r.requests(), 1);
  r.advance(30 * MINUTE);
  await r.refresher.kick();
  await r.landed();
  assert.equal(r.requests(), 1);
  r.advance(11 * MINUTE);
  r.respondWith(() => ok(70));
  await r.refresher.kick();
  await r.landed();
  assert.equal(r.requests(), 2);
});

test("with Show in Pulse off a read starts nothing; on again, it does", async () => {
  const r = rig({ saved: { a: kept(11 * MINUTE) } });
  r.pulse.setShown(false);
  await r.pulse.snapshot({});
  await r.landed();
  assert.equal(r.requests(), 0);
  assert.deepEqual(r.measured, []);
  r.pulse.setShown(true);
  await r.pulse.snapshot({});
  await r.landed();
  assert.equal(r.requests(), 1);
});

test("a failed refresh is not tried again before the interval, even where the cache would let it", async () => {
  const failures: Array<[string, Options]> = [
    ["a network error", { respond: () => Promise.reject(new Error("fetch failed")) }],
    ["a 401", { respond: () => ({ status: 401, text: async () => "{}" }) as Response }],
    // A token known to be expired costs no request and stands only 25 s in the usage cache.
    ["an expired token", { expiresAt: T0 - MINUTE }],
  ];
  for (const [name, options] of failures) {
    const r = rig({ saved: { a: kept(11 * MINUTE) }, ...options });
    await r.refresher.kick();
    await r.landed();
    assert.equal(r.measured.length, 1, name);
    assert.notEqual(r.usage.cached("/Users/me/.claude-a")?.state, "ok", name);
    for (let i = 0; i < 9; i += 1) {
      r.advance(MINUTE);
      await r.pulse.snapshot({});
      await r.landed();
    }
    assert.equal(r.measured.length, 1, name);
    r.advance(2 * MINUTE);
    await r.refresher.kick();
    await r.landed();
    assert.equal(r.measured.length, 2, name);
  }
});

test("the snapshot answers without waiting for the fetch, and the next one carries the new reading", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const r = rig({
    saved: { a: kept(11 * MINUTE) },
    respond: async () => {
      await gate;
      return ok(80);
    },
  });
  // The endpoint has not answered, and cannot until the gate opens: the answer came anyway.
  const first = await r.pulse.snapshot({});
  const values = first.values as Record<string, Record<string, { used?: number }>>;
  assert.equal(values.five_hour![loginId(row("a").key)]!.used, 10);
  release();
  await r.landed();
  assert.equal(r.requests(), 1);
  const next = await r.pulse.snapshot({ ifRev: first.rev });
  assert.notEqual(next.rev, first.rev);
  const fresh = next.values as Record<string, Record<string, { used?: number }>>;
  assert.equal(fresh.five_hour![loginId(row("a").key)]!.used, 80);
});
