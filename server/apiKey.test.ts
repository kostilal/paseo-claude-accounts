import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiKeyCheck, overridingVar } from "./apiKey.ts";
import type { PaseoApi } from "./paseo.ts";

function paseoWithEnv(env: unknown, calls: { n: number } = { n: 0 }): PaseoApi {
  return {
    config: {
      get: async () => {
        calls.n += 1;
        return { requestId: "r", config: { agents: { providers: { claude: { env } } } } };
      },
    },
  } as unknown as PaseoApi;
}

test("nothing set means no override", () => {
  assert.equal(overridingVar({ PATH: "/bin" }, undefined), "");
});

test("an empty value does not count", () => {
  assert.equal(overridingVar({ ANTHROPIC_API_KEY: "" }), "");
});

test("the first overriding variable is named, from any environment", () => {
  assert.equal(overridingVar({}, { ANTHROPIC_AUTH_TOKEN: "x" }), "ANTHROPIC_AUTH_TOKEN");
  assert.equal(overridingVar({ CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_API_KEY: "k" }), "ANTHROPIC_API_KEY");
});

test("the check reads the daemon env and the provider's configured env", async () => {
  assert.equal(await createApiKeyCheck(0, { ANTHROPIC_API_KEY: "k" })(paseoWithEnv(undefined)), "ANTHROPIC_API_KEY");
  assert.equal(await createApiKeyCheck(0, {})(paseoWithEnv({ CLAUDE_CODE_USE_VERTEX: "1" })), "CLAUDE_CODE_USE_VERTEX");
  assert.equal(await createApiKeyCheck(0, {})(paseoWithEnv({ OTHER: "1" })), "");
});

test("a failing config read falls back to the daemon env", async () => {
  const broken = { config: { get: async () => Promise.reject(new Error("no")) } } as unknown as PaseoApi;
  assert.equal(await createApiKeyCheck(0, {})(broken), "");
});

test("the answer is cached", async () => {
  const calls = { n: 0 };
  const check = createApiKeyCheck(60_000, {});
  const paseo = paseoWithEnv(undefined, calls);
  await check(paseo);
  await check(paseo);
  assert.equal(calls.n, 1);
});
