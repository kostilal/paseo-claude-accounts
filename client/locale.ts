import { useSettings } from "@getpaseo/plugin/client";
import { type Locale, type Strings, detectLocale, resolveLocale, t } from "../shared/i18n.ts";
import { appLanguage } from "./web.ts";
import { type Preferences, defaultPreferences, preferences } from "../shared/settings.ts";

/** The saved preferences, or the defaults while they load or cannot be read. */
export function usePreferences(): Preferences {
  const state = useSettings(preferences);
  return state.status === "ready" ? state.values : defaultPreferences;
}

/** The strings to draw with: the language chosen in the plugin's settings, else Paseo's
 *  own, else the device's. */
export function useStrings(): Strings {
  const { language } = usePreferences();
  return t(language === "auto" ? detectAppLocale() : language);
}

/** Paseo's own language where it can be read, else the device's. */
export function detectAppLocale(): Locale {
  const language = appLanguage();
  return language === null ? detectLocale() : resolveLocale(language);
}
