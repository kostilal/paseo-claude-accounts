import type { PluginHandlerContext } from "@getpaseo/plugin/server";

/** The Paseo SDK a handler receives. Derived from the plugin SDK rather than imported from
 *  `@getpaseo/client`, which is not available when Paseo builds a plugin installed from git. */
export type PaseoApi = PluginHandlerContext["paseo"];

export type PaseoTerminalCreateOptions = Parameters<PaseoApi["terminals"]["create"]>[0];
