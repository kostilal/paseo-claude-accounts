import { test } from "node:test";
import assert from "node:assert/strict";
import { KeychainTimeout } from "./keychain.ts";
import { createUsage } from "./usage.ts";

const DIR = "/Users/me/.claude-work";
const HOME = "/Users/me/.claude";

function body(status: number, payload: unknown) {
  return { status, text: async () => JSON.stringify(payload) } as Response;
}

test("a successful read marks the account authorised and reports both bars", async () => {
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () =>
      body(200, {
        five_hour: { utilization: 37, resets_at: "2026-09-11T18:00:00Z" },
        seven_day: { utilization: 4, resets_at: "2026-09-15T00:00:00Z" },
      }),
    version: async () => "2.1.268",
  });
  const result = await usage.measure(DIR, HOME, true);
  assert.equal(result.state, "ok");
  assert.equal(result.fiveHour?.utilization, 37);
  assert.equal(usage.authorised(DIR), true);
});

test("a reading with only a week is a reading, not an account with no meter", async () => {
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => body(200, { five_hour: null, seven_day: { utilization: 67, resets_at: "2026-11-06T14:00:00Z" } }),
    version: async () => "2.1.317",
  });
  const result = await usage.measure(DIR, HOME, true);
  assert.equal(result.state, "ok");
  assert.equal(result.fiveHour, null);
  assert.equal(result.sevenDay?.utilization, 67);
});

test("a background read that hits a dialog drops the account back to unauthorised", async () => {
  const usage = createUsage({
    readCredential: async (_service, timeoutMs) => {
      if (timeoutMs !== null) throw new KeychainTimeout("dialog");
      return { token: "token", expiresAt: null };
    },
    request: async () => body(200, { five_hour: { utilization: 1, resets_at: "x" } }),
    version: async () => "2.1.268",
  });
  await usage.measure(DIR, HOME, true);
  assert.equal(usage.authorised(DIR), true);

  const background = await usage.measure(DIR, HOME, false);
  assert.equal(background.state, "unauthorised");
  assert.equal(usage.authorised(DIR), false);
});

test("a 401 is reported as expired, not as an error", async () => {
  const usage = createUsage({
    readCredential: async () => ({ token: "stale", expiresAt: null }),
    request: async () => body(401, { error: { type: "authentication_error" } }),
    version: async () => "2.1.268",
  });
  assert.equal((await usage.measure(DIR, HOME, true)).state, "expired");
});

test("a body with no windows means this account has no allowance to show", async () => {
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => body(200, { extra_usage: { enabled: false } }),
    version: async () => "2.1.268",
  });
  assert.equal((await usage.measure(DIR, HOME, true)).state, "none");
});

test("a directory with no token reports an error and stays unauthorised", async () => {
  const usage = createUsage({
    readCredential: async () => {
      throw new Error("this config directory has no claude.ai token");
    },
    request: async () => body(200, {}),
    version: async () => "2.1.268",
  });
  const result = await usage.measure(DIR, HOME, true);
  assert.equal(result.state, "error");
  assert.match(result.error, /no claude\.ai token/);
  assert.equal(usage.authorised(DIR), false);
});

test("the service name sent to the Keychain is derived from the directory", async () => {
  const seen: string[] = [];
  const usage = createUsage({
    readCredential: async (service) => {
      seen.push(service);
      return { token: "token", expiresAt: null };
    },
    request: async () => body(200, {}),
    version: async () => "2.1.268",
  });
  await usage.measure(HOME, HOME, true);
  await usage.measure(DIR, HOME, true);
  assert.deepEqual(seen, ["Claude Code-credentials", "Claude Code-credentials-1e91dd84"]);
});

test("a token the Keychain says is expired is reported expired without a request", async () => {
  let requests = 0;
  const usage = createUsage({
    readCredential: async () => ({ token: "old", expiresAt: 1_000 }),
    request: async () => {
      requests += 1;
      return body(200, {});
    },
    version: async () => "2.1.268",
    now: () => 2_000,
  });
  const result = await usage.measure(DIR, HOME, true);
  assert.equal(result.state, "expired");
  assert.equal(requests, 0);
});

