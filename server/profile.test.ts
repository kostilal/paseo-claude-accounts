import { test } from "node:test";
import assert from "node:assert/strict";
import type { Identity } from "../shared/parse.ts";
import { KeychainTimeout } from "./keychain.ts";
import { type ProfileDeps, createProfiles, ownLogin, parseProfile, withProfile } from "./profile.ts";

const DIR = "/w/sends/.claude-data";
const DEFAULT_DIR = "/Users/me/.claude";
const MINUTE = 60_000;

const SSV = {
  account: { email: "bob@example.com", uuid: "acct-1" },
  organization: { name: "SSV Ltd", uuid: "org-ssv" },
};

function fake(over: Partial<ProfileDeps> = {}) {
  const state = { reads: 0, requests: 0, clock: 0, token: "tok-1", timeouts: [] as Array<number | null> };
  const deps: ProfileDeps = {
    readCredential: async (_service, timeoutMs) => {
      state.reads += 1;
      state.timeouts.push(timeoutMs);
      return { token: state.token, expiresAt: null };
    },
    request: async () => {
      state.requests += 1;
      return new Response(JSON.stringify(SSV), { status: 200 });
    },
    now: () => state.clock,
    ...over,
  };
  return { state, profiles: createProfiles(deps) };
}

test("a directory's identity is its own login's answer", async () => {
  const { profiles } = fake();
  assert.deepEqual(await profiles.identityOf(DIR, DEFAULT_DIR), { email: "bob@example.com", orgName: "SSV Ltd", orgId: "org-ssv" });
});

test("a second ask within the window reads nothing", async () => {
  const { state, profiles } = fake();
  await profiles.identityOf(DIR, DEFAULT_DIR);
  await profiles.identityOf(DIR, DEFAULT_DIR);
  assert.equal(state.reads, 1);
  assert.equal(state.requests, 1);
});

test("after the window the Keychain is read again, but the same token is not asked about", async () => {
  const { state, profiles } = fake();
  await profiles.identityOf(DIR, DEFAULT_DIR);
  state.clock += 11 * MINUTE;
  await profiles.identityOf(DIR, DEFAULT_DIR);
  assert.equal(state.reads, 2);
  assert.equal(state.requests, 1, "one grant is one account for good");
});

test("a new token — a refresh or a new login — is asked about", async () => {
  const { state, profiles } = fake();
  await profiles.identityOf(DIR, DEFAULT_DIR);
  state.clock += 11 * MINUTE;
  state.token = "tok-2";
  await profiles.identityOf(DIR, DEFAULT_DIR);
  assert.equal(state.requests, 2);
});

test("refresh skips the window", async () => {
  const { state, profiles } = fake();
  await profiles.identityOf(DIR, DEFAULT_DIR);
  await profiles.identityOf(DIR, DEFAULT_DIR, { refresh: true });
  assert.equal(state.reads, 2);
});

test("a background read gives a dialog three seconds; a person asking waits for it", async () => {
  const { state, profiles } = fake();
  await profiles.identityOf(DIR, DEFAULT_DIR);
  await profiles.identityOf(DIR, DEFAULT_DIR, { manual: true, refresh: true });
  assert.deepEqual(state.timeouts, [3_000, null]);
});

test("a Keychain dialog keeps the last answer and is not brought back within the window", async () => {
  const { state, profiles } = fake();
  const first = await profiles.identityOf(DIR, DEFAULT_DIR);
  state.clock += 11 * MINUTE;
  let blocked = 0;
  const blockedProfiles = createProfiles({
    readCredential: async () => {
      blocked += 1;
      throw new KeychainTimeout("a Keychain dialog is waiting");
    },
    request: async () => new Response("{}", { status: 200 }),
    now: () => state.clock,
  });
  assert.equal(await blockedProfiles.identityOf(DIR, DEFAULT_DIR), null, "nothing known yet is null");
  await blockedProfiles.identityOf(DIR, DEFAULT_DIR);
  assert.equal(blocked, 1, "the dialog is not asked for again within the window");
  assert.deepEqual(first, { email: "bob@example.com", orgName: "SSV Ltd", orgId: "org-ssv" });
});

test("a failed read after a good one keeps the good one", async () => {
  let fail = false;
  const { state, profiles } = fake({
    readCredential: async () => {
      if (fail) throw new Error("locked");
      return { token: "tok-1", expiresAt: null };
    },
  });
  await profiles.identityOf(DIR, DEFAULT_DIR);
  state.clock += 11 * MINUTE;
  fail = true;
  assert.equal((await profiles.identityOf(DIR, DEFAULT_DIR))?.orgName, "SSV Ltd");
});

test("a request Anthropic refuses keeps the last answer", async () => {
  let status = 200;
  const { state, profiles } = fake({
    request: async () => new Response(status === 200 ? JSON.stringify(SSV) : "{}", { status }),
  });
  await profiles.identityOf(DIR, DEFAULT_DIR);
  state.clock += 11 * MINUTE;
  state.token = "tok-2";
  status = 401;
  assert.equal((await profiles.identityOf(DIR, DEFAULT_DIR))?.email, "bob@example.com");
});

test("an expired token is never sent", async () => {
  const { state, profiles } = fake({
    readCredential: async () => ({ token: "tok-old", expiresAt: 0 }),
  });
  state.clock = 1;
  assert.equal(await profiles.identityOf(DIR, DEFAULT_DIR), null);
  assert.equal(state.requests, 0);
});

test("a profile without an account email names nobody", () => {
  assert.equal(parseProfile(JSON.stringify({ organization: { name: "x" } })), null);
  assert.deepEqual(parseProfile(JSON.stringify(SSV)), { email: "bob@example.com", orgName: "SSV Ltd", orgId: "org-ssv" });
});

const cached: Identity = { loggedIn: true, email: "kain@example.com", orgName: "Evodev", subscriptionType: "team" };

test("a login's own answer replaces the cached email and organisation, and keeps the rest", () => {
  assert.deepEqual(withProfile(cached, { email: "bob@example.com", orgName: "SSV Ltd", orgId: "org-ssv" }), {
    loggedIn: true,
    email: "bob@example.com",
    orgName: "SSV Ltd",
    orgId: "org-ssv",
    subscriptionType: "team",
  });
  assert.deepEqual(withProfile(cached, null), cached);
});

test("only a logged-in Claude account is asked", async () => {
  let asked = 0;
  const profile = async () => ((asked += 1), { email: "bob@example.com", orgName: "SSV Ltd", orgId: "org-ssv" });
  const claude = { provider: "claude", home: DIR };
  assert.equal((await ownLogin(claude, cached, profile)).orgName, "SSV Ltd");
  assert.equal((await ownLogin({ provider: "codex", home: DIR }, cached, profile)).orgName, "Evodev");
  assert.equal((await ownLogin(claude, { ...cached, loggedIn: false }, profile)).orgName, "Evodev");
  assert.equal((await ownLogin(claude, cached, undefined)).orgName, "Evodev");
  assert.equal(asked, 1);
});

test("a profile that throws leaves the discovered identity", async () => {
  const identity = await ownLogin({ provider: "claude", home: DIR }, cached, async () => {
    throw new Error("network");
  });
  assert.deepEqual(identity, cached);
});
