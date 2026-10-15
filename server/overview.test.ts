import { test } from "node:test";
import assert from "node:assert/strict";
import type { PaseoApi } from "@getpaseo/client";
import type { AccountView } from "../shared/accounts.ts";
import { loginKey, loginLabel } from "../shared/identity.ts";
import { claudeNotFound } from "./discover.ts";
import type { Registry } from "../shared/registry.ts";
import {
  createOverview,
  createUsageRow,
  type OverviewDeps,
  type UsageReader,
  type UsageRowDeps,
} from "./overview.ts";
import type { UsageResult } from "./usage.ts";

const WORK = "/Users/me/.claude-work";
const PERSONAL = "/Users/me/.claude-personal";
const SPARE = "/Users/me/.claude-spare";

/** Every dependency is injected, so nothing here reaches through the API object. */
const paseo = {} as unknown as PaseoApi;

const workAccount = { id: "work", label: "Work", provider: "claude" as const, home: WORK };
const personalAccount = { id: "personal", label: "Personal", provider: "claude" as const, home: PERSONAL };

/** A row as `discover()` would return it, with `key` derived the way discovery does. */
function account(id: string, over: Partial<AccountView> = {}): AccountView {
  const email = over.email ?? "";
  const orgName = over.orgName ?? "";
  const home = over.home ?? id;
  const subscriptionType = over.subscriptionType ?? "";
  return {
    id,
    name: id.slice(id.lastIndexOf("/") + 1),
    home,
    provider: "claude",
    registered: true,
    key: loginKey({ email, orgName }, home),
    loggedIn: true,
    email,
    orgName,
    subscriptionType,
    accountIds: [],
    switchTo: "",
    hasToken: false,
    usage: "unauthorised",
    fiveHour: null,
    sevenDay: null,
    usageErrorCode: "",
    usageError: "",
    ...over,
  };
}

function meter(over: Partial<UsageResult> = {}): UsageResult {
  return { state: "ok", fiveHour: { utilization: 12, resetsAt: "x" }, sevenDay: null, error: "", ...over };
}

function usageReader(over: Partial<UsageReader> = {}): UsageReader {
  return {
    authorised: () => false,
    stale: () => true,
    cached: () => null,
    measure: async () => meter(),
    ...over,
  };
}

function deps(over: Partial<OverviewDeps> = {}): OverviewDeps {
  return {
    discover: async () => [account(WORK), account(PERSONAL)],
    readRegistry: async () => registry(),
    projects: {
      list: async () => [{ id: "p1", name: "Acme", path: "/Users/me/Work/acme" }],
    },
    usage: usageReader(),
    defaultDir: () => "/Users/me/.claude",
    log: () => {},
    ...over,
  };
}

function registry(over: Partial<Registry> = {}): Registry {
  return {
    version: 2,
    accounts: [workAccount, personalAccount],
    agents: {},
    ...over,
  };
}

test("registered accounts come back in registry order, with no error", async () => {
  const view = await createOverview(deps())(paseo);
  assert.deepEqual(
    view.accounts.map((row) => row.id),
    ["work", "personal"],
  );
  assert.equal(view.error, "");
});

test("refresh is passed through to discovery, and defaults to off", async () => {
  const seen: boolean[] = [];
  const overview = createOverview(
    deps({
      discover: async (_paths, refresh) => {
        seen.push(refresh);
        return [];
      },
    }),
  );
  await overview(paseo);
  await overview(paseo, true);
  assert.deepEqual(seen, [false, true]);
});

test("the project paths discovery is asked about are the ones Paseo knows", async () => {
  let seen: readonly string[] = [];
  await createOverview(
    deps({
      discover: async (paths) => {
        seen = paths;
        return [];
      },
    }),
  )(paseo);
  assert.deepEqual(seen, ["/Users/me/Work/acme"]);
});

test("every logged-in login is read on a poll, once per directory, bounded by the reader", async () => {
  let reads = 0;
  const view = await createOverview(
    deps({
      usage: usageReader({
        authorised: (dir) => dir === WORK,
        measure: async () => {
          reads += 1;
          return meter();
        },
      }),
    }),
  )(paseo);
  assert.equal(reads, 2);
  assert.equal(view.accounts[0]?.usage, "ok");
  assert.equal(view.accounts[1]?.usage, "ok");
});

test("a fresh cache answers instead of a second Keychain read", async () => {
  let reads = 0;
  const view = await createOverview(
    deps({
      usage: usageReader({
        authorised: () => true,
        stale: () => false,
        cached: () => meter({ state: "none" }),
        measure: async () => {
          reads += 1;
          return meter();
        },
      }),
    }),
  )(paseo);
  assert.equal(reads, 0);
  assert.equal(view.accounts[0]?.usage, "none");
});

