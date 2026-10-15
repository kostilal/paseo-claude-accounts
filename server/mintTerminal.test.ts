import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { PaseoApi, PaseoTerminalCreateOptions } from "@getpaseo/client";
import { SHELL_CONFIG_DIR } from "./claude.ts";
import type { FinishResult } from "./mint.ts";
import { MINT_SCRIPT, createMints } from "./mintTerminal.ts";

/** Only the two `PaseoApi` surfaces `openTerminal` touches. */
function fakePaseo(options: { live?: boolean; create?: () => Promise<{ id: string }> } = {}) {
  const seen: PaseoTerminalCreateOptions[] = [];
  const paseo = {
    workspaces: {
      list: async () => ({
        requestId: "r1",
        entries: options.live === false ? [] : [{ id: "wks_live", archivingAt: null }],
        pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
      }),
    },
    terminals: {
      create: async (opts: PaseoTerminalCreateOptions) => {
        seen.push(opts);
        return options.create ? options.create() : { id: "term_1" };
      },
    },
  } as unknown as PaseoApi;
  return { paseo, seen };
}

async function scratch(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "mints-")), "mints");
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function mints(dir: string, finish: (home: string, transcript: string) => Promise<FinishResult>) {
  const lines: string[] = [];
  const calls: Array<[string, string]> = [];
  const value = createMints({
    dir,
    finish: async (home, transcript) => {
      calls.push([home, transcript]);
      return finish(home, transcript);
    },
    log: (line) => lines.push(line),
  });
  return { ...value, lines, calls };
}