test("a 429 keeps the last good reading and holds off until retry-after has passed", async () => {
  let clock = 0;
  let status = 200;
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () =>
      status === 200
        ? body(200, { five_hour: { utilization: 18, resets_at: "x" } })
        : ({ status: 429, headers: new Headers({ "retry-after": "1500" }), text: async () => "" } as Response),
    version: async () => "2.1.268",
    now: () => clock,
  });
  const first = await usage.measure(DIR, HOME, true);
  assert.equal(first.state, "ok");
  status = 429;
  clock = 11 * 60 * 1000;
  const limited = await usage.measure(DIR, HOME, false);
  assert.equal(limited.state, "ok");
  assert.equal(limited.fiveHour?.utilization, 18);
  assert.equal(usage.stale(DIR), false);
  clock += 1500 * 1000 + 1;
  assert.equal(usage.stale(DIR), true);
});

test("a 429 with nothing cached is an error, not an account with no allowance", async () => {
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => ({ status: 429, headers: new Headers(), text: async () => "" }) as Response,
    version: async () => "2.1.268",
  });
  const result = await usage.measure(DIR, HOME, true);
  assert.equal(result.state, "error");
  assert.match(result.error, /rate limited/);
});

// A fresh login must replace an "expired" reading on the next poll.
test("a token the Keychain calls expired is read again by the next poll, not in ten minutes", async () => {
  let clock = 2_000;
  let credential = { token: "old", expiresAt: 1_000 };
  const usage = createUsage({
    readCredential: async () => credential,
    request: async () => body(200, { five_hour: { utilization: 9, resets_at: "x" } }),
    version: async () => "2.1.268",
    now: () => clock,
  });
  assert.equal((await usage.measure(DIR, HOME, false)).state, "expired");
  assert.equal(usage.stale(DIR), false);
  // Reload takes it again at once: the Keychain alone decided it, so that costs no request.
  assert.equal(usage.stale(DIR, true), true);
  credential = { token: "new", expiresAt: clock + 8 * 60 * 60 * 1000 };
  clock += 25_001;
  assert.equal(usage.stale(DIR), true);
  assert.equal((await usage.measure(DIR, HOME, false)).state, "ok");
});

test("Reload retakes a reading that cost a request only once it is a minute old, and never inside a 429's wait", async () => {
  let clock = 0;
  let status = 200;
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () =>
      status === 200
        ? body(200, { five_hour: { utilization: 18, resets_at: "x" } })
        : ({ status: 429, headers: new Headers({ "retry-after": "1500" }), text: async () => "" } as Response),
    version: async () => "2.1.268",
    now: () => clock,
  });
  assert.equal(usage.stale(DIR, true), true);
  await usage.measure(DIR, HOME, false);
  assert.equal(usage.stale(DIR, true), false);
  clock += 60_001;
  assert.equal(usage.stale(DIR), false);
  assert.equal(usage.stale(DIR, true), true);

  status = 429;
  await usage.measure(DIR, HOME, false);
  clock += 60_001;
  assert.equal(usage.stale(DIR, true), false);
  clock += 1500 * 1000;
  assert.equal(usage.stale(DIR, true), true);
});

test("Reload leaves a directory whose last read hit a Keychain dialog alone until its window ends", async () => {
  let clock = 0;
  const usage = createUsage({
    readCredential: async () => {
      throw new KeychainTimeout("dialog");
    },
    request: async () => body(200, {}),
    version: async () => "2.1.268",
    now: () => clock,
  });
  assert.equal((await usage.measure(DIR, HOME, false)).state, "unauthorised");
  clock += 5 * 60 * 1000;
  assert.equal(usage.stale(DIR, true), false);
  clock += 5 * 60 * 1000 + 1;
  assert.equal(usage.stale(DIR, true), true);
});