test("Reload measures again over a fresh cache, and asks for identity afresh too", async () => {
  let reads = 0;
  const refreshes: boolean[] = [];
  const view = await createOverview(
    deps({
      discover: async (_paths, refresh) => {
        refreshes.push(refresh);
        return [account(WORK), account(PERSONAL)];
      },
      usage: usageReader({
        authorised: () => true,
        stale: (_dir, force) => force === true,
        cached: () => meter({ state: "none" }),
        measure: async () => {
          reads += 1;
          return meter();
        },
      }),
    }),
  )(paseo, false, true);
  assert.equal(reads, 2);
  assert.deepEqual(refreshes, [true]);
  assert.equal(view.accounts[0]?.usage, "ok");
});

test("one account's meter failing cannot blank the whole block", async () => {
  const lines: string[] = [];
  const view = await createOverview(
    deps({
      usage: usageReader({
        authorised: () => true,
        measure: async (dir) => {
          if (dir === WORK) throw new Error("the Keychain is locked");
          return meter();
        },
      }),
      log: (line) => lines.push(line),
    }),
  )(paseo);
  assert.equal(view.accounts[0]?.usage, "error");
  assert.match(view.accounts[0]?.usageError ?? "", /Keychain is locked/);
  // The other account, and the rest of the screen, are unaffected.
  assert.equal(view.accounts[1]?.usage, "ok");
  assert.equal(view.error, "");
  assert.equal(lines.length, 1);
});

test("a logged-in directory nobody registered is offered, marked unregistered", async () => {
  const view = await createOverview(
    deps({ discover: async () => [account(WORK), account(PERSONAL), account(SPARE)] }),
  )(paseo);
  const suggestion = view.accounts.find((account) => account.registered === false);
  assert.ok(suggestion, "expected an unregistered suggestion row");
  assert.equal(suggestion.id, suggestion.home);
  assert.equal(suggestion.loggedIn, true);
  // A suggestion is never grouped, so it has no registry account to switch to.
  assert.deepEqual(suggestion.accountIds, []);
  assert.equal(suggestion.switchTo, "");
});

test("a directory the user deleted from the list is not offered back as a suggestion", async () => {
  // Delete only forgets: discovery still finds the directory, `hidden` keeps it out.
  const view = await createOverview(
    deps({
      discover: async () => [account(WORK), account(PERSONAL), account(SPARE)],
      readRegistry: async () => registry({ hidden: [SPARE] }),
    }),
  )(paseo);
  assert.equal(view.accounts.some((row) => row.registered === false), false);
  assert.equal(view.accounts.some((row) => row.home === SPARE), false);
});

test("a deleted registered account disappears and its home is not suggested either", async () => {
  const view = await createOverview(
    deps({ readRegistry: async () => registry({ accounts: [personalAccount], hidden: [WORK] }) }),
  )(paseo);
  assert.deepEqual(
    view.accounts.map((row) => row.id),
    ["personal"],
  );
});

test("the overview lists what was hidden, named by its login where discovery still sees it", async () => {
  const view = await createOverview(
    deps({
      discover: async () => [account(WORK), account(PERSONAL), account(SPARE, { email: "carol@example.com" })],
      readRegistry: async () => registry({ hidden: [SPARE, "/Users/me/.claude-gone"] }),
    }),
  )(paseo);
  assert.deepEqual(
    view.hidden.map((row) => [row.home, row.email, row.loggedIn]),
    [
      [SPARE, "carol@example.com", true],
      ["/Users/me/.claude-gone", "", false],
    ],
  );
  assert.equal(view.hidden[1].name, ".claude-gone");
});

test("nothing hidden means an empty list, not a missing one", async () => {
  const view = await createOverview(deps())(paseo);
  assert.deepEqual(view.hidden, []);
});

// Grouping: six directories, two logins and one logged-out directory

const SITE = "/Users/me/.claude-site";
const TOOLS = "/Users/me/.claude-tools";
const APEX = "/Users/me/.claude-apex";
const BETA = "/Users/me/.claude-beta";
const TEAM = "/Users/me/.claude-team";
const DEFAULT_DIR = "/Users/me/.claude";

const MAX_EMAIL = "alice@example.com";
const TEAM_EMAIL = "bob@example.com";

