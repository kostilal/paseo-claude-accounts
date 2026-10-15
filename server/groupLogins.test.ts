import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseCandidate, chooseUsageHome, groupByLogin, type LoginCandidate, type SwitchContext } from "./groupLogins.ts";

const noContext: SwitchContext = { boundAccountId: null, resolvedAccountId: null, projectAccountId: null };

// chooseCandidate

test("chooseCandidate: the account bound to this project wins, even over the resolved one", () => {
  const winner = chooseCandidate(["b", "a", "c"], { boundAccountId: "b", resolvedAccountId: "c", projectAccountId: null });
  assert.equal(winner, "b");
});

test("chooseCandidate: a bound account outside this group is ignored, falling to the resolved one", () => {
  const winner = chooseCandidate(["b", "a", "c"], { boundAccountId: "z", resolvedAccountId: "c", projectAccountId: null });
  assert.equal(winner, "c");
});

test("chooseCandidate: with nothing bound, the resolved account wins over the lowest id", () => {
  const winner = chooseCandidate(["b", "a", "c"], { boundAccountId: null, resolvedAccountId: "c", projectAccountId: null });
  assert.equal(winner, "c");
});

test("chooseCandidate: a resolved account outside this group is ignored, falling to the lowest id", () => {
  const winner = chooseCandidate(["b", "a", "c"], { boundAccountId: null, resolvedAccountId: "z", projectAccountId: null });
  assert.equal(winner, "a");
});

test("chooseCandidate: this project's own directory wins over the lowest id", () => {
  // Keeps the row named after the project's own directory rather than an arbitrary sibling.
  const winner = chooseCandidate(["c", "a", "b"], {
    boundAccountId: null,
    resolvedAccountId: null,
    projectAccountId: "c",
  });
  assert.equal(winner, "c");
});

test("chooseCandidate: this project's own directory still loses to a binding and to the resolution", () => {
  // A binding and the current resolution are deliberate; the project directory is a preference.
  assert.equal(
    chooseCandidate(["a", "b", "c"], { boundAccountId: "b", resolvedAccountId: null, projectAccountId: "c" }),
    "b",
  );
  assert.equal(
    chooseCandidate(["a", "b", "c"], { boundAccountId: null, resolvedAccountId: "b", projectAccountId: "c" }),
    "b",
  );
});

test("chooseCandidate: a project directory outside this group is ignored, falling to the lowest id", () => {
  const winner = chooseCandidate(["c", "a", "b"], {
    boundAccountId: null,
    resolvedAccountId: null,
    projectAccountId: "z",
  });
  assert.equal(winner, "a");
});

test("chooseCandidate: with nothing bound, resolved or local, the lowest id by sort order wins", () => {
  const winner = chooseCandidate(["c", "a", "b"], noContext);
  assert.equal(winner, "a");
});

test("chooseCandidate: a single candidate wins regardless of context", () => {
  const winner = chooseCandidate(["solo"], { boundAccountId: "solo", resolvedAccountId: "solo", projectAccountId: null });
  assert.equal(winner, "solo");
});

// groupByLogin

test("four directories on one login collapse into one group carrying four sorted accountIds", () => {
  const max = { loggedIn: true, email: "alice@example.com", orgName: "", subscriptionType: "max" };
  const directories: LoginCandidate[] = [
    { accountId: "site", home: "/Users/me/.claude-site", identity: max },
    { accountId: "tools", home: "/Users/me/.claude-tools", identity: max },
    { accountId: "apex", home: "/Users/me/.claude-apex", identity: max },
    { accountId: "beta", home: "/Users/me/.claude-beta", identity: max },
  ];
  const groups = groupByLogin(directories, noContext);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.accountIds, ["apex", "beta", "site", "tools"]);
});

