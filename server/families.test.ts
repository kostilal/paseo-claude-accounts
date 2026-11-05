import { test } from "node:test";
import assert from "node:assert/strict";
import { createFamilies } from "./families.ts";
import type { PaseoApi } from "./paseo.ts";

/** What `paseo.config.get()` answers, so a fake of another shape does not compile. */
type DaemonProviders = Awaited<ReturnType<PaseoApi["config"]["get"]>>["config"]["providers"];

function fakePaseo(providers: () => DaemonProviders) {
  let reads = 0;
  const paseo = {
    config: {
      async get() {
        reads += 1;
        return { requestId: "r", config: { providers: providers() } };
      },
    },
  } as unknown as PaseoApi;
  return { paseo, reads: () => reads };
}

const config: DaemonProviders = {
  "claude-work": { extends: "claude", env: { CLAUDE_CONFIG_DIR: "/Users/me/.claude-work" } },
  "codex-work": { extends: "codex", env: { CODEX_HOME: "/Users/me/.codex-work" } },
};

test("only Claude's profiles are kept: a codex profile is left to Paseo", async () => {
  const { paseo } = fakePaseo(() => config);
  const families = createFamilies();
  assert.deepEqual(await families.all(paseo), { "claude-work": { family: "claude", configDir: "/Users/me/.claude-work" } });
  assert.equal(await families.of(paseo, "codex-work"), null);
  assert.deepEqual(await families.of(paseo, "codex"), { family: "codex", configDir: null });
});

test("an unknown provider re-reads the config, but not more often than the miss interval", async () => {
  let current: DaemonProviders = {};
  const { paseo, reads } = fakePaseo(() => current);
  const families = createFamilies(60_000, 0);
  assert.equal(await families.of(paseo, "claude-new"), null);
  current = { "claude-new": { extends: "claude" } };
  assert.deepEqual(await families.of(paseo, "claude-new"), { family: "claude", configDir: null });

  const bounded = createFamilies(60_000, 60_000);
  const before = reads();
  await bounded.of(paseo, "opencode");
  await bounded.of(paseo, "opencode");
  assert.equal(reads() - before, 1);
});

test("a chat counts as the provider its profile extends, and otherwise as its own", async () => {
  const { paseo } = fakePaseo(() => config);
  const families = createFamilies();
  assert.equal(await families.name(paseo, "claude-work"), "claude");
  assert.equal(await families.name(paseo, "claude"), "claude");
  assert.equal(await families.name(paseo, "codex"), "codex");
  // Claude's profiles only, as everywhere: a Codex profile stays what Paseo calls it.
  assert.equal(await families.name(paseo, "codex-work"), "codex-work");
  assert.equal(await families.name(paseo, "opencode"), "opencode");
});

test("a config read that never answers does not hold a session open: it reads as no profile", { timeout: 5_000 }, async () => {
  const paseo = { config: { get: () => new Promise(() => {}) } } as unknown as PaseoApi;
  const families = createFamilies(60_000, 5_000, 5);
  assert.equal(await families.of(paseo, "my-acp"), null);
  assert.equal(await families.name(paseo, "claude-work"), "claude-work");
  assert.deepEqual(await families.all(paseo, true), {});
});

test("read rejects on an unreadable config, so a caller can ask again; all keeps what it knew", async () => {
  let fail = false;
  const paseo = {
    config: {
      async get() {
        if (fail) throw new Error("down");
        return { requestId: "r", config: { providers: config } };
      },
    },
  } as unknown as PaseoApi;
  const families = createFamilies();
  assert.deepEqual(Object.keys(await families.read(paseo)), ["claude-work"]);
  fail = true;
  await assert.rejects(families.read(paseo));
  assert.deepEqual(Object.keys(await families.all(paseo, true)), ["claude-work"]);
});

test("an unreadable config reads as the last known profiles", async () => {
  let fail = false;
  const paseo = {
    config: {
      async get() {
        if (fail) throw new Error("down");
        return { requestId: "r", config: { providers: config } };
      },
    },
  } as unknown as PaseoApi;
  const families = createFamilies(0, 0);
  await families.all(paseo);
  fail = true;
  assert.deepEqual(Object.keys(await families.all(paseo)), ["claude-work"]);
});
