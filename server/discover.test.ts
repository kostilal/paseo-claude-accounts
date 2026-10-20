import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loginKey } from "../shared/identity.ts";
import {
  allDirs,
  createDiscovery,
  defaultDir,
  displayName,
  identify,
  type IdentifyDeps,
  isClaudeNotFound,
  jobDirFor,
  listConfigDirs,
  readIdentity,
} from "./discover.ts";

async function tmpHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "paseo-accounts-"));
}

test("the default directory is named for what it is", () => {
  assert.equal(displayName("/Users/me/.claude"), "default");
});

test("a profile directory is named for its middle", () => {
  assert.equal(displayName("/Users/me/.claude-work-data"), "work");
  assert.equal(displayName("/Users/me/.claude-personal-data"), "personal");
});

test("a directory that does not follow the pattern keeps its own name", () => {
  assert.equal(displayName("/Users/me/.claude-scratch"), "scratch");
});

test("a per-job profile is named for the job folder that owns it", () => {
  assert.equal(displayName("/Users/me/Work/Projects/acme/.claude-data"), "acme");
  assert.equal(displayName("/Users/me/Work/Projects/site/.claude-data"), "site");
});

test("a per-job profile with no real parent segment falls back to default", () => {
  assert.equal(displayName("/.claude-data"), "default");
});

test("the default directory is built under the home given", () => {
  assert.equal(defaultDir("/Users/me"), "/Users/me/.claude");
});

test("readIdentity parses a logged-in body", () => {
  const raw = JSON.stringify({
    loggedIn: true,
    email: "alice@example.com",
    orgName: "Acme",
    subscriptionType: "team",
  });
  assert.deepEqual(readIdentity(raw), {
    loggedIn: true,
    email: "alice@example.com",
    orgName: "Acme",
    subscriptionType: "team",
  });
});

test("readIdentity parses a logged-out body", () => {
  const raw = JSON.stringify({ loggedIn: false, authMethod: "none" });
  assert.deepEqual(readIdentity(raw), {
    loggedIn: false,
    email: "",
    orgName: "",
    subscriptionType: "",
  });
});

test("readIdentity treats undefined as logged out", () => {
  assert.deepEqual(readIdentity(undefined), {
    loggedIn: false,
    email: "",
    orgName: "",
    subscriptionType: "",
  });
});

test("readIdentity treats an empty string as logged out", () => {
  assert.deepEqual(readIdentity(""), {
    loggedIn: false,
    email: "",
    orgName: "",
    subscriptionType: "",
  });
});

test("readIdentity treats unparseable text as logged out", () => {
  assert.deepEqual(readIdentity("not json at all"), {
    loggedIn: false,
    email: "",
    orgName: "",
    subscriptionType: "",
  });
});

// identify

/** An execFile-shaped rejection: `code` is "ENOENT" when the file is not there and the exit
 *  status when the process ran and failed, and `stdout` carries whatever it printed first. */
function execFailure(over: { code?: unknown; stdout?: string } = {}): Error {
  return Object.assign(new Error("Command failed"), { code: over.code, stdout: over.stdout });
}

function identifyDeps(over: Partial<IdentifyDeps> = {}): IdentifyDeps {
  return {
    exists: async () => false,
    run: async () => JSON.stringify({ loggedIn: true, email: "a@b.co", subscriptionType: "max" }),
    home: () => "/Users/me",
    ...over,
  };
}

test("claude is looked for at its known paths before PATH", async () => {
  const asked: string[] = [];
  await identify(
    "/h/work",
    100,
    identifyDeps({
      exists: async (path) => path === "/usr/local/bin/claude",
      run: async (file) => {
        asked.push(file);
        return JSON.stringify({ loggedIn: false });
      },
    }),
  );
  assert.deepEqual(asked, ["/usr/local/bin/claude"]);
});

test("with no known path present it still tries PATH, because usually PATH is fine", async () => {
  const asked: string[] = [];
  await identify(
    "/h/work",
    100,
    identifyDeps({
      run: async (file) => {
        asked.push(file);
        return JSON.stringify({ loggedIn: false });
      },
    }),
  );
  assert.deepEqual(asked, ["claude"]);
});

