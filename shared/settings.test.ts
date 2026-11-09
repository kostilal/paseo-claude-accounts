import { test } from "node:test";
import assert from "node:assert/strict";
import { preferences } from "./settings.ts";

test("settings stored before the interval existed read as ten minutes", () => {
  const stored = { language: "ru", showPill: false, autoPolicy: "most-room", oneAccountPerWorkspace: true };
  const parsed = preferences.schema.parse(stored);
  assert.equal(parsed.refreshMinutes, 10);
  assert.equal(parsed.language, "ru");
  assert.equal(parsed.showPill, false);
});

test("an interval outside a day, or not whole minutes, is refused", () => {
  assert.equal(preferences.schema.safeParse({ refreshMinutes: 0 }).success, false);
  assert.equal(preferences.schema.safeParse({ refreshMinutes: 1441 }).success, false);
  assert.equal(preferences.schema.safeParse({ refreshMinutes: 2.5 }).success, false);
  assert.equal(preferences.schema.parse({ refreshMinutes: 30 }).refreshMinutes, 30);
});
