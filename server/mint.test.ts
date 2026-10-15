import { test } from "node:test";
import assert from "node:assert/strict";
import type { Identity } from "../shared/parse.ts";
import type { Registry } from "../shared/registry.ts";
import { type FinishDeps, finishMint, tokenCandidates, validateToken } from "./mint.ts";

/** A token-shaped string of a realistic length (over the 100-character floor). */
const TOKEN = `sk-ant-oat01-${"A1b2_C3d4-".repeat(10)}xyz`;

test("a token on a line of its own is found", () => {
  assert.equal(tokenCandidates(`Your token:\n\n${TOKEN}\n\nStore it safely.\n`)[0], TOKEN);
});

test("terminal escape sequences around and inside the output are stripped", () => {
  const transcript =
    "\x1b]0;claude\x07\x1b[?25l\x1b[2K\x1b[1G\x1b(B\x1b=" +
    `\x1b[32m${TOKEN}\x1b[0m\x1b[?25h\r\n\r\n` +
    "\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\\r\n";
  const candidates = tokenCandidates(transcript);
  assert.equal(candidates[0], TOKEN);
  assert.equal(candidates.some((candidate) => candidate.includes("\x1b")), false);
});

test("a token split across two lines is joined back together", () => {
  const head = TOKEN.slice(0, 60);
  const tail = TOKEN.slice(60);
  const candidates = tokenCandidates(`${head}\r\n${tail}\r\n`);
  assert.equal(candidates[0], TOKEN);
  assert.ok(candidates.includes(TOKEN));
});

test("leading spaces on the continuation line are ignored when joining", () => {
  const head = TOKEN.slice(0, 80);
  const tail = TOKEN.slice(80);
  assert.equal(tokenCandidates(`  ${head}   \n    ${tail} \n`)[0], TOKEN);
});

test("a token glued to the word after it is offered with every shorter prefix", () => {
  const candidates = tokenCandidates(`${TOKEN}Store this token somewhere safe.\n`);
  assert.equal(candidates[0], `${TOKEN}Store`);
  assert.ok(candidates.includes(TOKEN));
  // Prefixes stop at the length floor.
  assert.ok(candidates.every((candidate) => candidate.length >= 100));
  assert.equal(candidates.at(-1)!.length, 100);
});

test("candidates come longest first, without duplicates", () => {
  const candidates = tokenCandidates(`${TOKEN}\n\n${TOKEN}\n`);
  assert.equal(new Set(candidates).size, candidates.length);
  for (let index = 1; index < candidates.length; index += 1) {
    assert.ok(candidates[index - 1]!.length >= candidates[index]!.length);
  }
  assert.equal(candidates[0], TOKEN);
});

test("a line that ends in a token is also read joined with the next line's start", () => {
  const candidates = tokenCandidates(`${TOKEN}\nlink\n`);
  assert.equal(candidates[0], `${TOKEN}link`);
  assert.ok(candidates.includes(TOKEN));
});

test("a transcript with no token has no candidates", () => {
  assert.deepEqual(tokenCandidates("Error: login cancelled\n"), []);
  assert.deepEqual(tokenCandidates(""), []);
});

// finishMint

const HOME = "/Users/me/.claude-work";
const identity = (email: string): Identity => ({ loggedIn: email !== "", email, orgName: "", subscriptionType: "" });

function registry(): Registry {
  return {
    version: 2,
    accounts: [
      { id: "work", label: "Work", provider: "claude", home: HOME },
      { id: "personal", label: "Personal", provider: "claude", home: "/Users/me/.claude-personal" },
    ],
    agents: {},
    hidden: [],
  };
}

function deps(over: Partial<FinishDeps> = {}) {
  const written: Array<[string, string]> = [];
  const registries: Registry[] = [];
  const validated: string[] = [];
  const value: FinishDeps = {
    validate: async (token) => {
      validated.push(token);
      return token === TOKEN;
    },
    whoami: async () => "alice@example.com",
    identify: async () => identity("bob@example.com"),
    writeToken: async (login, token) => void written.push([login, token]),
    readRegistry: async () => registry(),
    writeRegistry: async (next) => void registries.push(next),
    ...over,
  };
  return { deps: value, written, registries, validated };
}

test("the first candidate the API accepts is the one stored", async () => {
  const fake = deps();
  const result = await finishMint(HOME, `${TOKEN}Store\n`, fake.deps);
  assert.deepEqual(result, { ok: true, login: "alice@example.com" });
  assert.deepEqual(fake.written, [["alice@example.com", TOKEN]]);
  // Longer readings were tried and rejected first; nothing after the winner was tried.
  assert.equal(fake.validated.at(-1), TOKEN);
  assert.equal(fake.validated[0], `${TOKEN}Store`);
});

