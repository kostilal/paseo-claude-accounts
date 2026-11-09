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
    /** How Auto picks among accounts with room; see shared/auto.ts. */
    autoPolicy: z.enum(["burn-first", "most-room"]).default("burn-first"),
    /** Whether Auto's first pick in a workspace holds for the workspace's later chats. Off:
     *  every new chat is picked on its own. */
    oneAccountPerWorkspace: z.boolean().default(false),
    /** How long a usage reading stands before the next poll measures it again, in minutes. */
    refreshMinutes: z.number().int().min(1).max(1440).default(10),
    /** The forecast on the Accounts screen: logins left out of it, by their key, so a new
     *  account counts until it is unticked. */
    forecastUnchecked: z.array(z.string()).default([]),
    /** Sizes set by hand in the forecast, by login key, in multiples of a Pro plan. */
    forecastCapacity: z.record(z.string(), z.number().positive()).default({}),
  }),
});

export type Preferences = z.output<typeof preferences.schema>;

export const defaultPreferences: Preferences = {
  language: "auto",
  showPill: true,
  autoPolicy: "burn-first",
  oneAccountPerWorkspace: false,
  refreshMinutes: 10,
  forecastUnchecked: [],
  forecastCapacity: {},
};
