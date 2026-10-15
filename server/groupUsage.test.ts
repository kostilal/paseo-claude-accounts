import { test } from "node:test";
import assert from "node:assert/strict";
import type { UsageResult } from "./usage.ts";
import { usageForLogin, usageOrder } from "./groupUsage.ts";

const ok: UsageResult = { state: "ok", fiveHour: { utilization: 18, resetsAt: "" }, sevenDay: null, error: "" };
const expired: UsageResult = { state: "expired", fiveHour: null, sevenDay: null, error: "" };
const failed: UsageResult = { state: "error", fiveHour: null, sevenDay: null, error: "boom" };

test("the first directory that answers wins, and later ones are not read", async () => {
  const seen: string[] = [];
  const result = await usageForLogin(["/a", "/b", "/c"], async (home) => {
    seen.push(home);
    return home === "/b" ? ok : expired;
  });
  assert.equal(result.state, "ok");
  assert.deepEqual(seen, ["/a", "/b"]);
});

test("an expired token is only the answer when every member is expired", async () => {
  const result = await usageForLogin(["/a", "/b"], async () => expired);
  assert.equal(result.state, "expired");
});

// When a fresh member fails to read, a stale sibling's expiry is not the reason to show.
test("a live member's failure beats a stale sibling's expiry, in either order", async () => {
  const unauthorised: UsageResult = { state: "unauthorised", fiveHour: null, sevenDay: null, error: "" };
  assert.equal((await usageForLogin(["/a", "/b"], async (home) => (home === "/a" ? failed : expired))).state, "error");
  assert.equal((await usageForLogin(["/a", "/b"], async (home) => (home === "/a" ? expired : failed))).state, "error");
  assert.equal((await usageForLogin(["/a", "/b"], async (home) => (home === "/a" ? expired : unauthorised))).state, "unauthorised");
});

test("no members at all reads nothing", async () => {
  assert.equal((await usageForLogin([], async () => ok)).state, "unauthorised");
});

test("the preferred directory goes first, the rest follow sorted", () => {
  const order = usageOrder({ accountIds: ["c", "a", "b"], switchTo: "b" }, (id) => `/${id}`, "/b");
  assert.deepEqual(order, ["/b", "/a", "/c"]);
  assert.deepEqual(usageOrder({ accountIds: ["b", "a"], switchTo: "" }, (id) => `/${id}`, null), ["/a", "/b"]);
});
