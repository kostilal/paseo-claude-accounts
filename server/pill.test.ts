import { test } from "node:test";
import assert from "node:assert/strict";
import { loginLabel } from "../shared/identity.ts";
import { claudeNotFound } from "./discover.ts";
import type { Registry } from "../shared/registry.ts";
import { type PillDeps, pillStateFor } from "./pill.ts";

const work = { id: "work", label: "Work", provider: "claude" as const, home: "/w/acme/.claude-data" };
const home = { id: "home", label: "Home", provider: "claude" as const, home: "/Users/me/.claude" };

function registry(over: Partial<Registry> = {}): Registry {
  return {
    version: 2,
    accounts: [work, home],
    agents: { ag1: "work" },
    ...over,
  };
}

// Distinct identities, so `work` and `home` never group into one login by accident.
function identityFor(dir: string) {
  if (dir === work.home) return { loggedIn: true, email: "work@example.com", orgName: "", subscriptionType: "max" };
  if (dir === home.home) return { loggedIn: true, email: "home@example.com", orgName: "", subscriptionType: "max" };
  return { loggedIn: false, email: "", orgName: "", subscriptionType: "" };
}

function deps(overrides: Partial<PillDeps> = {}): PillDeps {
  return {
    readRegistry: async () => registry(),
    projectHome: async () => null,
    identify: async (dir) => identityFor(dir),
    // Nothing authorised yet, so usage is read off switchTo.
    authorised: () => false,
    usageFor: async () => ({
      state: "ok" as const,
      fiveHour: { utilization: 0.18, resetsAt: "" },
      sevenDay: { utilization: 0.62, resetsAt: "" },
      error: "",
    }),
    ...overrides,
  };
}

const input = { agentId: "ag1", cwd: "/w/app", manual: false };

test("the account the session is on is the current one", async () => {
  const state = await pillStateFor(input, deps());
  assert.equal(state.currentId, "work");
  // `label` names the directory a press lands in; the client titles the row by its login.
  assert.equal(state.accounts.find((row) => row.current)?.label, "Work");
  assert.equal(state.accounts.find((row) => row.current)?.email, "work@example.com");
  assert.equal(state.accounts.find((row) => row.accountIds.includes("work"))?.current, true);
  assert.equal(state.accounts.find((row) => row.accountIds.includes("home"))?.current, false);
});

test("the tightest of the two windows is what the pill reports", async () => {
  const state = await pillStateFor(input, deps());
  assert.equal(state.tightest, 0.62);
});

test("every registered account is offered, logged in or not", async () => {
  const state = await pillStateFor(
    input,
    deps({
      identify: async (dir) =>
        dir === work.home
          ? { loggedIn: true, email: "work@example.com", orgName: "", subscriptionType: "max" }
          : { loggedIn: false, email: "", orgName: "", subscriptionType: "" },
    }),
  );
  assert.equal(state.accounts.length, 2);
  const homeRow = state.accounts.find((row) => row.accountIds.includes("home"));
  assert.equal(homeRow?.loggedIn, false);
  assert.equal(homeRow?.switchTo, "");
});

test("nothing bound leaves the pill with no current account rather than a guess", async () => {
  const bare = { ...registry(), agents: {} };
  const state = await pillStateFor(input, deps({ readRegistry: async () => bare }));
  assert.equal(state.currentId, "");
  assert.equal(state.tightest, null);
  assert.ok(state.accounts.every((row) => row.current === false));
});

test("an unknown allowance is null, not zero", async () => {
  const state = await pillStateFor(
    input,
    deps({
      usageFor: async () => ({ state: "unauthorised" as const, fiveHour: null, sevenDay: null, error: "" }),
    }),
  );
  assert.equal(state.tightest, null);
  assert.equal(state.accounts[0]?.usage, "unauthorised");
});

// Grouping: six directories, two logins and one logged-out directory