test("Reload leaves a Keychain read that was denied or locked alone, rather than raise the dialog again", async () => {
  const usage = createUsage({
    readCredential: async () => {
      throw Object.assign(new Error("security: User canceled the operation."), { code: 128 });
    },
    request: async () => body(200, {}),
    version: async () => "2.1.268",
    now: () => 0,
  });
  assert.equal((await usage.measure(DIR, HOME, true)).state, "error");
  assert.equal(usage.stale(DIR, true), false);
});

test("Reload retakes a Keychain item that is not there yet", async () => {
  const usage = createUsage({
    readCredential: async () => {
      throw Object.assign(new Error("security: The specified item could not be found in the keychain."), { code: 44 });
    },
    request: async () => body(200, {}),
    version: async () => "2.1.268",
    now: () => 0,
  });
  await usage.measure(DIR, HOME, false);
  assert.equal(usage.stale(DIR, true), true);
});

test("Reload retakes an expired answer from a 401 at once, since a login is what fixes it", async () => {
  const usage = createUsage({
    readCredential: async () => ({ token: "revoked", expiresAt: null }),
    request: async () => body(401, {}),
    version: async () => "2.1.268",
    now: () => 0,
  });
  assert.equal((await usage.measure(DIR, HOME, false)).state, "expired");
  assert.equal(usage.stale(DIR), false);
  assert.equal(usage.stale(DIR, true), true);
});

test("Reload retakes a Keychain read that failed outright, so a login made since shows at once", async () => {
  const usage = createUsage({
    readCredential: async () => {
      throw new Error("this config directory has no claude.ai token");
    },
    request: async () => body(200, {}),
    version: async () => "2.1.268",
    now: () => 0,
  });
  await usage.measure(DIR, HOME, false);
  assert.equal(usage.stale(DIR), false);
  assert.equal(usage.stale(DIR, true), true);
});

// --- refreshing an expired token through Claude Code -----------------------------------

const ok = () => body(200, { five_hour: { utilization: 12, resets_at: "x" } });

test("an expired token is refreshed through Claude Code, then read", async () => {
  let refreshes = 0;
  let expiresAt = 1_000;
  const usage = createUsage({
    readCredential: async () => ({ token: refreshes > 0 ? "fresh" : "stale", expiresAt }),
    request: async (token) => (token === "fresh" ? ok() : body(401, {})),
    version: async () => "2",
    refresh: async () => {
      refreshes += 1;
      expiresAt = 10_000_000;
    },
    now: () => 5_000,
  });
  const result = await usage.measure(DIR, HOME, false);
  assert.equal(result.state, "ok");
  assert.equal(refreshes, 1);
});

test("a refresh that does not help leaves the reading expired, and is not repeated at once", async () => {
  let refreshes = 0;
  let clock = 5_000;
  const usage = createUsage({
    readCredential: async () => ({ token: "stale", expiresAt: 1_000 }),
    request: async () => ok(),
    version: async () => "2",
    refresh: async () => {
      refreshes += 1;
    },
    now: () => clock,
  });
  assert.equal((await usage.measure(DIR, HOME, false)).state, "expired");
  clock += 60_000;
  assert.equal((await usage.measure(DIR, HOME, false)).state, "expired");
  assert.equal(refreshes, 1);
  clock += 15 * 60_000;
  await usage.measure(DIR, HOME, false);
  assert.equal(refreshes, 2);
});

test("a 401 refreshes once and retries", async () => {
  let refreshes = 0;
  const usage = createUsage({
    readCredential: async () => ({ token: refreshes > 0 ? "fresh" : "stale", expiresAt: null }),
    request: async (token) => (token === "fresh" ? ok() : body(401, {})),
    version: async () => "2",
    refresh: async () => {
      refreshes += 1;
    },
  });
  assert.equal((await usage.measure(DIR, HOME, false)).state, "ok");
  assert.equal(refreshes, 1);
});