function groupedRegistry(over: Partial<Registry> = {}): Registry {
  return {
    version: 2,
    accounts: [
      { id: "default", label: "default", provider: "claude" as const, home: DEFAULT_DIR },
      { id: "team", label: "Team", provider: "claude" as const, home: TEAM },
      { id: "site", label: "Site", provider: "claude" as const, home: SITE },
      { id: "tools", label: "Tools", provider: "claude" as const, home: TOOLS },
      { id: "apex", label: "Apex", provider: "claude" as const, home: APEX },
      { id: "beta", label: "Beta", provider: "claude" as const, home: BETA },
    ],
    agents: {},
    ...over,
  };
}

function groupedDiscovered(): AccountView[] {
  return [
    account(DEFAULT_DIR, { loggedIn: false }),
    account(TEAM, { email: TEAM_EMAIL, orgName: "Acme", subscriptionType: "team" }),
    account(SITE, { email: MAX_EMAIL, subscriptionType: "max" }),
    account(TOOLS, { email: MAX_EMAIL, subscriptionType: "max" }),
    account(APEX, { email: MAX_EMAIL, subscriptionType: "max" }),
    account(BETA, { email: MAX_EMAIL, subscriptionType: "max" }),
  ];
}

test("four directories on one login collapse to one registered row carrying four sorted accountIds", async () => {
  const view = await createOverview(
    deps({ discover: async () => groupedDiscovered(), readRegistry: async () => groupedRegistry() }),
  )(paseo);
  const maxRow = view.accounts.find((row) => row.email === MAX_EMAIL);
  assert.deepEqual(maxRow?.accountIds, ["apex", "beta", "site", "tools"]);
  assert.equal(maxRow?.registered, true);
});

test("a second login, with one directory, stays its own registered row", async () => {
  const view = await createOverview(
    deps({ discover: async () => groupedDiscovered(), readRegistry: async () => groupedRegistry() }),
  )(paseo);
  const teamRow = view.accounts.find((row) => row.email === TEAM_EMAIL);
  assert.deepEqual(teamRow?.accountIds, ["team"]);
  assert.equal(teamRow?.orgName, "Acme");
  assert.equal(teamRow?.subscriptionType, "team");
});

test("every registered row carries what it takes to be named by its login, not by a folder", async () => {
  // The screen names rows through loginLabel, falling back to `name` when no login is known.
  const view = await createOverview(
    deps({ discover: async () => groupedDiscovered(), readRegistry: async () => groupedRegistry() }),
  )(paseo);
  const named = view.accounts
    .filter((row) => row.registered)
    .map((row) => loginLabel({ email: row.email, orgName: row.orgName, plan: row.subscriptionType }, row.name));
  assert.deepEqual(named, [
    "default",
    "bob@example.com · Acme · team",
    "alice@example.com · max",
  ]);
});

test("no claude anywhere is its own state, not every subscription reporting a log-out", async () => {
  const view = await createOverview(
    deps({
      readRegistry: async () => groupedRegistry(),
      discover: async () => {
        throw claudeNotFound();
      },
    }),
  )(paseo);
  assert.equal(view.error, "claude-not-found");
  // Registered rows come from the registry, so they survive.
  assert.equal(view.accounts.length, 6);
  assert.equal(view.accounts.every((row) => !row.loggedIn), true);
});

test("a discovery failure that is not the missing binary still takes the screen down", async () => {
  await assert.rejects(
    createOverview(
      deps({
        discover: async () => {
          throw new Error("EACCES: permission denied, scandir '/Users/me'");
        },
      }),
    )(paseo),
    /EACCES/,
  );
});

test("a logged-out directory keeps its own registered row, with switchTo empty", async () => {
  const view = await createOverview(
    deps({ discover: async () => groupedDiscovered(), readRegistry: async () => groupedRegistry() }),
  )(paseo);
  const loggedOutRow = view.accounts.find((row) => row.accountIds.includes("default"));
  assert.equal(loggedOutRow?.loggedIn, false);
  assert.equal(loggedOutRow?.switchTo, "");
  assert.deepEqual(loggedOutRow?.accountIds, ["default"]);
});

test("six directories on two logins plus one log-out become three registered rows", async () => {
  const view = await createOverview(
    deps({ discover: async () => groupedDiscovered(), readRegistry: async () => groupedRegistry() }),
  )(paseo);
  assert.equal(view.accounts.filter((row) => row.registered).length, 3);
});