const site = { id: "site", label: "Site", provider: "claude" as const, home: "/h/site" };
const tools = { id: "tools", label: "Tools", provider: "claude" as const, home: "/h/tools" };
const apex = { id: "apex", label: "Apex", provider: "claude" as const, home: "/h/apex" };
const beta = { id: "beta", label: "Beta", provider: "claude" as const, home: "/h/beta" };
const team = { id: "team", label: "Team", provider: "claude" as const, home: "/h/team" };
const dflt = { id: "default", label: "default", provider: "claude" as const, home: "/h/default" };

const maxIdentity = { loggedIn: true, email: "alice@example.com", orgName: "", subscriptionType: "max" };
const teamIdentity = { loggedIn: true, email: "bob@example.com", orgName: "Acme", subscriptionType: "team" };
const loggedOutIdentity = { loggedIn: false, email: "", orgName: "", subscriptionType: "" };

function groupedRegistry(over: Partial<Registry> = {}): Registry {
  return {
    version: 2,
    accounts: [dflt, team, site, tools, apex, beta],
    agents: {},
    ...over,
  };
}

function groupedDeps(overrides: Partial<PillDeps> = {}): PillDeps {
  return {
    readRegistry: async () => groupedRegistry(),
    projectHome: async () => null,
    identify: async (dir) => {
      if (dir === dflt.home) return loggedOutIdentity;
      if (dir === team.home) return teamIdentity;
      return maxIdentity;
    },
    authorised: () => false,
    usageFor: async () => ({ state: "unauthorised" as const, fiveHour: null, sevenDay: null, error: "" }),
    ...overrides,
  };
}

test("four directories on one login collapse to one pill row carrying four sorted accountIds", async () => {
  const state = await pillStateFor(input, groupedDeps());
  const maxRow = state.accounts.find((row) => row.email === "alice@example.com");
  assert.deepEqual(maxRow?.accountIds, ["apex", "beta", "site", "tools"]);
});

test("a second login, with one directory, stays its own row", async () => {
  const state = await pillStateFor(input, groupedDeps());
  const teamRow = state.accounts.find((row) => row.email === "bob@example.com");
  assert.deepEqual(teamRow?.accountIds, ["team"]);
  assert.equal(teamRow?.orgName, "Acme");
  assert.equal(teamRow?.plan, "team");
});

test("a logged-out directory keeps its own row, with switchTo empty", async () => {
  const state = await pillStateFor(input, groupedDeps());
  const loggedOutRow = state.accounts.find((row) => row.accountIds.includes("default"));
  assert.equal(loggedOutRow?.loggedIn, false);
  assert.equal(loggedOutRow?.switchTo, "");
  assert.deepEqual(loggedOutRow?.accountIds, ["default"]);
});

test("the pill offers exactly three rows for six directories on two logins plus one log-out", async () => {
  const state = await pillStateFor(input, groupedDeps());
  assert.equal(state.accounts.length, 3);
});

test("every row carries what it takes to be named by its login rather than by a folder", () => {
  // The client names rows through loginLabel, falling back to `label` when no login is known.
  return pillStateFor(input, groupedDeps()).then((state) => {
    const named = state.accounts.map((row) => loginLabel(row, row.label));
    assert.deepEqual(named, [
      // No login to name the logged-out directory by, so its folder name is used.
      "default",
      "bob@example.com · Acme · team",
      "alice@example.com · max",
    ]);
    assert.equal(named.includes("Site"), false);
    assert.equal(named.includes("Team"), false);
  });
});

test("no claude anywhere is its own state, not every login reporting a log-out", async () => {
  const state = await pillStateFor(
    input,
    groupedDeps({
      identify: async () => {
        throw claudeNotFound();
      },
    }),
  );
  assert.equal(state.error, "claude-not-found");
  // Every row listed and unpressable; the named error tells this apart from "logged out".
  assert.equal(state.accounts.length, 6);
  assert.equal(state.accounts.every((row) => row.switchTo === ""), true);
});