/** Writes a pending mint by hand, as `open` and the terminal script would leave it. */
async function pending(dir: string, id: string, meta: object, files: { transcript?: string; done?: boolean } = {}) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.json`), JSON.stringify(meta));
  if (files.transcript !== undefined) await writeFile(join(dir, `${id}.transcript`), files.transcript);
  if (files.done) await writeFile(join(dir, `${id}.done`), "");
}

const ok = async (): Promise<FinishResult> => ({ ok: true, login: "alice@example.com" });

test("the mint script runs setup-token under script, with the config directory rule first", () => {
  assert.ok(MINT_SCRIPT.includes(SHELL_CONFIG_DIR));
  assert.match(MINT_SCRIPT, /umask 077/);
  assert.match(MINT_SCRIPT, /script -q "\$transcript" "\$claude" setup-token/);
  assert.match(MINT_SCRIPT, /: > "\$done"/);
});

test("open writes the meta file and opens a terminal with every path as an argument", async () => {
  const dir = await scratch();
  const subject = mints(dir, ok);
  const { paseo, seen } = fakePaseo();
  const before = Date.now();
  const result = await subject.open(paseo, "/Users/me/.claude-work", "work", "/opt/bin/claude");
  subject.stop();

  assert.deepEqual(result, { terminal: "term_1", code: "", error: "" });
  const names = await readdir(dir);
  assert.equal(names.length, 1);
  const id = names[0]!.replace(/\.json$/, "");
  const meta = JSON.parse(await readFile(join(dir, names[0]!), "utf8"));
  assert.equal(meta.home, "/Users/me/.claude-work");
  assert.ok(meta.at >= before && meta.at <= Date.now());
  assert.equal((await stat(join(dir, names[0]!))).mode & 0o777, 0o600);

  assert.equal(seen[0]!.command, "/bin/zsh");
  assert.equal(seen[0]!.name, "claude setup-token — work");
  assert.deepEqual(seen[0]!.args, [
    "-lc",
    MINT_SCRIPT,
    "claude-accounts",
    "/Users/me/.claude-work",
    "/opt/bin/claude",
    join(dir, `${id}.transcript`),
    join(dir, `${id}.done`),
    join(dir, `${id}.result`),
    "work",
  ]);
});

test("open passes an empty directory argument for ~/.claude", async () => {
  const dir = await scratch();
  const subject = mints(dir, ok);
  const { paseo, seen } = fakePaseo();
  await subject.open(paseo, join(homedir(), ".claude"), "default", "claude");
  subject.stop();
  assert.equal(seen[0]!.args![3], "");
});

test("open with no live workspace leaves no meta file behind", async () => {
  const dir = await scratch();
  const subject = mints(dir, ok);
  const result = await subject.open(fakePaseo({ live: false }).paseo, "/Users/me/.claude-work", "work", "claude");
  assert.equal(result.code, "no-workspace");
  assert.deepEqual(await readdir(dir), []);
});

test("open that fails to create a terminal removes its meta file and rethrows", async () => {
  const dir = await scratch();
  const subject = mints(dir, ok);
  const { paseo } = fakePaseo({
    create: async () => {
      throw new Error("daemon busy");
    },
  });
  await assert.rejects(subject.open(paseo, "/Users/me/.claude-work", "work", "claude"), /daemon busy/);
  assert.deepEqual(await readdir(dir), []);
});

test("adopt with no mint directory at all is a quiet no-op", async () => {
  const subject = mints(await scratch(), ok);
  assert.equal(await subject.adopt(), false);
  assert.deepEqual(subject.calls, []);
});

test("adopt leaves a mint whose terminal has not finished alone", async () => {
  const dir = await scratch();
  await pending(dir, "m1", { home: "/Users/me/.claude-work", at: Date.now() }, { transcript: "partial" });
  const subject = mints(dir, ok);
  assert.equal(await subject.adopt(), false);
  assert.deepEqual(subject.calls, []);
  assert.deepEqual((await readdir(dir)).sort(), ["m1.json", "m1.transcript"]);
});

test("adopt finishes a done mint, writes the result and cleans up", async () => {
  const dir = await scratch();
  await pending(dir, "m1", { home: "/Users/me/.claude-work", at: Date.now() }, { transcript: "the transcript", done: true });
  const subject = mints(dir, ok);
  assert.equal(await subject.adopt(), true);
  assert.deepEqual(subject.calls, [["/Users/me/.claude-work", "the transcript"]]);
  assert.deepEqual(await readdir(dir), ["m1.result"]);
  assert.match(await readFile(join(dir, "m1.result"), "utf8"), /^== Done\. .*alice@example\.com/);
  assert.equal((await stat(join(dir, "m1.result"))).mode & 0o777, 0o600);
  assert.match(subject.lines.join("\n"), /token saved for alice@example\.com/);
});

test("a mint that found no token reports it and saves nothing", async () => {
  const dir = await scratch();
  await pending(dir, "m1", { home: "/Users/me/.claude-work", at: Date.now() }, { transcript: "x", done: true });
  const subject = mints(dir, async () => ({ ok: false, reason: "no-token" }));
  assert.equal(await subject.adopt(), false);
  assert.match(await readFile(join(dir, "m1.result"), "utf8"), /No working key/);
  assert.equal(await exists(join(dir, "m1.json")), false);
});

test("a mint whose login could not be told reports that", async () => {
  const dir = await scratch();
  await pending(dir, "m1", { home: "/Users/me/.claude-work", at: Date.now() }, { transcript: "x", done: true });
  const subject = mints(dir, async () => ({ ok: false, reason: "no-login" }));
  await subject.adopt();
  assert.match(await readFile(join(dir, "m1.result"), "utf8"), /which account/);
});

test("a finish that throws is reported as a Keychain failure and logged", async () => {
  const dir = await scratch();
  await pending(dir, "m1", { home: "/Users/me/.claude-work", at: Date.now() }, { transcript: "x", done: true });
  const subject = mints(dir, async () => {
    throw new Error("could not write the token for alice@example.com to the Keychain");
  });
  assert.equal(await subject.adopt(), false);
  assert.match(await readFile(join(dir, "m1.result"), "utf8"), /Keychain/);
  assert.match(subject.lines.join("\n"), /mint failed/);
  assert.deepEqual(await readdir(dir), ["m1.result"]);
});

test("a done mint without a transcript is finished with an empty one", async () => {
  const dir = await scratch();
  await pending(dir, "m1", { home: "/Users/me/.claude-work", at: Date.now() }, { done: true });
  const subject = mints(dir, async () => ({ ok: false, reason: "no-token" }));
  await subject.adopt();
  assert.deepEqual(subject.calls, [["/Users/me/.claude-work", ""]]);
});

test("a meta file without a home is not passed to finish", async () => {
  const dir = await scratch();
  await pending(dir, "m1", { at: Date.now() }, { transcript: "x", done: true });
  const subject = mints(dir, ok);
  assert.equal(await subject.adopt(), false);
  assert.deepEqual(subject.calls, []);
  assert.match(await readFile(join(dir, "m1.result"), "utf8"), /No working key/);
});

test("an unreadable meta file is removed", async () => {
  const dir = await scratch();
  await pending(dir, "m1", {});
  await writeFile(join(dir, "m1.json"), "{ not json");
  const subject = mints(dir, ok);
  assert.equal(await subject.adopt(), false);
  assert.equal(await exists(join(dir, "m1.json")), false);
});

test("a mint abandoned for over half an hour is cleaned up, a recent one is kept", async () => {
  const dir = await scratch();
  await pending(dir, "old", { home: "/Users/me/.claude-work", at: Date.now() - 31 * 60_000 }, { transcript: "secret" });
  await pending(dir, "new", { home: "/Users/me/.claude-work", at: Date.now() - 29 * 60_000 }, { transcript: "partial" });
  const subject = mints(dir, ok);
  await subject.adopt();
  assert.deepEqual((await readdir(dir)).sort(), ["new.json", "new.transcript"]);
  assert.deepEqual(subject.calls, []);
});

test("concurrent adopt calls finish a mint once", async () => {
  const dir = await scratch();
  await pending(dir, "m1", { home: "/Users/me/.claude-work", at: Date.now() }, { transcript: "x", done: true });
  const subject = mints(dir, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { ok: true, login: "alice@example.com" };
  });
  const results = await Promise.all([subject.adopt(), subject.adopt(), subject.adopt()]);
  assert.deepEqual(results, [true, true, true]);
  assert.equal(subject.calls.length, 1);
  // A later pass finds nothing left to do.
  assert.equal(await subject.adopt(), false);
  assert.equal(subject.calls.length, 1);
});

test("several done mints are all finished in one pass", async () => {
  const dir = await scratch();
  await pending(dir, "a", { home: "/Users/me/.claude-work", at: Date.now() }, { transcript: "1", done: true });
  await pending(dir, "b", { home: "/Users/me/.claude-personal", at: Date.now() }, { transcript: "2", done: true });
  const subject = mints(dir, ok);
  assert.equal(await subject.adopt(), true);
  assert.deepEqual(subject.calls.map(([home]) => home).sort(), ["/Users/me/.claude-personal", "/Users/me/.claude-work"]);
  assert.deepEqual((await readdir(dir)).sort(), ["a.result", "b.result"]);
});