test("usage for a grouped row is read once, off switchTo's directory, not once per directory", async () => {
  const seen: string[] = [];
  const view = await createOverview(
    deps({
      discover: async () => groupedDiscovered(),
      readRegistry: async () => groupedRegistry(),
      usage: usageReader({
        authorised: (dir) => dir !== DEFAULT_DIR,
        measure: async (dir) => {
          seen.push(dir);
          return meter();
        },
      }),
    }),
  )(paseo);
  // The logged-out row has no switchTo and is never read.
  assert.deepEqual(seen.sort(), [APEX, TEAM].sort());
  const maxRow = view.accounts.find((row) => row.email === MAX_EMAIL);
  assert.equal(maxRow?.usage, "ok");
});

// The pill and this screen can pick different directories for one login, so usage
// follows whichever directory is already authorised.
test("usage prefers an already-authorised sibling over switchTo, so one authorisation counts on every surface", async () => {
  const seen: string[] = [];
  const view = await createOverview(
    deps({
      discover: async () => groupedDiscovered(),
      readRegistry: async () => groupedRegistry(),
      usage: usageReader({
        // Only `site` is authorised; switchTo is the lowest id, `apex`.
        authorised: (dir) => dir === SITE,
        measure: async (dir) => {
          seen.push(dir);
          return meter();
        },
      }),
    }),
  )(paseo);
  const maxRow = view.accounts.find((row) => row.email === MAX_EMAIL);
  assert.equal(maxRow?.switchTo, "apex");
  assert.equal(maxRow?.usage, "ok");
  assert.deepEqual(seen.filter((dir) => dir !== TEAM), [SITE]);
});

// The row `id` the client acts on must name the directory switchTo names.
test("the bridge id follows switchTo, not the lowest accountId, when the lowest member cannot be switched to", async () => {
  const view = await createOverview(
    deps({
      discover: async () => [
        account(DEFAULT_DIR, { loggedIn: false }),
        account(TEAM, { email: TEAM_EMAIL, orgName: "Acme", subscriptionType: "team" }),
        // `apex` sorts lowest but cannot be switched to.
        account(APEX, { email: MAX_EMAIL, subscriptionType: "max", loggedIn: false }),
        account(SITE, { email: MAX_EMAIL, subscriptionType: "max" }),
        account(TOOLS, { email: MAX_EMAIL, subscriptionType: "max" }),
        account(BETA, { email: MAX_EMAIL, subscriptionType: "max" }),
      ],
      readRegistry: async () => groupedRegistry(),
    }),
  )(paseo);
  const maxRow = view.accounts.find((row) => row.email === MAX_EMAIL);
  assert.equal(maxRow?.switchTo, "beta"); // the lowest of the three that are logged in
  assert.equal(maxRow?.id, "beta");
});

test("an unregistered suggestion stays its own row, even sharing a login with a registered one", async () => {
  const view = await createOverview(
    deps({
      discover: async () => [...groupedDiscovered(), account(SPARE, { email: MAX_EMAIL, subscriptionType: "max" })],
      readRegistry: async () => groupedRegistry(),
    }),
  )(paseo);
  const suggestion = view.accounts.find((row) => row.registered === false);
  assert.ok(suggestion, "expected an unregistered suggestion row");
  assert.equal(suggestion.home, SPARE);
  assert.deepEqual(suggestion.accountIds, []);
  assert.equal(suggestion.switchTo, "");
  // Not folded into the registered row that shares its login.
  const maxRow = view.accounts.find((row) => row.email === MAX_EMAIL && row.registered);
  assert.equal(maxRow?.accountIds.length, 4);
});

function rowDeps(over: Partial<UsageRowDeps> = {}): UsageRowDeps {
  return {
    knownHomes: async () => [WORK, PERSONAL],
    identify: async () => ({ loggedIn: true, email: "bob@example.com", orgName: "Acme", subscriptionType: "team" }),
    usage: usageReader(),
    defaultDir: () => "/Users/me/.claude",
    ...over,
  };
}

test("a measured row carries the identity and the meter together", async () => {
  const manual: boolean[] = [];
  const fresh: boolean[] = [];
  const row = await createUsageRow(
    rowDeps({
      identify: async (_dir, refresh) => {
        fresh.push(refresh);
        return { loggedIn: true, email: "bob@example.com", orgName: "Acme", subscriptionType: "team" };
      },
      usage: usageReader({
        measure: async (_dir, _default, isManual) => {
          manual.push(isManual);
          return meter();
        },
      }),
    }),
  )(paseo, WORK);
  assert.equal(row.id, WORK);
  assert.equal(row.name, "work");
  assert.equal(row.email, "bob@example.com");
  assert.equal(row.usage, "ok");
  assert.equal(row.usageErrorCode, "");
  // A manual read waits for the Keychain dialog and bypasses the identity cache.
  assert.deepEqual(manual, [true]);
  assert.deepEqual(fresh, [true]);
  // One directory, no grouping: accountIds and switchTo are attached by the caller.
  assert.equal(row.key, loginKey({ email: "bob@example.com", orgName: "Acme" }, WORK));
  assert.equal(row.subscriptionType, "team");
  assert.deepEqual(row.accountIds, []);
  assert.equal(row.switchTo, "");
});

