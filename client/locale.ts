import { useSettings } from "@getpaseo/plugin/client";
import { useSyncExternalStore } from "react";
import { type Locale, type Strings, detectLocale, pickLocale, t } from "../shared/i18n.ts";
import { appLanguage } from "./web.ts";
import { type Preferences, defaultPreferences, preferences } from "../shared/settings.ts";

/** Paseo's own idea of its language, since 0.15; older hosts have none. */
interface HostLanguage {
  readonly locale: string;
  subscribe?: (listener: () => void) => () => void;
}

let host: HostLanguage | null = null;

/** Called once with the client context, so the app's language can be asked of the app. */
export function rememberHostLanguage(client: object): void {
  const i18n = (client as { i18n?: HostLanguage }).i18n;
  host = i18n !== undefined && typeof i18n.locale === "string" ? i18n : null;
}

const noSubscription = () => () => {};

/** The saved preferences, or the defaults while they load or cannot be read. */
export function usePreferences(): Preferences {
  const state = useSettings(preferences);
  return state.status === "ready" ? state.values : defaultPreferences;
}

/** The strings to draw with: the language chosen in the plugin's settings, else Paseo's
 *  own, else the device's. */
export function useStrings(): Strings {
  const { language } = usePreferences();
  // Draws again the moment Paseo's language changes.
  useSyncExternalStore(host?.subscribe ?? noSubscription, () => host?.locale ?? null);
  return t(language === "auto" ? detectAppLocale() : language);
}

/** Paseo's own language: what it says it runs in, else its saved setting, else the device's. */
export function detectAppLocale(): Locale {
  return pickLocale(host?.locale ?? null, appLanguage(), detectLocale());
}
