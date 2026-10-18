import { test } from "node:test";
import assert from "node:assert/strict";
import type { Registry } from "../shared/registry.ts";
import { type DefaultDeps, cachedTokenCheck, checkDefault, defaultOptions } from "./defaults.ts";

const keyed = { id: "team", label: "Team", provider: "claude" as const, home: "/w/team/.claude-data", tokenLogin: "a@example.com", tokenOrg: "org-1" };
const bare = { id: "bare", label: "Bare", provider: "claude" as const, home: "/w/bare/.claude-data" };
const codex = { id: "cdx", label: "Codex", provider: "codex" as const, home: "/Users/me/.codex-1" };

function registry(defaults?: Record<string, string>): Registry {
  return { version: 2, accounts: [keyed, bare, codex], agents: {}, hidden: [], ...(defaults ? { defaults } : {}) };
}

function deps(overrides: Partial<DefaultDeps> = {}): DefaultDeps {
  return {
    readMintedToken: async () => "sk-ant-oat01-x",
    checkToken: async () => "ok",
    directoryExists: async () => true,
    ...overrides,
  };
}

test("no default is unset, and nothing is read", async () => {
  let read = false;
  const answer = await checkDefault(registry(), "claude", deps({ readMintedToken: async () => ((read = true), null) }));
  assert.deepEqual(answer, { state: "unset" });
  assert.equal(read, false);
});

test("a usable default comes back with its token for the hook to inject", async () => {
  const answer = await checkDefault(registry({ claude: "team" }), "claude", deps());
  assert.equal(answer.state, "ok");
  assert.equal(answer.state === "ok" && answer.token, "sk-ant-oat01-x");
});

test("the Keychain is asked under the login and organisation", async () => {
  const asked: string[] = [];
  await checkDefault(registry({ claude: "team" }), "claude", deps({ readMintedToken: async (key) => (asked.push(key), "t") }));
  assert.deepEqual(asked, ["a@example.com/org-1"]);
});

test("each way a default breaks has its own problem", async () => {
  const problem = async (defaults: Record<string, string>, d: DefaultDeps, provider = "claude") => {
    const answer = await checkDefault(registry(defaults), provider, d);
    return answer.state === "broken" ? answer.problem : answer.state;
  };
  assert.equal(await problem({ claude: "gone" }, deps()), "unknown-account");
  assert.equal(await problem({ claude: "cdx" }, deps()), "unknown-account", "a Codex account cannot be Claude's default");
  assert.equal(await problem({ claude: "bare" }, deps()), "no-token");
  assert.equal(await problem({ claude: "team" }, deps({ readMintedToken: async () => null })), "no-token");
  assert.equal(await problem({ claude: "team" }, deps({ checkToken: async () => "rejected" })), "token-rejected");
  assert.equal(await problem({ claude: "team" }, deps({ checkToken: async () => "unknown" })), "ok");
  assert.equal(await problem({ codex: "cdx" }, deps({ directoryExists: async () => false }), "codex"), "missing-directory");
  assert.equal(await problem({ codex: "cdx" }, deps(), "codex"), "ok");
});

test("a broken default is named by its label, or its id once the account is gone", async () => {
  const noKey = await checkDefault(registry({ claude: "bare" }), "claude", deps());
  assert.equal(noKey.state === "broken" && noKey.label, "Bare");
  const gone = await checkDefault(registry({ claude: "gone" }), "claude", deps());
  assert.equal(gone.state === "broken" && gone.label, "gone");
});

test("the settings offer only Claude accounts with a switching key, by label", () => {
  const other = { ...keyed, id: "alpha", label: "Alpha", tokenLogin: "b@example.com" };
  const offered = defaultOptions({ ...registry(), accounts: [keyed, bare, codex, other] }, "claude");
  assert.deepEqual(offered.map((option) => option.id), ["alpha", "team"]);
  assert.equal(offered[1]!.login, "a@example.com");
  assert.deepEqual(defaultOptions(registry(), "codex").map((option) => option.id), ["cdx"]);
  assert.deepEqual(defaultOptions(registry(), "copilot"), []);
});

test("a good key is asked about once, a bad or unknown one every time", async () => {
  let asked = 0;
  let answer: "ok" | "rejected" | "unknown" = "ok";
  let clock = 0;
  const check = cachedTokenCheck(async () => (asked++, answer), 1000, () => clock);
  await check("t");
  await check("t");
  assert.equal(asked, 1);
  clock = 2000;
  answer = "rejected";
  assert.equal(await check("t"), "rejected");
  assert.equal(await check("t"), "rejected");
  assert.equal(asked, 3);
  answer = "unknown";
  await check("t");
  assert.equal(asked, 4);
});
