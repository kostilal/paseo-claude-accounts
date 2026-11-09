import { test } from "node:test";
import assert from "node:assert/strict";
import { USAGE_BAD_KEYCHAIN, USAGE_NOT_IN_TIME, USAGE_NO_TOKEN, USAGE_RATE_LIMITED, detectLocale, pickLocale, resolveLocale, t, usageErrorText } from "./i18n.ts";

/** Swaps `Intl` for the duration of one test. */
function withoutIntl<T>(body: () => T): T {
  const host = globalThis as { Intl: unknown };
  const real = host.Intl;
  host.Intl = {
    DateTimeFormat: () => {
      throw new Error("this runtime was built without Intl data");
    },
  };
  try {
    return body();
  } finally {
    host.Intl = real;
  }
}

function withLang<T>(value: string | undefined, body: () => T): T {
  const before = process.env.LANG;
  if (value === undefined) delete process.env.LANG;
  else process.env.LANG = value;
  try {
    return body();
  } finally {
    if (before === undefined) delete process.env.LANG;
    else process.env.LANG = before;
  }
}

test("a region tag narrows to its catalogue entry", () => {
  assert.equal(resolveLocale("ru-RU"), "ru");
  assert.equal(resolveLocale("uk-UA"), "uk");
  assert.equal(resolveLocale("en-GB"), "en");
});

test("a POSIX locale string narrows the same way", () => {
  assert.equal(resolveLocale("ru_RU.UTF-8"), "ru");
  assert.equal(resolveLocale("uk_UA.UTF-8"), "uk");
});

test("a language with no catalogue of its own reads English", () => {
  assert.equal(resolveLocale("de-DE"), "en");
  assert.equal(resolveLocale(""), "en");
});

test("an explicit candidate wins over the runtime", () => {
  assert.equal(detectLocale("uk-UA"), "uk");
  assert.equal(detectLocale("ru"), "ru");
});

test("the locale comes from Intl, not from the daemon's LANG", () => {
  // Compared against Intl's own answer, so it holds whatever the system language is.
  const fromIntl = resolveLocale(new Intl.DateTimeFormat().resolvedOptions().locale);
  withLang("ru_RU.UTF-8", () => assert.equal(detectLocale(), fromIntl));
  withLang("uk_UA.UTF-8", () => assert.equal(detectLocale(), fromIntl));
});

test("a runtime without Intl falls back to LANG", () => {
  withoutIntl(() => {
    withLang("uk_UA.UTF-8", () => assert.equal(detectLocale(), "uk"));
    withLang("ru_RU.UTF-8", () => assert.equal(detectLocale(), "ru"));
    withLang(undefined, () => assert.equal(detectLocale(), "en"));
  });
});

test("every locale carries every string", () => {
  const keys = Object.keys(t("en")) as Array<keyof ReturnType<typeof t>>;
  for (const locale of ["ru", "uk"] as const) {
    const strings = t(locale);
    for (const key of keys) {
      assert.equal(typeof strings[key], "string", `${locale} is missing ${String(key)}`);
      assert.notEqual(strings[key], "", `${locale}'s ${String(key)} is empty`);
    }
  }
});

test("Paseo's own language wins over the device's", () => {
  assert.equal(pickLocale("ru", null, "en"), "ru");
  assert.equal(pickLocale("en", "en", "ru"), "en");
});

test("a host that does not say falls back to its saved language, then the device's", () => {
  assert.equal(pickLocale(null, "uk", "en"), "uk");
  assert.equal(pickLocale(null, null, "ru"), "ru");
});

test("a Paseo language this catalogue lacks reads English", () => {
  assert.equal(pickLocale("ja", null, "ru"), "en");
  assert.equal(pickLocale("pt-BR", "pt-BR", "en"), "en");
});

test("a Ukrainian device on system stays Ukrainian though Paseo falls back to English", () => {
  assert.equal(pickLocale("en", null, "uk"), "uk");
  assert.equal(pickLocale("en", "en", "uk"), "en");
});

test("the daemon's English failures reach the reader in the reader's language", () => {
  const ru = t("ru");
  assert.equal(usageErrorText(USAGE_RATE_LIMITED, ru), ru.usageRateLimited);
  assert.equal(usageErrorText(USAGE_NOT_IN_TIME, ru), ru.usageTimedOut);
  assert.equal(usageErrorText(USAGE_NO_TOKEN, ru), ru.usageNoToken);
  assert.equal(usageErrorText(USAGE_BAD_KEYCHAIN, ru), ru.usageBadKeychain);
  assert.equal(usageErrorText("fetch failed", ru), ru.usageNetworkFailed);
  assert.equal(usageErrorText("fetch failed (ETIMEDOUT)", ru), `${ru.usageNetworkFailed} (ETIMEDOUT)`);
  assert.equal(usageErrorText("something the system said", ru), "something the system said");
});