test("a second login, with its own directory, stays its own group", () => {
  const max = { loggedIn: true, email: "alice@example.com", orgName: "", subscriptionType: "max" };
  const team = { loggedIn: true, email: "bob@example.com", orgName: "Acme", subscriptionType: "team" };
  const directories: LoginCandidate[] = [
    { accountId: "site", home: "/Users/me/.claude-site", identity: max },
    { accountId: "tools", home: "/Users/me/.claude-tools", identity: max },
    { accountId: "apex", home: "/Users/me/.claude-apex", identity: max },
    { accountId: "beta", home: "/Users/me/.claude-beta", identity: max },
    { accountId: "team", home: "/Users/me/.claude-team", identity: team },
  ];
  const groups = groupByLogin(directories, noContext);
  assert.equal(groups.length, 2);
  const teamGroup = groups.find((group) => group.accountIds.includes("team"));
  assert.deepEqual(teamGroup?.accountIds, ["team"]);
  assert.equal(teamGroup?.email, "bob@example.com");
  assert.equal(teamGroup?.orgName, "Acme");
  assert.equal(teamGroup?.plan, "team");
});

test("a logged-out directory keeps its own group, with switchTo empty", () => {
  const loggedOut = { loggedIn: false, email: "", orgName: "", subscriptionType: "" };
  const groups = groupByLogin(
    [{ accountId: "default", home: "/Users/me/.claude", identity: loggedOut }],
    noContext,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.loggedIn, false);
  assert.equal(groups[0]?.switchTo, "");
  assert.deepEqual(groups[0]?.accountIds, ["default"]);
});

test("two logged-out directories, both with no email, stay separate rather than merging", () => {
  const loggedOut = { loggedIn: false, email: "", orgName: "", subscriptionType: "" };
  const groups = groupByLogin(
    [
      { accountId: "default", home: "/Users/me/.claude", identity: loggedOut },
      { accountId: "spare", home: "/Users/me/.claude-spare", identity: loggedOut },
    ],
    noContext,
  );
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => group.accountIds),
    [["default"], ["spare"]],
  );
});

test("four directories on max, one on team, one logged out make three groups", () => {
  const max = { loggedIn: true, email: "alice@example.com", orgName: "", subscriptionType: "max" };
  const team = { loggedIn: true, email: "bob@example.com", orgName: "Acme", subscriptionType: "team" };
  const loggedOut = { loggedIn: false, email: "", orgName: "", subscriptionType: "" };
  const directories: LoginCandidate[] = [
    { accountId: "default", home: "/Users/me/.claude", identity: loggedOut },
    { accountId: "team", home: "/Users/me/.claude-team", identity: team },
    { accountId: "site", home: "/Users/me/.claude-site", identity: max },
    { accountId: "tools", home: "/Users/me/.claude-tools", identity: max },
    { accountId: "apex", home: "/Users/me/.claude-apex", identity: max },
    { accountId: "beta", home: "/Users/me/.claude-beta", identity: max },
  ];
  const groups = groupByLogin(directories, noContext);
  assert.equal(groups.length, 3, "default, team, and the four-directory max login");
  const byFirstMember = new Map(groups.map((group) => [group.accountIds[0], group]));
  assert.deepEqual(byFirstMember.get("default")?.accountIds, ["default"]);
  assert.deepEqual(byFirstMember.get("team")?.accountIds, ["team"]);
  assert.deepEqual(byFirstMember.get("apex")?.accountIds, ["apex", "beta", "site", "tools"]);
});

test("groups are ordered by each login's first-seen directory, not sorted by key", () => {
  const a = { loggedIn: true, email: "a@x.co", orgName: "", subscriptionType: "max" };
  const b = { loggedIn: true, email: "b@x.co", orgName: "", subscriptionType: "max" };
  const directories: LoginCandidate[] = [
    { accountId: "second", home: "/h/second", identity: b },
    { accountId: "first", home: "/h/first", identity: a },
    { accountId: "second-again", home: "/h/second-again", identity: b },
  ];
  const groups = groupByLogin(directories, noContext);
  assert.deepEqual(
    groups.map((group) => group.email),
    ["b@x.co", "a@x.co"],
  );
});