test("the login comes from the token itself, not from the directory", async () => {
  let identified = false;
  const fake = deps({
    identify: async () => {
      identified = true;
      return identity("bob@example.com");
    },
  });
  const result = await finishMint(HOME, TOKEN, fake.deps);
  assert.deepEqual(result, { ok: true, login: "alice@example.com" });
  assert.equal(identified, false);
});

test("when the token does not say who it is, the directory's login is used", async () => {
  const asked: string[] = [];
  const fake = deps({
    whoami: async () => "",
    identify: async (home) => {
      asked.push(home);
      return identity("bob@example.com");
    },
  });
  const result = await finishMint(`${HOME}/`, TOKEN, fake.deps);
  assert.deepEqual(result, { ok: true, login: "bob@example.com" });
  assert.deepEqual(asked, [HOME], "asked with the canonical path");
  assert.deepEqual(fake.written, [["bob@example.com", TOKEN]]);
});

test("a whoami that fails falls back to the directory's login too", async () => {
  const fake = deps({
    whoami: async () => {
      throw new Error("claude exited 1");
    },
  });
  assert.deepEqual(await finishMint(HOME, TOKEN, fake.deps), { ok: true, login: "bob@example.com" });
});

test("no candidate the API accepts is no-token, and nothing is written", async () => {
  const fake = deps({ validate: async () => false });
  assert.deepEqual(await finishMint(HOME, TOKEN, fake.deps), { ok: false, reason: "no-token" });
  assert.deepEqual(fake.written, []);
  assert.deepEqual(fake.registries, []);
});

test("a line that ends in a token is also read joined with the next line's start", () => {
  const candidates = tokenCandidates(`${TOKEN}\nlink\n`);
  assert.equal(candidates[0], `${TOKEN}link`);
  assert.ok(candidates.includes(TOKEN));
});

test("a transcript with no token at all is no-token", async () => {
  const fake = deps();
  assert.deepEqual(await finishMint(HOME, "cancelled\n", fake.deps), { ok: false, reason: "no-token" });
  assert.deepEqual(fake.validated, []);
});

test("a valid token nobody can name is no-login, and nothing is written", async () => {
  const fake = deps({
    whoami: async () => "",
    identify: async () => {
      throw new Error("timeout");
    },
  });
  assert.deepEqual(await finishMint(HOME, TOKEN, fake.deps), { ok: false, reason: "no-login" });
  assert.deepEqual(fake.written, []);
  assert.deepEqual(fake.registries, []);
});

test("only the account at this home records the token login", async () => {
  const fake = deps();
  await finishMint(HOME, TOKEN, fake.deps);
  assert.equal(fake.registries.length, 1);
  const [work, personal] = fake.registries[0]!.accounts;
  assert.equal(work?.tokenLogin, "alice@example.com");
  assert.equal(personal?.tokenLogin, undefined);
});

test("a home no account is registered at stores the token but leaves the registry alone", async () => {
  const fake = deps();
  const result = await finishMint("/Users/me/.claude-spare", TOKEN, fake.deps);
  assert.deepEqual(result, { ok: true, login: "alice@example.com" });
  assert.equal(fake.written.length, 1);
  assert.deepEqual(fake.registries, []);
});

// validateToken

function fetcher(status: number | Error, seen: RequestInit[] = []): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    seen.push(init);
    if (status instanceof Error) throw status;
    return new Response(null, { status });
  }) as unknown as typeof fetch;
}

test("a token the API accepts, or recognises without access, is valid", async () => {
  assert.equal(await validateToken(TOKEN, fetcher(200)), true);
  assert.equal(await validateToken(TOKEN, fetcher(403)), true);
});

test("a rejected token, a server error or a network failure is not valid", async () => {
  assert.equal(await validateToken(TOKEN, fetcher(401)), false);
  assert.equal(await validateToken(TOKEN, fetcher(500)), false);
  assert.equal(await validateToken(TOKEN, fetcher(new Error("offline"))), false);
});

test("the token is sent as a bearer token with the OAuth beta header", async () => {
  const seen: RequestInit[] = [];
  await validateToken(TOKEN, fetcher(200, seen));
  const headers = seen[0]!.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(headers["anthropic-beta"], "oauth-2025-04-20");
});
