import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeJwtPayload, parseCodexAuth } from "./codexAuth.ts";

/** A JWT is three base64url segments joined by dots; only the middle one is read here, and
 *  nothing verifies the signature — this file answers "who does this directory say it is",
 *  which is a question about a local file, not a security boundary. */
function jwt(claims: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${body}.signature`;
}

const chatgpt = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: jwt({
        email: "person@example.com",
        "https://api.openai.com/auth": {
          chatgpt_plan_type: "pro",
          organizations: [{ id: "org-1", is_default: true, role: "owner", title: "Personal" }],
        },
        ...over,
      }),
      access_token: "at",
      refresh_token: "rt",
      account_id: "acc",
    },
    last_refresh: "2026-09-18T13:25:40Z",
  });

test("a chatgpt login reports its email, its default organization and its plan", () => {
  assert.deepEqual(parseCodexAuth(chatgpt()), {
    loggedIn: true,
    email: "person@example.com",
    orgName: "Personal",
    subscriptionType: "pro",
  });
});

test("the default organization is the one chosen, not the first listed", () => {
  const raw = chatgpt({
    "https://api.openai.com/auth": {
      chatgpt_plan_type: "business",
      organizations: [
        { id: "org-1", is_default: false, title: "Side project" },
        { id: "org-2", is_default: true, title: "Acme" },
      ],
    },
  });
  assert.equal(parseCodexAuth(raw).orgName, "Acme");
});

test("no organizations at all is a blank org, not a crash", () => {
  const raw = chatgpt({ "https://api.openai.com/auth": { chatgpt_plan_type: "free", organizations: [] } });
  assert.deepEqual(parseCodexAuth(raw), {
    loggedIn: true,
    email: "person@example.com",
    orgName: "",
    subscriptionType: "free",
  });
});

test("an api-key directory is logged in and says nothing about who", () => {
  // No identity in an API-key login, so it keys on its own directory.
  const raw = JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-proj-x", tokens: null });
  assert.deepEqual(parseCodexAuth(raw), {
    loggedIn: true,
    email: "",
    orgName: "",
    subscriptionType: "",
  });
});

test("an empty, malformed or tokenless file reads as logged out rather than throwing", () => {
  const out = { loggedIn: false, email: "", orgName: "", subscriptionType: "" };
  assert.deepEqual(parseCodexAuth(""), out);
  assert.deepEqual(parseCodexAuth("not json at all"), out);
  assert.deepEqual(parseCodexAuth("null"), out);
  assert.deepEqual(parseCodexAuth("[1,2,3]"), out);
  assert.deepEqual(parseCodexAuth(JSON.stringify({ auth_mode: "chatgpt" })), out);
  assert.deepEqual(parseCodexAuth(JSON.stringify({ tokens: { id_token: "not.a.jwt" } })), out);
});

test("a token whose payload is not an object decodes to null", () => {
  assert.equal(decodeJwtPayload("a.b.c"), null);
  assert.equal(decodeJwtPayload("onlyonesegment"), null);
  assert.equal(decodeJwtPayload(`h.${Buffer.from("42").toString("base64url")}.s`), null);
  assert.deepEqual(decodeJwtPayload(`h.${Buffer.from('{"a":1}').toString("base64url")}.s`), { a: 1 });
});
