import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identifyCodex, listCodexDirs } from "./discoverCodex.ts";

async function fakeHome(names: string[]): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "codex-discover-"));
  for (const name of names) await mkdir(join(home, name), { recursive: true });
  return home;
}

test("the default directory comes first and the profiles follow it sorted", async () => {
  const home = await fakeHome([".codex", ".codex-work", ".codex-alpha", ".claude-work", "Documents"]);
  assert.deepEqual(await listCodexDirs(home), [
    join(home, ".codex"),
    join(home, ".codex-alpha"),
    join(home, ".codex-work"),
  ]);
});

test("the default directory is listed even when it does not exist yet", async () => {
  // As for Claude, the default is always offered so there is a row to log in through.
  const home = await fakeHome([]);
  assert.deepEqual(await listCodexDirs(home), [join(home, ".codex")]);
});

test("a file called .codex-something is not a directory and is not listed", async () => {
  const home = await fakeHome([]);
  await writeFile(join(home, ".codex-notadir"), "x", "utf8");
  assert.deepEqual(await listCodexDirs(home), [join(home, ".codex")]);
});

test("a directory with no auth.json reads as logged out", async () => {
  const answer = await identifyCodex("/nowhere", {
    read: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  });
  assert.deepEqual(answer, { loggedIn: false, email: "", orgName: "", subscriptionType: "" });
});

test("a directory with an auth.json is identified from it", async () => {
  const claims = Buffer.from(
    JSON.stringify({
      email: "person@example.com",
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "pro",
        organizations: [{ is_default: true, title: "Personal" }],
      },
    }),
  ).toString("base64url");
  let asked = "";
  const answer = await identifyCodex("/w/.codex", {
    read: async (path) => {
      asked = path;
      return JSON.stringify({ tokens: { id_token: `h.${claims}.s` } });
    },
  });
  assert.equal(asked, "/w/.codex/auth.json");
  assert.deepEqual(answer, {
    loggedIn: true,
    email: "person@example.com",
    orgName: "Personal",
    subscriptionType: "pro",
  });
});
