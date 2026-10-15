import type { PaseoApi } from "./paseo.ts";

/**
 * Variables that make Claude Code ignore `CLAUDE_CODE_OAUTH_TOKEN`: an API key or auth
 * token is preferred over it, and a cloud provider replaces Anthropic's API altogether.
 * With any of these in a session's environment, switching accounts changes nothing.
 */
export const OVERRIDING_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
] as const;

/** The first overriding variable set in any of the given environments, or "". */
export function overridingVar(...envs: ReadonlyArray<Record<string, string | undefined> | undefined>): string {
  for (const name of OVERRIDING_VARS) {
    if (envs.some((env) => (env?.[name] ?? "") !== "")) return name;
  }
  return "";
}

/** The `env` Paseo's config gives the Claude provider, or undefined. */
function providerEnv(config: unknown): Record<string, string> | undefined {
  const env = (config as { agents?: { providers?: { claude?: { env?: unknown } } } } | null)?.agents?.providers?.claude
    ?.env;
  return typeof env === "object" && env !== null ? (env as Record<string, string>) : undefined;
}

/**
 * Checks the daemon's own environment and the Claude provider's configured `env`, cached
 * for a minute. A wrapper command that sets a key itself cannot be seen from here.
 */
export function createApiKeyCheck(ttlMs = 60_000, daemonEnv: NodeJS.ProcessEnv = process.env) {
  let cached: { at: number; value: string } | null = null;
  return async function check(paseo: PaseoApi): Promise<string> {
    if (cached !== null && Date.now() - cached.at < ttlMs) return cached.value;
    let configured: Record<string, string> | undefined;
    try {
      configured = providerEnv((await paseo.config.get()).config);
    } catch {
      configured = undefined;
    }
    const value = overridingVar(daemonEnv, configured);
    cached = { at: Date.now(), value };
    return value;
  };
}