test("an identify failure that is not the missing binary is not swallowed", async () => {
  await assert.rejects(
    pillStateFor(
      input,
      groupedDeps({
        identify: async () => {
          throw new Error("EACCES: permission denied");
        },
      }),
    ),
    /EACCES/,
  );
});

// switchTo

test("switchTo prefers the account this chat is already bound to", async () => {
  const state = await pillStateFor(
    input,
    groupedDeps({
      readRegistry: async () => groupedRegistry({ agents: { ag1: "tools" } }),
    }),
  );
  const maxRow = state.accounts.find((row) => row.email === "alice@example.com");
  assert.equal(maxRow?.switchTo, "tools");
  // `label` names where the press lands, not the lowest member.
  assert.equal(maxRow?.label, "Tools");
});

test("switchTo prefers this project's own directory over an arbitrary sibling", async () => {
  // Keeps the row named after the project's own directory, not a sibling sharing the login.
  const state = await pillStateFor(
    input,
    groupedDeps({ projectHome: async () => tools.home }),
  );
  const maxRow = state.accounts.find((row) => row.email === "alice@example.com");
  assert.equal(maxRow?.switchTo, "tools");
});

test("a project directory nobody registered leaves the choice exactly where it was", async () => {
  const state = await pillStateFor(
    input,
    groupedDeps({ projectHome: async () => "/h/unregistered" }),
  );
  const maxRow = state.accounts.find((row) => row.email === "alice@example.com");
  assert.equal(maxRow?.switchTo, "apex");
});

test("a project directory on a different login does not drag its own group's choice around", async () => {
  // `team` holds the other login, so the max row falls back to its lowest id.
  const state = await pillStateFor(
    input,
    groupedDeps({ projectHome: async () => team.home }),
  );
  const maxRow = state.accounts.find((row) => row.email === "alice@example.com");
  assert.equal(maxRow?.switchTo, "apex");
  const teamRow = state.accounts.find((row) => row.email === "bob@example.com");
  assert.equal(teamRow?.switchTo, "team");
});

test("a row lands on the member the chat is bound to", async () => {
  const state = await pillStateFor(
    input,
    groupedDeps({
      readRegistry: async () => groupedRegistry({ agents: { ag1: "apex" } }),
    }),
  );
  const maxRow = state.accounts.find((row) => row.email === "alice@example.com");
  assert.equal(maxRow?.switchTo, "apex");
  assert.equal(maxRow?.current, true);
});

test("switchTo falls back to the lowest id when nothing names this login", async () => {
  const state = await pillStateFor(
    input,
    groupedDeps({
      readRegistry: async () => groupedRegistry({ agents: { ag1: "team" } }),
    }),
  );
  const maxRow = state.accounts.find((row) => row.email === "alice@example.com");
  // The bound account belongs to the other login, so the lowest id wins.
  assert.equal(maxRow?.switchTo, "apex");
});

// Usage and "current" follow the group, not the directory

test("usage is read once per login, off switchTo, when nothing else is authorised yet", async () => {
  const seen: string[] = [];
  const state = await pillStateFor(
    input,
    groupedDeps({
      usageFor: async (dir) => {
        seen.push(dir);
        return { state: "ok" as const, fiveHour: { utilization: 0.5, resetsAt: "" }, sevenDay: null, error: "" };
      },
    }),
  );
  // The logged-out row has no switchTo and is never measured.
  assert.deepEqual(seen.sort(), [apex.home, team.home].sort());
  const maxRow = state.accounts.find((row) => row.email === "alice@example.com");
  assert.equal(maxRow?.usage, "ok");
  assert.equal(maxRow?.fiveHour?.utilization, 0.5);
});