test("the non-zero exit this CLI uses for a logged-out directory is still an answer", async () => {
  const identity = await identify(
    "/h/work",
    100,
    identifyDeps({
      run: async () => {
        throw execFailure({ code: 1, stdout: JSON.stringify({ loggedIn: false, authMethod: "none" }) });
      },
    }),
  );
  assert.deepEqual(identity, { loggedIn: false, email: "", orgName: "", subscriptionType: "" });
});

test("a claude that is nowhere at all is its own case, not a log-out per directory", async () => {
  await assert.rejects(
    identify("/h/work", 100, identifyDeps({ run: async () => { throw execFailure({ code: "ENOENT" }); } })),
    (error: unknown) => isClaudeNotFound(error),
  );
});

test("a timeout and a permission error are rethrown rather than read as logged out", async () => {
  for (const failure of [execFailure({ code: null }), execFailure({ code: "EACCES" })]) {
    await assert.rejects(
      identify("/h/work", 100, identifyDeps({ run: async () => { throw failure; } })),
      (error: unknown) => error === failure && !isClaudeNotFound(error),
    );
  }
});

test("a .claude-data directly in the start dir is found", async () => {
  const home = await tmpHome();
  const job = join(home, "job");
  await mkdir(join(job, ".claude-data"), { recursive: true });
  assert.equal(await jobDirFor(job, home), join(job, ".claude-data"));
});

test("a .claude-data two levels up is found by walking up", async () => {
  const home = await tmpHome();
  const job = join(home, "job");
  await mkdir(join(job, ".claude-data"), { recursive: true });
  const start = join(job, "sub1", "sub2");
  await mkdir(start, { recursive: true });
  assert.equal(await jobDirFor(start, home), join(job, ".claude-data"));
});

test("no .claude-data anywhere up to home is null", async () => {
  const home = await tmpHome();
  const start = join(home, "job", "sub");
  await mkdir(start, { recursive: true });
  assert.equal(await jobDirFor(start, home), null);
});

test("a start path outside home does not walk at all", async () => {
  const home = await tmpHome();
  const elsewhere = await tmpHome();
  assert.equal(await jobDirFor(elsewhere, home), null);
});

test("a second look inside the TTL asks no subprocess at all", async () => {
  const home = await tmpHome();
  const asked: string[] = [];
  const discovery = createDiscovery(60_000, async (dir) => {
    asked.push(dir);
    return { loggedIn: true, email: "", orgName: "", subscriptionType: "" };
  });
  await discovery.discover([], false, home);
  await discovery.discover([], false, home);
  // One `claude auth status --json` per directory, not two.
  assert.deepEqual(asked, [defaultDir(home)]);
});

test("refresh pays for the subprocess again, because a person asked", async () => {
  const home = await tmpHome();
  const asked: string[] = [];
  const discovery = createDiscovery(60_000, async (dir) => {
    asked.push(dir);
    return { loggedIn: true, email: "", orgName: "", subscriptionType: "" };
  });
  await discovery.discover([], false, home);
  await discovery.discover([], true, home);
  assert.equal(asked.length, 2);
});

test("an expired entry is re-asked", async () => {
  const home = await tmpHome();
  let calls = 0;
  const discovery = createDiscovery(0, async () => {
    calls += 1;
    return { loggedIn: calls > 1, email: "", orgName: "", subscriptionType: "" };
  });
  assert.equal((await discovery.discover([], false, home))[0]?.loggedIn, false);
  assert.equal((await discovery.discover([], false, home))[0]?.loggedIn, true);
});

test("identify and discover share one cache, not two", async () => {
  const home = await tmpHome();
  let calls = 0;
  const discovery = createDiscovery(60_000, async () => {
    calls += 1;
    return { loggedIn: true, email: "alice@example.com", orgName: "", subscriptionType: "" };
  });
  await discovery.discover([], false, home);
  const identity = await discovery.identify(defaultDir(home));
  assert.equal(identity.email, "alice@example.com");
  assert.equal(calls, 1);
});

