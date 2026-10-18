import { test } from "node:test";
import assert from "node:assert/strict";
import { type RefusalCode, refusalText } from "./defaults.ts";
import { t } from "./i18n.ts";

const CODES: RefusalCode[] = ["unknown-account", "missing-directory", "not-set", "no-accounts"];

test("every refusal reads in every language with its placeholders filled", () => {
  for (const locale of ["en", "ru", "uk"] as const) {
    for (const code of CODES) {
      const text = refusalText(t(locale), code, { label: "Team", dir: "/w/evo/.claude-data" });
      assert.ok(text.length > 20, `${locale}/${code}`);
      assert.doesNotMatch(text, /\{(label|dir)\}/, `${locale}/${code}`);
    }
  }
});

test("a refusal about the default names it, one about the chat names its folder", () => {
  const en = t("en");
  assert.match(refusalText(en, "missing-directory", { label: "Team" }), /"Team"/);
  assert.match(refusalText(en, "not-set", { dir: "/w/evo/.claude-data" }), /\/w\/evo\/\.claude-data/);
  assert.match(refusalText(en, "not-set", {}), /Settings → Plugins → Claude Accounts/);
});
