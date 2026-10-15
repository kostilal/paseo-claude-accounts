import { test } from "node:test";
import assert from "node:assert/strict";
import type { Registry } from "../shared/registry.ts";
import { type SwitchDeps, switchAccount } from "./switchAccount.ts";

/** `work` has no minted token; `home`, which most tests target, has one. */
const work = { id: "work", label: "Work", provider: "claude" as const, home: "/w/acme/.claude-data" };
const home = {
  id: "home",
  label: "Home",
  provider: "claude" as const,
  home: "/Users/me/.claude",
  tokenLogin: "alice@example.com",
};

function registry(overrides: Partial<Registry> = {}): Registry {
  return { version: 2, accounts: [work, home], agents: {}, ...overrides };
}

function deps(log: string[], overrides: Partial<SwitchDeps> = {}): SwitchDeps {
  let stored = registry();
  return {
    readRegistry: async () => stored,
    writeRegistry: async (value) => {
      log.push("write");
      stored = value;
    },
    exists: async () => true,
    identify: async () => ({ loggedIn: true, email: "", orgName: "", subscriptionType: "" }),
    readMintedToken: async () => "sk-ant-oat01-example",
    reload: async () => {
      log.push("reload");
      return { code: "" as const, error: "" };
    },
    ...overrides,
  };
}

const input = { agentId: "ag1", accountId: "home" };

test("this one agent is what gets bound, and nothing else", async () => {
  let written: Registry | null | undefined;
  const result = await switchAccount(
    input,
    deps([], { writeRegistry: async (value) => void (written = value) }),
  );
  assert.equal(result.code, "");
  assert.equal(written?.agents.ag1, "home");
  assert.deepEqual(Object.keys(written?.agents ?? {}), ["ag1"]);
});

test("an account that does not exist is refused before anything is touched", async () => {
  const log: string[] = [];
  const result = await switchAccount({ ...input, accountId: "nope" }, deps(log));
  assert.equal(result.code, "unknown-account");
  assert.deepEqual(log, []);
});

test("a provider the table does not carry is refused rather than half-applied", async () => {
  // Only reachable through a hand-edited registry; must still be a refusal, not a TypeError.
  const alien = { id: "cur", label: "Cursor", provider: "cursor" as unknown as "claude", home: "/w/.cursor" };
  const log: string[] = [];
  const result = await switchAccount(
    { ...input, accountId: "cur" },
    deps(log, { readRegistry: async () => registry({ accounts: [work, alien] }) }),
  );
  assert.equal(result.code, "unsupported-provider");
  assert.deepEqual(log, []);
});

test("a codex account switches on its directory alone, with no token asked for", async () => {
  const codex = { id: "cdx", label: "Codex", provider: "codex" as const, home: "/w/.codex-work" };
  const log: string[] = [];
  let askedForToken = false;
  const result = await switchAccount(
    { ...input, accountId: "cdx" },
    deps(log, {
      readRegistry: async () => registry({ accounts: [work, codex] }),
      readMintedToken: async () => {
        askedForToken = true;
        return null;
      },
      identify: async () => ({ loggedIn: true, email: "p@example.com", orgName: "Personal", subscriptionType: "pro" }),
    }),
  );
  assert.equal(result.code, "");
  assert.equal(askedForToken, false);
  // Binding written first, then the session reloaded.
  assert.deepEqual(log, ["write", "reload"]);
});

test("a codex directory nobody is logged into is refused before anything is touched", async () => {
  const codex = { id: "cdx", label: "Codex", provider: "codex" as const, home: "/w/.codex-work" };
  const log: string[] = [];
  const result = await switchAccount(
    { ...input, accountId: "cdx" },
    deps(log, {
      readRegistry: async () => registry({ accounts: [work, codex] }),
      identify: async () => ({ loggedIn: false, email: "", orgName: "", subscriptionType: "" }),
    }),
  );
  assert.equal(result.code, "not-logged-in");
  assert.deepEqual(log, []);
});

