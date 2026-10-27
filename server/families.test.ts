import { test } from "node:test";
import assert from "node:assert/strict";
import { createFamilies } from "./families.ts";
import type { PaseoApi } from "./paseo.ts";

function fakePaseo(providers: () => unknown) {
  let reads = 0;
  const paseo = {
    config: {
      async get() {
        reads += 1;
        return { requestId: "r", config: { agents: { providers: providers() } } };
      },
    },
  } as unknown as PaseoApi;
  return { paseo, reads: () => reads };
}

const config = {
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
  let current: Record<string, unknown> = {};
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

test("an unreadable config reads as the last known profiles", async () => {
  let fail = false;
  const paseo = {
    config: {
      async get() {
        if (fail) throw new Error("down");
        return { requestId: "r", config: { agents: { providers: config } } };
      },
    },
  } as unknown as PaseoApi;
  const families = createFamilies(0, 0);
  await families.all(paseo);
  fail = true;
  assert.deepEqual(Object.keys(await families.all(paseo)), ["claude-work"]);
});