test("a failing refresh is reported as expired, not as an error", async () => {
  const usage = createUsage({
    readCredential: async () => ({ token: "stale", expiresAt: null }),
    request: async () => body(401, {}),
    version: async () => "2",
    refresh: async () => Promise.reject(new Error("claude failed")),
  });
  assert.equal((await usage.measure(DIR, HOME, false)).state, "expired");
});

test("a reading is stamped with when it was measured", async () => {
  let clock = 5_000;
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => body(200, { five_hour: { utilization: 20, resets_at: "x" } }),
    version: async () => "2.1.268",
    now: () => clock,
  });
  assert.equal(usage.info(DIR), null, "nothing measured, nothing to say");
  await usage.measure(DIR, HOME, true);
  assert.deepEqual(usage.info(DIR), { measuredAt: 5_000, heldUntil: null });
  clock = 9_000;
  await usage.measure(DIR, HOME, true);
  assert.deepEqual(usage.info(DIR), { measuredAt: 9_000, heldUntil: null });
});

test("numbers kept through a 429 keep their own age and say until when they are held", async () => {
  let clock = 0;
  let status = 200;
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () =>
      status === 200
        ? body(200, { five_hour: { utilization: 18, resets_at: "x" } })
        : ({ status: 429, headers: new Headers({ "retry-after": "1500" }), text: async () => "" } as Response),
    version: async () => "2.1.268",
    now: () => clock,
  });
  await usage.measure(DIR, HOME, true);
  status = 429;
  clock = 11 * 60 * 1000;
  await usage.measure(DIR, HOME, false);
  // The numbers are still the first reading's; only the hold is new.
  assert.deepEqual(usage.info(DIR), { measuredAt: 0, heldUntil: 11 * 60 * 1000 + 1500 * 1000 });
});

test("an answer that is not a reading is stamped with the attempt and holds nothing", async () => {
  const clock = 7_000;
  const usage = createUsage({
    readCredential: async () => ({ token: "stale", expiresAt: 1_000 }),
    request: async () => body(200, {}),
    version: async () => "2.1.268",
    now: () => clock,
  });
  assert.equal((await usage.measure(DIR, HOME, false)).state, "expired");
  assert.deepEqual(usage.info(DIR), { measuredAt: 7_000, heldUntil: null });
});

// --- the auto-refresh interval -----------------------------------------------------------

test("a reading stands for the configured interval, and a changed interval applies at once", async () => {
  let clock = 0;
  let minutes = 10;
  const usage = createUsage(
    {
      readCredential: async () => ({ token: "token", expiresAt: null }),
      request: async () => body(200, { five_hour: { utilization: 1, resets_at: "x" } }),
      version: async () => "2",
      now: () => clock,
    },
    () => minutes * 60_000,
  );
  await usage.measure(DIR, HOME, false);
  clock = 5 * 60_000;
  assert.equal(usage.stale(DIR), false);
  minutes = 3;
  assert.equal(usage.stale(DIR), true);
});

test("the interval leaves a 429's own wait alone", async () => {
  let clock = 0;
  const usage = createUsage(
    {
      readCredential: async () => ({ token: "token", expiresAt: null }),
      request: async () => ({ status: 429, headers: new Headers({ "retry-after": "1500" }), text: async () => "" }) as Response,
      version: async () => "2",
      now: () => clock,
    },
    () => 5 * 60_000,
  );
  await usage.measure(DIR, HOME, false);
  clock = 10 * 60_000;
  assert.equal(usage.stale(DIR), false);
  clock = 1500 * 1000 + 1;
  assert.equal(usage.stale(DIR), true);
});

// --- one reading at a time per directory ---------------------------------------------------

