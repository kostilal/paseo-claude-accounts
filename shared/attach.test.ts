import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT_RESOURCE, askedAccount } from "./attach.ts";

const picked = (id: string, resourceType = ACCOUNT_RESOURCE) => ({
  type: "text",
  mimeType: "text/plain",
  text: "…",
  externalResource: { provider: "claude-accounts", resourceType, id, identifier: id, title: id, url: "https://claude.ai" },
});

test("the account a picked attachment names is the one asked for, the last pick winning", () => {
  assert.equal(askedAccount([picked("work")]), "work");
  assert.equal(askedAccount([picked("work"), picked("@auto")]), "@auto");
});

test("other attachments, and malformed ones, ask for nothing", () => {
  assert.equal(askedAccount([]), null);
  assert.equal(askedAccount([picked("work", "github_issue")]), null);
  assert.equal(askedAccount([{ type: "uploaded_file" }, null, "x", { type: "text" }]), null);
  assert.equal(askedAccount([{ ...picked("work"), type: "review" }]), null);
  assert.equal(askedAccount([picked("")]), null);
});