test("switchTo, email, orgName and plan all come from the chosen candidate, not just any member", () => {
  // One login, with a binding naming a specific directory: the row describes that one.
  const identityFor = (accountId: string) => ({
    loggedIn: true,
    email: "alice@example.com",
    orgName: "",
    subscriptionType: `plan-of-${accountId}`,
  });
  const directories: LoginCandidate[] = [
    { accountId: "apex", home: "/h/apex", identity: identityFor("apex") },
    { accountId: "beta", home: "/h/beta", identity: identityFor("beta") },
  ];
  const groups = groupByLogin(directories, { boundAccountId: "beta", resolvedAccountId: null, projectAccountId: null });
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.switchTo, "beta");
  assert.equal(groups[0]?.plan, "plan-of-beta");
});

test("an empty list of directories produces no groups", () => {
  assert.deepEqual(groupByLogin([], noContext), []);
});

// A member reporting loggedIn:false with the group's email must not break the whole login.

const workingMax = { loggedIn: true, email: "alice@example.com", orgName: "", subscriptionType: "max" };
/** Same login key as workingMax, but loggedIn is false. */
const brokenMax = { loggedIn: false, email: "alice@example.com", orgName: "", subscriptionType: "max" };

test("a member wrongly reporting loggedIn:false does not make a working login unswitchable", () => {
  const directories: LoginCandidate[] = [
    // The broken member sorts lowest.
    { accountId: "apex", home: "/h/apex", identity: brokenMax },
    { accountId: "beta", home: "/h/beta", identity: workingMax },
    { accountId: "site", home: "/h/site", identity: workingMax },
  ];
  const groups = groupByLogin(directories, noContext);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.loggedIn, true);
  // The lowest *logged-in* member, not the lowest member overall.
  assert.equal(groups[0]?.switchTo, "beta");
});

test("a member wrongly reporting loggedIn:false is skipped even when it is the bound account", () => {
  const directories: LoginCandidate[] = [
    { accountId: "apex", home: "/h/apex", identity: brokenMax },
    { accountId: "beta", home: "/h/beta", identity: workingMax },
  ];
  // Bound to the broken directory, yet the press must land on one that works.
  const groups = groupByLogin(directories, { boundAccountId: "apex", resolvedAccountId: null, projectAccountId: null });
  assert.equal(groups[0]?.loggedIn, true);
  assert.equal(groups[0]?.switchTo, "beta");
});

test("a login with every member reporting loggedIn:false stays not-logged-in, even sharing a real email", () => {
  const directories: LoginCandidate[] = [
    { accountId: "apex", home: "/h/apex", identity: brokenMax },
    { accountId: "beta", home: "/h/beta", identity: brokenMax },
  ];
  const groups = groupByLogin(directories, noContext);
  assert.equal(groups[0]?.loggedIn, false);
  assert.equal(groups[0]?.switchTo, "");
  assert.deepEqual(groups[0]?.accountIds, ["apex", "beta"]);
});

// chooseUsageHome: usage follows an already-authorised directory, since switchTo depends on
// context and differs between surfaces.

test("chooseUsageHome: an already-authorised member wins even when it is not switchTo", () => {
  const home = chooseUsageHome(
    { accountIds: ["apex", "beta"], switchTo: "beta" },
    (id) => `/h/${id}`,
    (home) => home === "/h/apex",
  );
  assert.equal(home, "/h/apex");
});

test("chooseUsageHome: falls back to switchTo when nothing is authorised yet", () => {
  const home = chooseUsageHome({ accountIds: ["apex", "beta"], switchTo: "beta" }, (id) => `/h/${id}`, () => false);
  assert.equal(home, "/h/beta");
});

test("chooseUsageHome: null when nothing is authorised and there is nothing to switch to", () => {
  const home = chooseUsageHome({ accountIds: ["apex", "beta"], switchTo: "" }, (id) => `/h/${id}`, () => false);
  assert.equal(home, null);
});

test("chooseUsageHome: the lowest-sorted authorised member wins when more than one qualifies", () => {
  const home = chooseUsageHome(
    { accountIds: ["b", "a", "c"], switchTo: "c" },
    (id) => `/h/${id}`,
    (home) => home === "/h/a" || home === "/h/b",
  );
  assert.equal(home, "/h/a");
});

test("chooseUsageHome: a group with nothing registered at all reads nothing", () => {
  const home = chooseUsageHome({ accountIds: [], switchTo: "" }, () => null, () => true);
  assert.equal(home, null);
});