/** A promise opened from outside, so a test can hold a reading in flight. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

test("two background callers at once cost one request and get the same answer", async () => {
  let requests = 0;
  const hold = gate();
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => {
      requests += 1;
      await hold.opened;
      return ok();
    },
    version: async () => "2",
  });
  const first = usage.measure(DIR, HOME, false);
  const second = usage.measure(DIR, HOME, false);
  hold.open();
  assert.deepEqual(await first, await second);
  assert.equal(requests, 1);
});

test("different directories do not wait on each other", async () => {
  let requests = 0;
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => ((requests += 1), ok()),
    version: async () => "2",
  });
  await Promise.all([usage.measure(DIR, HOME, false), usage.measure("/Users/me/.claude-other", HOME, false)]);
  assert.equal(requests, 2);
});

test("a person joining a background reading that hit a Keychain dialog takes their own afterwards", async () => {
  const hold = gate();
  const timeouts: Array<number | null> = [];
  let requests = 0;
  const usage = createUsage({
    readCredential: async (_service, timeoutMs) => {
      timeouts.push(timeoutMs);
      if (timeoutMs !== null) {
        await hold.opened;
        throw new KeychainTimeout("dialog");
      }
      return { token: "token", expiresAt: null };
    },
    request: async () => ((requests += 1), ok()),
    version: async () => "2",
  });
  const background = usage.measure(DIR, HOME, false);
  const manual = usage.measure(DIR, HOME, true);
  hold.open();
  assert.equal((await background).state, "unauthorised");
  assert.equal((await manual).state, "ok");
  assert.deepEqual(timeouts, [3_000, null]);
  assert.equal(requests, 1);
});

test("a person joining a background reading that worked takes its answer", async () => {
  const hold = gate();
  let reads = 0;
  const usage = createUsage({
    readCredential: async () => {
      reads += 1;
      return { token: "token", expiresAt: null };
    },
    request: async () => {
      await hold.opened;
      return ok();
    },
    version: async () => "2",
  });
  const background = usage.measure(DIR, HOME, false);
  const manual = usage.measure(DIR, HOME, true);
  hold.open();
  await background;
  assert.equal((await manual).state, "ok");
  assert.equal(reads, 1);
});

test("a background caller joining a manual reading waits for it instead of measuring", async () => {
  const hold = gate();
  const timeouts: Array<number | null> = [];
  const usage = createUsage({
    readCredential: async (_service, timeoutMs) => {
      timeouts.push(timeoutMs);
      await hold.opened;
      return { token: "token", expiresAt: null };
    },
    request: async () => ok(),
    version: async () => "2",
  });
  const manual = usage.measure(DIR, HOME, true);
  const background = usage.measure(DIR, HOME, false);
  hold.open();
  await manual;
  assert.equal((await background).state, "ok");
  assert.deepEqual(timeouts, [null]);
});

test("a poll joining a manual reading does not wait out a Keychain dialog", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hold = gate();
  const usage = createUsage({
    readCredential: async () => {
      await hold.opened;
      return { token: "token", expiresAt: null };
    },
    request: async () => ok(),
    version: async () => "2",
  });
  const manual = usage.measure(DIR, HOME, true);
  const background = usage.measure(DIR, HOME, false);
  t.mock.timers.tick(3_000);
  assert.equal((await background).state, "unauthorised");
  hold.open();
  assert.equal((await manual).state, "ok");
});

test("a measurement that rejects leaves nothing behind, so the next one really runs", async () => {
  let fail = true;
  let reads = 0;
  const usage = createUsage({
    readCredential: async () => {
      reads += 1;
      throw new KeychainTimeout("dialog");
    },
    request: async () => body(200, {}),
    version: async () => "2",
    // The Keychain branch stamps the entry with the time, so this makes the measurement reject.
    now: () => {
      if (fail) throw new Error("the clock broke");
      return 0;
    },
  });
  await assert.rejects(usage.measure(DIR, HOME, false), /the clock broke/);
  fail = false;
  assert.equal((await usage.measure(DIR, HOME, false)).state, "unauthorised");
  assert.equal(reads, 2);
});

// --- telling the history about a fresh reading --------------------------------------------

test("a fresh reading is announced once, with when it was measured", async () => {
  const heard: Array<[string, number, number]> = [];
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => ok(),
    version: async () => "2",
    now: () => 7_000,
    onReading: (dir, result, measuredAt) => heard.push([dir, result.fiveHour?.utilization ?? -1, measuredAt]),
  });
  await usage.measure(DIR, HOME, false);
  assert.deepEqual(heard, [[DIR, 12, 7_000]]);
});

test("numbers kept through a 429, an expired token and a failure are not announced", async () => {
  let status = 200;
  let expiresAt: number | null = null;
  const heard: string[] = [];
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt }),
    request: async () =>
      status === 200 ? ok() : ({ status: 429, headers: new Headers({ "retry-after": "1500" }), text: async () => "" } as Response),
    version: async () => "2",
    now: () => 5_000,
    onReading: (dir) => heard.push(dir),
  });
  await usage.measure(DIR, HOME, false);
  status = 429;
  await usage.measure(DIR, HOME, false);
  status = 200;
  expiresAt = 1_000;
  await usage.measure(DIR, HOME, false);
  assert.deepEqual(heard, [DIR]);
});

test("a body with no windows is not announced", async () => {
  const heard: string[] = [];
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => body(200, {}),
    version: async () => "2",
    onReading: (dir) => heard.push(dir),
  });
  assert.equal((await usage.measure(DIR, HOME, false)).state, "none");
  assert.deepEqual(heard, []);
});

test("a listener that throws or rejects costs the reading nothing", async () => {
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => ok(),
    version: async () => "2",
    onReading: () => {
      throw new Error("no room in the history");
    },
  });
  assert.equal((await usage.measure(DIR, HOME, false)).state, "ok");

  const rejecting = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => ok(),
    version: async () => "2",
    onReading: async () => {
      throw new Error("no room in the history");
    },
  });
  assert.equal((await rejecting.measure(DIR, HOME, false)).state, "ok");
});

test("a failed request keeps the last numbers beside the error, with their own age", async () => {
  let clock = 1_000;
  let failing = false;
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => {
      if (failing) throw new Error("network down");
      return ok();
    },
    version: async () => "2",
    now: () => clock,
  });
  const first = await usage.measure(DIR, HOME, false);
  assert.equal(first.state, "ok");
  failing = true;
  clock = 900_000;
  const second = await usage.measure(DIR, HOME, false);
  assert.equal(second.state, "error");
  assert.equal(second.error, "network down");
  assert.deepEqual(second.fiveHour, first.fiveHour);
  assert.equal(usage.info(DIR)?.measuredAt, 1_000);
});

test("a 429 after a failed request keeps the numbers too, with the age of the last good reading", async () => {
  let clock = 1_000;
  let answer = "ok";
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => {
      if (answer === "throw") throw new Error("network down");
      if (answer === "429") return { status: 429, headers: new Headers({ "retry-after": "1500" }), text: async () => "" } as unknown as Response;
      return ok();
    },
    version: async () => "2",
    now: () => clock,
  });
  const first = await usage.measure(DIR, HOME, false);
  answer = "throw";
  clock = 700_000;
  await usage.measure(DIR, HOME, false);
  answer = "429";
  clock = 1_400_000;
  const held = await usage.measure(DIR, HOME, false);
  assert.deepEqual(held.fiveHour, first.fiveHour);
  assert.equal(held.state, "ok");
  assert.equal(held.error, "");
  assert.equal(usage.info(DIR)?.measuredAt, 1_000);
  assert.equal(usage.info(DIR)?.heldUntil, 1_400_000 + 1_500_000);
});

test("a failed request says why, not only that it failed", async () => {
  const usage = createUsage({
    readCredential: async () => ({ token: "token", expiresAt: null }),
    request: async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect timed out"), { code: "ETIMEDOUT" }) });
    },
    version: async () => "2",
  });
  assert.equal((await usage.measure(DIR, HOME, false)).error, "fetch failed (ETIMEDOUT)");
});
