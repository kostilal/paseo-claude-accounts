import { Platform } from "react-native";

interface Storage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}

/**
 * The language set in Paseo's own settings, or null when it cannot be read.
 *
 * What the language setting itself says, which tells "system" from a language chosen, as the
 * host's resolved language cannot. On web/desktop this reads Paseo's settings record from
 * localStorage. It is matched by shape (`language` + `theme`), not by key, so a
 * renamed key degrades to the device language. Native clients always return null.
 */
export function appLanguage(): string | null {
  if (Platform.OS !== "web") return null;
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (storage === undefined) return null;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      const raw = key === null ? null : storage.getItem(key);
      if (raw === null || raw[0] !== "{" || !raw.includes('"language"')) continue;
      const parsed = JSON.parse(raw) as { language?: unknown; theme?: unknown };
      if (typeof parsed.language !== "string" || !("theme" in parsed)) continue;
      return parsed.language === "system" ? null : parsed.language;
    }
  } catch {
    // Blocked or malformed storage: fall back to the device language.
  }
  return null;
}
