import { test } from "node:test";
import assert from "node:assert/strict";
import type { Registry } from "../shared/registry.ts";
import { type DefaultDeps, checkDefault, defaultOptions } from "./defaults.ts";

const team = { id: "team", label: "Team", provider: "claude" as const, home: "/w/team/.claude-data" };
const bare = { id: "bare", label: "Bare", provider: "claude" as const, home: "/w/bare/.claude-data" };
const codex = { id: "cdx", label: "Codex", provider: "codex" as const, home: "/Users/me/.codex-1" };

function registry(defaults?: Record<string, string>): Registry {
  return { version: 2, accounts: [team, bare, codex], agents: {}, hidden: [], ...(defaults ? { defaults } : {}) };
}

function deps(overrides: Partial<DefaultDeps> = {}): DefaultDeps {
  return { directoryExists: async () => true, ...overrides };
}

test("no default is unset, and nothing is read", async () => {
  let read = false;
  const answer = await checkDefault(registry(), "claude", deps({ directoryExists: async () => ((read = true), true) }));
  assert.deepEqual(answer, { state: "unset" });
  assert.equal(read, false);
});

test("a usable default comes back with its account for the hook to point at", async () => {
  const answer = await checkDefault(registry({ claude: "team" }), "claude", deps());
  assert.equal(answer.state, "ok");
  assert.equal(answer.state === "ok" && answer.account.id, "team");
});

test("each way a default breaks has its own problem", async () => {
  const problem = async (defaults: Record<string, string>, d: DefaultDeps, provider = "claude") => {
    const answer = await checkDefault(registry(defaults), provider, d);
    return answer.state === "broken" ? answer.problem : answer.state;
  };
  assert.equal(await problem({ claude: "gone" }, deps()), "unknown-account");
  assert.equal(await problem({ claude: "cdx" }, deps()), "unknown-account", "a Codex account cannot be Claude's default");
  assert.equal(await problem({ claude: "team" }, deps({ directoryExists: async () => false })), "missing-directory");
  assert.equal(await problem({ claude: "team" }, deps()), "ok");
  assert.equal(await problem({ codex: "cdx" }, deps({ directoryExists: async () => false }), "codex"), "missing-directory");
  assert.equal(await problem({ codex: "cdx" }, deps(), "codex"), "ok");
});

test("a broken default is named by its label, or its id once the account is gone", async () => {
  const missing = await checkDefault(registry({ claude: "team" }), "claude", deps({ directoryExists: async () => false }));
  assert.equal(missing.state === "broken" && missing.label, "Team");
  const gone = await checkDefault(registry({ claude: "gone" }), "claude", deps());
  assert.equal(gone.state === "broken" && gone.label, "gone");
});

test("the settings offer every account of the provider, by label", () => {
  const offered = defaultOptions(registry(), "claude");
  assert.deepEqual(offered.map((option) => option.id), ["bare", "team"]);
  assert.deepEqual(defaultOptions(registry(), "codex").map((option) => option.id), ["cdx"]);
  assert.deepEqual(defaultOptions(registry(), "copilot"), []);
});

test("an automatic default is its own state, with nothing read", async () => {
  let read = false;
  const answer = await checkDefault(registry({ claude: "@auto" }), "claude", deps({ directoryExists: async () => ((read = true), true) }));
  assert.deepEqual(answer, { state: "auto" });
  assert.equal(read, false);
});
