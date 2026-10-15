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