test("a directory nobody discovered answers a case, not a measurement", async () => {
  let measured = false;
  const row = await createUsageRow(
    rowDeps({
      usage: usageReader({
        measure: async () => {
          measured = true;
          return meter();
        },
      }),
    }),
  )(paseo, "/Users/me/.claude-gone");
  assert.equal(row.usageErrorCode, "unknown-account");
  assert.equal(row.usage, "error");
  // A case the client can translate, not a sentence in the daemon's language.
  assert.equal(row.usageError, "");
  assert.equal(row.loggedIn, false);
  assert.equal(measured, false);
  assert.deepEqual(row.accountIds, []);
  assert.equal(row.switchTo, "");
});

test("a per-job directory is its own account, not an unknown one", async () => {
  const job = "/Users/me/Work/acme/.claude-data";
  const row = await createUsageRow(rowDeps({ knownHomes: async () => [WORK, job] }))(paseo, job);
  assert.equal(row.usageErrorCode, "");
  assert.equal(row.name, "acme");
});

test("a registered directory outside both discovery families is measurable, not a ghost", async () => {
  // Connect accepts any absolute path, such as one on an external disk.
  const external = "/Volumes/Work/claude-data";
  const row = await createUsageRow(rowDeps({ knownHomes: async () => [WORK, PERSONAL, external] }))(paseo, external);
  assert.equal(row.usageErrorCode, "");
  assert.equal(row.loggedIn, true);
});

// Providers

const CODEX = "/Users/me/.codex-work";
const codexAccount = { id: "cdx", label: "Codex", provider: "codex" as const, home: CODEX };

test("a codex directory offered as a suggestion stays codex, and is never measured", async () => {
  const measured: string[] = [];
  const view = await createOverview(
    deps({
      discover: async () => [account(WORK), account(PERSONAL), account(CODEX, { provider: "codex", email: "bob@example.com" })],
      usage: usageReader({
        authorised: () => true,
        measure: async (dir) => {
          measured.push(dir);
          return meter();
        },
      }),
    }),
  )(paseo);
  const suggestion = view.accounts.find((row) => row.home === CODEX);
  assert.equal(suggestion?.registered, false);
  assert.equal(suggestion?.provider, "codex");
  assert.equal(suggestion?.usage, "unsupported");
  assert.equal(measured.includes(CODEX), false);
});

test("a claude suggestion keeps the claude provider", async () => {
  const view = await createOverview(
    deps({ discover: async () => [account(WORK), account(PERSONAL), account(SPARE)] }),
  )(paseo);
  assert.equal(view.accounts.find((row) => row.home === SPARE)?.provider, "claude");
});

test("a registered codex row can be switched to whenever it is logged in, with no token", async () => {
  const view = await createOverview(
    deps({
      discover: async () => [account(CODEX, { provider: "codex", email: "bob@example.com" })],
      readRegistry: async () => registry({ accounts: [codexAccount] }),
    }),
  )(paseo);
  const row = view.accounts.find((row) => row.accountIds.includes("cdx"));
  assert.equal(row?.provider, "codex");
  assert.equal(row?.hasToken, true);
  assert.equal(row?.usage, "unsupported");
});

test("a registered codex row that is logged out cannot be switched to", async () => {
  const view = await createOverview(
    deps({
      discover: async () => [account(CODEX, { provider: "codex", loggedIn: false })],
      readRegistry: async () => registry({ accounts: [codexAccount] }),
    }),
  )(paseo);
  assert.equal(view.accounts.find((row) => row.accountIds.includes("cdx"))?.hasToken, false);
});

test("a registered claude row has a token only once one was minted for it", async () => {
  const view = await createOverview(
    deps({
      discover: async () => [
        account(WORK, { email: "alice@example.com" }),
        account(PERSONAL, { email: "bob@example.com" }),
      ],
      readRegistry: async () =>
        registry({ accounts: [{ ...workAccount, tokenLogin: "alice@example.com" }, personalAccount] }),
    }),
  )(paseo);
  assert.equal(view.accounts.find((row) => row.accountIds.includes("work"))?.hasToken, true);
  assert.equal(view.accounts.find((row) => row.accountIds.includes("personal"))?.hasToken, false);
});