// switchTo depends on context, so usage follows whichever directory was authorised.
test("usage prefers an already-authorised sibling over switchTo, so one authorisation counts everywhere", async () => {
  const seen: string[] = [];
  const state = await pillStateFor(
    input,
    groupedDeps({
      // switchTo is the lowest id, `apex`; `site` is the one already authorised.
      authorised: (dir) => dir === site.home,
      usageFor: async (dir) => {
        seen.push(dir);
        return { state: "ok" as const, fiveHour: { utilization: 0.4, resetsAt: "" }, sevenDay: null, error: "" };
      },
    }),
  );
  const maxRow = state.accounts.find((row) => row.email === "alice@example.com");
  assert.equal(maxRow?.switchTo, "apex");
  assert.equal(maxRow?.usage, "ok");
  assert.deepEqual(
    seen.filter((dir) => dir === site.home || dir === apex.home),
    [site.home],
  );
});

test("a login is current when the agent is on any of its directories, not only switchTo", async () => {
  const state = await pillStateFor(
    input,
    groupedDeps({
      // Bound to `site`; the project's own directory is `tools`, on the same login.
      readRegistry: async () => groupedRegistry({ agents: { ag1: "site" } }),
      projectHome: async () => tools.home,
    }),
  );
  const maxRow = state.accounts.find((row) => row.email === "alice@example.com");
  assert.equal(maxRow?.switchTo, "site");
  assert.equal(maxRow?.label, "Site");
  assert.equal(maxRow?.current, true);
  assert.equal(state.currentId, "site");
});

test("an unbound chat is current on its project's own directory, which is what it actually runs on", async () => {
  const state = await pillStateFor(
    input,
    groupedDeps({
      readRegistry: async () => groupedRegistry({ agents: {} }),
      projectHome: async () => team.home,
    }),
  );
  assert.equal(state.currentId, "team");
  const teamRow = state.accounts.find((row) => row.email === "bob@example.com");
  assert.equal(teamRow?.current, true);
});

test("a codex row reports an allowance nobody can measure, and reads no keychain", async () => {
  const codex = { id: "cdx", label: "Codex", provider: "codex" as const, home: "/Users/me/.codex" };
  let measured = false;
  const state = await pillStateFor(
    { agentId: "ag1", cwd: "/w", manual: true },
    deps({
      readRegistry: async () => registry({ accounts: [codex], agents: {} }),
      identify: async () => ({
        loggedIn: true,
        email: "p@example.com",
        orgName: "Personal",
        subscriptionType: "pro",
      }),
      usageFor: async () => {
        measured = true;
        return { state: "ok" as const, fiveHour: null, sevenDay: null, error: "" };
      },
    }),
  );
  assert.equal(measured, false);
  const row = state.accounts.find((account) => account.provider === "codex");
  assert.equal(row?.usage, "unsupported");
  assert.equal(row?.fiveHour, null);
  assert.equal(row?.sevenDay, null);
  // Still pressable without a meter.
  assert.equal(row?.loggedIn, true);
});

// A chat running on another account rewrites the login cached in its project's `.claude.json`,
// so `identify` (which reads that cache) can report another project's login for a directory.
const rewritten = { loggedIn: true, email: "home@example.com", orgName: "", subscriptionType: "max" };

test("a project whose cached login was rewritten keeps its own row", async () => {
  const merged = await pillStateFor(input, deps({ identify: async () => rewritten }));
  assert.equal(merged.accounts.length, 1, "without its own login the two directories read as one");

  const state = await pillStateFor(
    input,
    deps({
      identify: async () => rewritten,
      profile: async (dir) => (dir === work.home ? { email: "work@example.com", orgName: "", orgId: "org-work" } : null),
    }),
  );
  assert.equal(state.accounts.length, 2);
  assert.equal(state.accounts.find((row) => row.accountIds.includes("work"))?.email, "work@example.com");
  assert.equal(state.accounts.find((row) => row.accountIds.includes("home"))?.email, "home@example.com");
});
