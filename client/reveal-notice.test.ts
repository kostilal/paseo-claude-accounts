import assert from "node:assert/strict";
import { test } from "node:test";
import { t } from "../shared/i18n.ts";
import { revealNotice } from "./reveal-notice.ts";

const strings = t("en");

/** A row nobody has pressed: `mutate` has never run for it, so `variables` is still the
 *  mutation's own initial `undefined` and never equals any real `switchTo`. */
function neverPressed() {
  return { variables: undefined, isError: false, error: null, isSuccess: false, data: undefined };
}

test("a row that has never been pressed has nothing to say", () => {
  assert.equal(revealNotice(neverPressed(), "acct-a", strings), null);
});

test("a row whose press is still pending has nothing to say yet", () => {
  const pending = { variables: "acct-a", isError: false, error: null, isSuccess: false, data: undefined };
  assert.equal(revealNotice(pending, "acct-a", strings), null);
});

test("a rejected call surfaces its own message", () => {
  const rejected = { variables: "acct-a", isError: true, error: new Error("boom"), isSuccess: false, data: undefined };
  assert.equal(revealNotice(rejected, "acct-a", strings), "boom");
});

test("a rejected call with a non-Error thrown value is stringified rather than dropped", () => {
  const rejected = { variables: "acct-a", isError: true, error: "nope", isSuccess: false, data: undefined };
  assert.equal(revealNotice(rejected, "acct-a", strings), "nope");
});

test("a resolved unknown-account answers with the translated string, not the empty usageError beside it", () => {
  const resolved = {
    variables: "acct-a",
    isError: false,
    error: null,
    isSuccess: true,
    data: { usageErrorCode: "unknown-account" as const, usageError: "" },
  };
  assert.equal(revealNotice(resolved, "acct-a", strings), strings.usageUnknownAccount);
});

test("a resolved plain usageError (a dismissed Keychain dialog, say) is shown as-is", () => {
  const resolved = {
    variables: "acct-a",
    isError: false,
    error: null,
    isSuccess: true,
    data: { usageErrorCode: "" as const, usageError: "dismissed" },
  };
  assert.equal(revealNotice(resolved, "acct-a", strings), "dismissed");
});

test("a resolved success with neither error field has nothing to say", () => {
  const resolved = {
    variables: "acct-a",
    isError: false,
    error: null,
    isSuccess: true,
    data: { usageErrorCode: "" as const, usageError: "" },
  };
  assert.equal(revealNotice(resolved, "acct-a", strings), null);
});

test("row B's failure never appears on row A: the cross-row staleness guard", () => {
  const rowBFailed = {
    variables: "acct-b",
    isError: true,
    error: new Error("row b broke"),
    isSuccess: false,
    data: undefined,
  };
  assert.equal(revealNotice(rowBFailed, "acct-a", strings), null, "row A asks and gets nothing");
  assert.equal(revealNotice(rowBFailed, "acct-b", strings), "row b broke", "row B asks and gets its own failure");
});
