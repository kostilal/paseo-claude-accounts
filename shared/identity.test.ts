import { test } from "node:test";
import assert from "node:assert/strict";
import { loginKey, loginLabel, type Login } from "./identity.ts";

test("the same email and orgName is the same login, from any directory", () => {
  const a = loginKey({ email: "bob@example.com", orgName: "Acme" }, "/Users/me/.claude-work");
  const b = loginKey({ email: "bob@example.com", orgName: "Acme" }, "/Users/me/.claude-personal");
  assert.equal(a, b);
});

test("the same email under a different orgName is a different login", () => {
  const personal = loginKey(
    { email: "alice@example.com", orgName: "" },
    "/Users/me/.claude-work",
  );
  const team = loginKey(
    { email: "alice@example.com", orgName: "Acme" },
    "/Users/me/.claude-work",
  );
  assert.notEqual(personal, team);
});

test("an empty email keys on its own home, so unidentified directories stay separate", () => {
  const a = loginKey({ email: "", orgName: "" }, "/Users/me/.claude");
  const b = loginKey({ email: "", orgName: "" }, "/Users/me/.claude-work-data");
  assert.notEqual(a, b);
});

test("an empty email ignores orgName and keys on home alone", () => {
  const a = loginKey({ email: "", orgName: "" }, "/Users/me/.claude");
  const b = loginKey({ email: "", orgName: "some-leftover-value" }, "/Users/me/.claude");
  assert.equal(a, b);
});

test("an unidentified directory's key never lands in an identified login's key space", () => {
  const anonymous = loginKey({ email: "", orgName: "" }, "/Users/me/.claude");
  const identified = loginKey({ email: "bob@example.com", orgName: "Acme" }, "/Users/me/.claude");
  assert.notEqual(anonymous, identified);
});

/** A sentinel that must never appear once there is a part to join. */
const unusedFallback = "UNUSED-FALLBACK";

test("loginLabel joins email, orgName and plan, ignoring the fallback it was given", () => {
  const login: Login = { key: "x", email: "bob@example.com", orgName: "Acme", plan: "team" };
  assert.equal(loginLabel(login, unusedFallback), "bob@example.com · Acme · team");
});

test("loginLabel drops a missing orgName rather than leaving a stray separator", () => {
  const login: Login = { key: "x", email: "alice@example.com", orgName: "", plan: "max" };
  assert.equal(loginLabel(login, unusedFallback), "alice@example.com · max");
});

test("loginLabel drops the auto-generated personal org rather than printing the address twice", () => {
  // A personal account reports orgName "<email>'s Organization", not blank.
  const login: Login = {
    key: "x",
    email: "alice@example.com",
    orgName: "alice@example.com's Organization",
    plan: "max",
  };
  assert.equal(loginLabel(login, unusedFallback), "alice@example.com · max");
});

test("loginLabel keeps a real organisation, which is the whole point of showing one", () => {
  const login: Login = { key: "x", email: "bob@example.com", orgName: "Acme", plan: "team" };
  assert.equal(loginLabel(login, unusedFallback), "bob@example.com · Acme · team");
});

test("dropping a redundant part never changes which directories are one login", () => {
  // loginKey reads the raw orgName; only the label filters it.
  const a = loginKey(
    { email: "alice@example.com", orgName: "alice@example.com's Organization" },
    "/h/site",
  );
  const b = loginKey(
    { email: "alice@example.com", orgName: "alice@example.com's Organization" },
    "/h/tools",
  );
  const other = loginKey({ email: "alice@example.com", orgName: "" }, "/h/site");
  assert.equal(a, b);
  assert.notEqual(a, other);
});

test("loginLabel drops every empty part, whichever position it is in", () => {
  assert.equal(loginLabel({ email: "", orgName: "", plan: "max" }, unusedFallback), "max");
  assert.equal(loginLabel({ email: "a@b.co", orgName: "", plan: "" }, unusedFallback), "a@b.co");
  assert.equal(loginLabel({ email: "", orgName: "Acme", plan: "" }, unusedFallback), "Acme");
});

test("loginLabel returns the caller's fallback when nothing is known, not a literal of its own", () => {
  const login: Login = { key: "x", email: "", orgName: "", plan: "" };
  // A non-English fallback: this module must have no English string of its own.
  assert.equal(loginLabel(login, "вхід не виконано"), "вхід не виконано");
  assert.equal(loginLabel(login, "not logged in"), "not logged in");
});