test("a discovered row carries the directory's name and its identity", async () => {
  const home = await tmpHome();
  const discovery = createDiscovery(60_000, async () => ({
    loggedIn: true,
    email: "alice@example.com",
    orgName: "Acme",
    subscriptionType: "team",
  }));
  const rows = await discovery.discover([], false, home);
  // Each family always offers its own default directory, even in an empty home.
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.home.slice(home.length + 1), row.provider, row.loggedIn]),
    [
      [".claude", "claude", true],
      // The codex prober was not stubbed here, so the real one ran and found no auth.json.
      [".codex", "codex", false],
    ],
  );
  assert.deepEqual(rows[0], {
    id: defaultDir(home),
    name: "default",
    home: defaultDir(home),
    provider: "claude",
    registered: true,
    key: loginKey({ email: "alice@example.com", orgName: "Acme" }, defaultDir(home)),
    loggedIn: true,
    email: "alice@example.com",
    orgName: "Acme",
    subscriptionType: "team",
    accountIds: [],
    switchTo: "",
    isDefault: false,
    autoNow: false,
    // Nothing is read from the Keychain until somebody asks.
    usage: "unauthorised",
    fiveHour: null,
    sevenDay: null,
    usageErrorCode: "",
    usageError: "",
  });
});

test("discovery lists both families, each row naming its own provider", async () => {
  const home = await tmpHome();
  await mkdir(join(home, ".claude"), { recursive: true });
  await mkdir(join(home, ".claude-work"), { recursive: true });
  await writeFile(join(home, ".claude-work", ".claude.json"), "{}");
  await mkdir(join(home, ".codex"), { recursive: true });
  await mkdir(join(home, ".codex-work"), { recursive: true });

  const entries = await allDirs([], home);
  assert.deepEqual(
    entries.map((entry) => [entry.home.slice(home.length + 1), entry.provider]),
    [
      [".claude", "claude"],
      [".claude-work", "claude"],
      [".codex", "codex"],
      [".codex-work", "codex"],
    ],
  );
});

test("a codex directory is identified from its file and never by running claude", async () => {
  let ranClaude = false;
  const discovery = createDiscovery(
    60_000,
    async () => {
      ranClaude = true;
      return { loggedIn: false, email: "", orgName: "", subscriptionType: "" };
    },
    async () => ({ loggedIn: true, email: "bob@example.com", orgName: "Personal", subscriptionType: "pro" }),
  );

  const answer = await discovery.identify("/Users/me/.codex-work");
  assert.equal(ranClaude, false);
  assert.equal(answer.email, "bob@example.com");
});

// listConfigDirs

/** A config directory as Claude Code leaves it: a folder holding `.claude.json`. */
async function profile(home: string, name: string): Promise<void> {
  await mkdir(join(home, name), { recursive: true });
  await writeFile(join(home, name, ".claude.json"), "{}");
}

test("~/.claude is always listed, even when it does not exist", async () => {
  const home = await tmpHome();
  assert.deepEqual(await listConfigDirs(home), [join(home, ".claude")]);
});

test("every naming scheme for a profile directory is found, sorted after the default", async () => {
  const home = await tmpHome();
  await profile(home, ".claude-work");
  await profile(home, ".claude_personal");
  await profile(home, ".claude.x");
  await profile(home, ".claude-work-data");
  assert.deepEqual(await listConfigDirs(home), [
    join(home, ".claude"),
    join(home, ".claude-work"),
    join(home, ".claude-work-data"),
    join(home, ".claude.x"),
    join(home, ".claude_personal"),
  ]);
});

test("a .claude* folder without .claude.json belongs to some other tool and is skipped", async () => {
  const home = await tmpHome();
  await mkdir(join(home, ".claude-migration"), { recursive: true });
  await writeFile(join(home, ".claude-migration", "notes.txt"), "");
  assert.deepEqual(await listConfigDirs(home), [join(home, ".claude")]);
});

test("a .claude.json that is a directory does not count", async () => {
  const home = await tmpHome();
  await mkdir(join(home, ".claude-odd", ".claude.json"), { recursive: true });
  assert.deepEqual(await listConfigDirs(home), [join(home, ".claude")]);
});

test("files in home are never profiles, including ~/.claude.json itself", async () => {
  const home = await tmpHome();
  await writeFile(join(home, ".claude.json"), "{}");
  await writeFile(join(home, ".claude-notes"), "");
  assert.deepEqual(await listConfigDirs(home), [join(home, ".claude")]);
});

test("names that only start like a profile are not profiles", async () => {
  const home = await tmpHome();
  await profile(home, ".claudex");
  await profile(home, ".claude-");
  assert.deepEqual(await listConfigDirs(home), [join(home, ".claude")]);
});

test("an unreadable home still lists the default directory", async () => {
  const home = join(await tmpHome(), "missing");
  assert.deepEqual(await listConfigDirs(home), [join(home, ".claude")]);
});
