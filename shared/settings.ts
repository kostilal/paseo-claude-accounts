import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** The plugin's preferences, kept by the host (Settings → Plugins → Accounts). `language`
 *  exists because the SDK does not tell a plugin the app's language; "auto" follows Paseo's
 *  setting where it can be read (`detectAppLocale` in client/locale.ts), else the device. */
export const preferences = defineSettings({
  id: "preferences",
  scope: "host",
  version: 1,
  schema: z.object({
    language: z.enum(["auto", "en", "ru", "uk"]).default("auto"),
    /** The composer pill above every Claude chat, which is where switching happens. */
    showPill: z.boolean().default(true),
  }),
});

export type Preferences = z.output<typeof preferences.schema>;

export const defaultPreferences: Preferences = { language: "auto", showPill: true };