test("a directory that is gone is refused before anything is touched", async () => {
  const log: string[] = [];
  const result = await switchAccount(input, deps(log, { exists: async () => false }));
  assert.equal(result.code, "missing-directory");
  assert.deepEqual(log, []);
});

test("an account with no token login recorded is refused before anything is touched", async () => {
  // Without a token the reload would bring the chat back on the account it was already on.
  const log: string[] = [];
  const result = await switchAccount({ ...input, accountId: "work" }, deps(log));
  assert.equal(result.code, "no-token");
  assert.deepEqual(log, [], "no binding written and no session restarted");
});

test("an account whose token was never minted is refused before anything is touched", async () => {
  const log: string[] = [];
  const result = await switchAccount(input, deps(log, { readMintedToken: async () => null }));
  assert.equal(result.code, "no-token");
  assert.deepEqual(log, [], "no binding written and no session restarted");
});

test("the token is looked up under the account's tokenLogin, not the directory's own", async () => {
  // The token may belong to a different login than the one the directory is signed in as.
  const asked: string[] = [];
  const result = await switchAccount(
    input,
    deps([], {
      readMintedToken: async (login) => {
        asked.push(login);
        return "sk-ant-oat01-example";
      },
    }),
  );
  assert.equal(result.code, "");
  assert.deepEqual(asked, ["alice@example.com"]);
});

test("an account with an organisation is looked up under its login and organisation", async () => {
  const asked: string[] = [];
  const result = await switchAccount(
    input,
    deps([], {
      readRegistry: async () => registry({ accounts: [work, { ...home, tokenOrg: "org-team" }] }),
      readMintedToken: async (key) => {
        asked.push(key);
        return "sk-ant-oat01-example";
      },
    }),
  );
  assert.equal(result.code, "");
  assert.deepEqual(asked, ["alice@example.com/org-team"]);
});

test("a Keychain read that will not answer aborts with nothing written", async () => {
  // A KeychainTimeout happens before the first write, so nothing has changed.
  const log: string[] = [];
  await assert.rejects(
    switchAccount(
      input,
      deps(log, {
        readMintedToken: async () => {
          throw new Error("a Keychain dialog is waiting");
        },
      }),
    ),
    /Keychain/,
  );
  assert.deepEqual(log, []);
});

test("a refused switch says nothing about the token it did or did not find", async () => {
  // The result is shown in the client, so it must never carry the token.
  const result = await switchAccount(input, deps([], { readMintedToken: async () => "sk-ant-oat01-secret" }));
  assert.equal(JSON.stringify(result).includes("sk-ant-oat01-secret"), false);
});

test("a switch to the account already bound still restarts the session", async () => {
  // The binding may be written while the session is still on the old account.
  const log: string[] = [];
  const result = await switchAccount(
    input,
    deps(log, { readRegistry: async () => registry({ agents: { ag1: "home" } }) }),
  );
  assert.equal(result.code, "");
  assert.deepEqual(log, ["write", "reload"]);
});

test("a failed reload puts the binding back, so the next attempt is not refused", async () => {
  const log: string[] = [];
  const written: Array<Record<string, string>> = [];
  const result = await switchAccount(
    input,
    deps(log, {
      writeRegistry: async (value) => {
        log.push("write");
        written.push(value.agents);
      },
      reload: async () => {
        log.push("reload");
        return { code: "reload-failed" as const, error: "boom" };
      },
    }),
  );
  assert.equal(result.code, "reload-failed");
  assert.deepEqual(log, ["write", "reload", "write"]);
  assert.equal(written[0]?.ag1, "home", "the switch wrote the target");
  assert.deepEqual(written[1], {}, "the rollback restored what was there before");
});

test("a reload that failed keeps its code and its message", async () => {
  const result = await switchAccount(
    input,
    deps([], { reload: async () => ({ code: "reload-failed" as const, error: "boom" }) }),
  );
  assert.equal(result.code, "reload-failed");
  assert.equal(result.error, "boom");
});
