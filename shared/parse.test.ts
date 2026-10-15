import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAuthStatus, parseUsage } from "./parse.ts";

test("a logged-in account yields its identity", () => {
  const raw = JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    email: "bob@example.com",
    orgId: "9181569c",
    orgName: "Acme",
    subscriptionType: "team",
    somethingNew: 42,
  });
  assert.deepEqual(parseAuthStatus(raw), {
    loggedIn: true,
    email: "bob@example.com",
    orgName: "Acme",
    subscriptionType: "team",
  });
});

test("a logged-out account yields empty strings, not undefined", () => {
  assert.deepEqual(parseAuthStatus(JSON.stringify({ loggedIn: false })), {
    loggedIn: false,
    email: "",
    orgName: "",
    subscriptionType: "",
  });
});

test("non-JSON is a SyntaxError the caller can catch", () => {
  assert.throws(() => parseAuthStatus("not json at all"), SyntaxError);
});

test("usage with both windows", () => {
  const raw = JSON.stringify({
    five_hour: { utilization: 37, resets_at: "2026-09-11T18:00:00Z" },
    seven_day: { utilization: 4, resets_at: "2026-09-15T00:00:00Z" },
    extra_usage: { enabled: false },
  });
  assert.deepEqual(parseUsage(raw), {
    fiveHour: { utilization: 37, resetsAt: "2026-09-11T18:00:00Z" },
    sevenDay: { utilization: 4, resetsAt: "2026-09-15T00:00:00Z" },
  });
});

test("a missing window is null rather than a zero bar", () => {
  const raw = JSON.stringify({ five_hour: { utilization: 12, resets_at: "2026-09-11T18:00:00Z" } });
  assert.deepEqual(parseUsage(raw), {
    fiveHour: { utilization: 12, resetsAt: "2026-09-11T18:00:00Z" },
    sevenDay: null,
  });
});

test("a 401 body has no windows at all", () => {
  const raw = JSON.stringify({ error: { type: "authentication_error" } });
  assert.deepEqual(parseUsage(raw), { fiveHour: null, sevenDay: null });
});

test("parseAuthStatus tolerates a top-level null payload", () => {
  assert.deepEqual(parseAuthStatus("null"), {
    loggedIn: false,
    email: "",
    orgName: "",
    subscriptionType: "",
  });
});

test("parseAuthStatus tolerates a top-level array payload", () => {
  assert.deepEqual(parseAuthStatus("[1,2,3]"), {
    loggedIn: false,
    email: "",
    orgName: "",
    subscriptionType: "",
  });
});

test("parseAuthStatus tolerates a top-level scalar payload", () => {
  assert.deepEqual(parseAuthStatus("42"), {
    loggedIn: false,
    email: "",
    orgName: "",
    subscriptionType: "",
  });
});

test("parseUsage tolerates a top-level null payload", () => {
  assert.deepEqual(parseUsage("null"), { fiveHour: null, sevenDay: null });
});

test("parseUsage tolerates a top-level array payload", () => {
  assert.deepEqual(parseUsage("[1,2,3]"), { fiveHour: null, sevenDay: null });
});

test("parseUsage tolerates a top-level scalar payload", () => {
  assert.deepEqual(parseUsage("42"), { fiveHour: null, sevenDay: null });
});
