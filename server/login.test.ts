import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PaseoApi, PaseoTerminalCreateOptions } from "@getpaseo/client";
import { SHELL_CONFIG_DIR } from "./claude.ts";
import { CLAUDE_LOGIN_SCRIPT, CODEX_LOGIN_SCRIPT, openLogin } from "./login.ts";

interface WorkspaceStub {
  id: string;
  archivingAt: string | null;
}

/** Only the two `PaseoApi` surfaces `openTerminal` touches. */
function fakePaseo(options: {
  entries?: WorkspaceStub[];
  create?: (options: PaseoTerminalCreateOptions) => Promise<{ id: string }>;
} = {}): PaseoApi {
  const entries = options.entries ?? [{ id: "wks_live", archivingAt: null }];
  const create = options.create ?? (async () => ({ id: "term_1" }));
  return {
    workspaces: {
      list: async () => ({
        requestId: "r1",
        entries,
        pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
      }),
    },
    terminals: { create },
  } as unknown as PaseoApi;
}

/** A fake that records every terminal it is asked to create. */
function recording(id = "term_1") {
  const seen: PaseoTerminalCreateOptions[] = [];
  const paseo = fakePaseo({
    create: async (opts) => {
      seen.push(opts);
      return { id };
    },
  });
  return { paseo, seen };
}

const claude = async () => "/opt/bin/claude";

test("a live workspace hosts the terminal, an archiving one is skipped", async () => {
  const seen: PaseoTerminalCreateOptions[] = [];
  const paseo = fakePaseo({
    entries: [
      { id: "wks_archiving", archivingAt: "2020-01-01T00:00:00Z" },
      { id: "wks_live", archivingAt: null },
    ],
    create: async (opts) => {
      seen.push(opts);
      return { id: "term_42" };
    },
  });
  const result = await openLogin(paseo, "claude", "/Users/me/.claude-work", "work", claude);
  assert.deepEqual(result, { terminal: "term_42", code: "", error: "" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.workspaceId, "wks_live");
});

test("the claude script sets or unsets the config directory, then runs $2", () => {
  assert.equal(CLAUDE_LOGIN_SCRIPT, `${SHELL_CONFIG_DIR}; exec "$2" auth login`);
});

test("a claude login passes the directory as $1 and the claude path as $2", async () => {
  const { paseo, seen } = recording();
  await openLogin(paseo, "claude", "/Users/me/Work/a job/.claude-data", "a job", claude);
  assert.equal(seen[0]!.command, "/bin/zsh");
  assert.deepEqual(seen[0]!.args, [
    "-lc",
    CLAUDE_LOGIN_SCRIPT,
    "claude-accounts",
    "/Users/me/Work/a job/.claude-data",
    "/opt/bin/claude",
  ]);
  // The path is never spliced into the script text.
  assert.equal(seen[0]!.args![1]!.includes("a job"), false);
});

test("a claude login for ~/.claude passes an empty directory, so the variable is unset", async () => {
  const { paseo, seen } = recording();
  await openLogin(paseo, "claude", join(homedir(), ".claude"), "default", claude);
  assert.equal(seen[0]!.args![3], "");
  assert.equal(seen[0]!.args![4], "/opt/bin/claude");
});

test("a trailing slash on ~/.claude still names the default directory", async () => {
  const { paseo, seen } = recording();
  await openLogin(paseo, "claude", `${join(homedir(), ".claude")}/`, "default", claude);
  assert.equal(seen[0]!.args![3], "");
});

test("the terminal name identifies the account", async () => {
  const { paseo, seen } = recording();
  await openLogin(paseo, "claude", "/Users/me/.claude-work", "work", claude);
  assert.equal(seen[0]!.name, "claude auth login — work");
});

test("no live workspace reports a case the client can translate, instead of throwing", async () => {
  const paseo = fakePaseo({ entries: [{ id: "wks_gone", archivingAt: "2020-01-01T00:00:00Z" }] });
  const result = await openLogin(paseo, "claude", "/Users/me/.claude-work", "work", claude);
  assert.deepEqual(result, { terminal: "", code: "no-workspace", error: "" });
});

test("no workspaces at all is the same normal answer, not a rejected promise", async () => {
  const result = await openLogin(fakePaseo({ entries: [] }), "claude", "/Users/me/.claude-work", "work", claude);
  assert.equal(result.code, "no-workspace");
});

test("the codex script makes the directory first and runs codex login inside it", () => {
  assert.equal(CODEX_LOGIN_SCRIPT, 'mkdir -p "$1" && CODEX_HOME="$1" exec codex login');
});

test("a codex login passes the path positionally and never looks for claude", async () => {
  const { paseo, seen } = recording("term_7");
  let looked = false;
  const result = await openLogin(paseo, "codex", "/w/my codex", "work", async () => {
    looked = true;
    return "/opt/bin/claude";
  });
  assert.equal(result.code, "");
  assert.equal(looked, false);
  assert.deepEqual(seen[0]?.args, ["-lc", CODEX_LOGIN_SCRIPT, "claude-accounts", "/w/my codex"]);
  assert.equal(seen[0]?.name, "codex login — work");
});
