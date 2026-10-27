import { CLAUDE_DIR } from "./naming.ts";
import { canonical } from "./path.ts";

/** The accounts this plugin can switch between. */
export type ProviderId = "claude" | "codex";

export interface ProviderSpec {
  id: ProviderId;
  /** The variable naming a config directory (transcript, settings, MCP servers). A session
   *  keeps its own, so switching an account never moves its history. */
  configVar: string;
  /** The variable set to an account's directory so the session runs on that account's login.
   *  Claude reads credentials from a separate store directory, so a switch leaves the session's
   *  own config directory alone; Codex refreshes its login inside its config directory, so for
   *  it the two are the same variable. */
  credVar: string;
  /** Whether `credVar` must be "" (not the path) for the default directory. Claude's Keychain
   *  item for the default directory is unsuffixed, which an empty value selects; the path would
   *  be hashed to a different, empty item and read as logged out. Codex has no such default. */
  credDefaultEmpty: boolean;
  /** Whether switching is implemented; an unsupported provider is refused everywhere. */
  supported: boolean;
  /** Whether remaining allowance can be polled. Codex has no usage endpoint (limits come only
   *  as response headers on live turns), so its rows show `unsupported`. */
  meterable: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  claude: {
    id: "claude",
    configVar: "CLAUDE_CONFIG_DIR",
    credVar: "CLAUDE_SECURESTORAGE_CONFIG_DIR",
    credDefaultEmpty: true,
    supported: true,
    meterable: true,
  },
  codex: {
    id: "codex",
    configVar: "CODEX_HOME",
    credVar: "CODEX_HOME",
    credDefaultEmpty: false,
    supported: true,
    meterable: false,
  },
};

export function isProviderId(value: string): value is ProviderId {
  return Object.hasOwn(PROVIDERS, value);
}

/** What a Paseo provider id runs on: the provider whose accounts it switches between, and the
 *  config directory its profile pins (`CLAUDE_CONFIG_DIR` in a custom provider's `env`), or
 *  null when it pins none. */
export interface ProviderFamily {
  family: ProviderId;
  configDir: string | null;
}

/**
 * Every custom provider in Paseo's config that extends one of ours (`"extends": "claude"`),
 * by id. Such a profile runs the same CLI, so its chats switch accounts like the provider's
 * own; its `env` reaches the session under whatever the session-open hook sets. No `node:`
 * imports, since this is bundled into the client.
 */
export function providerFamilies(config: unknown): Record<string, ProviderFamily> {
  const providers = (config as { agents?: { providers?: unknown } } | null)?.agents?.providers;
  const found: Record<string, ProviderFamily> = {};
  if (typeof providers !== "object" || providers === null) return found;
  for (const [id, raw] of Object.entries(providers as Record<string, unknown>)) {
    if (isProviderId(id) || typeof raw !== "object" || raw === null) continue;
    const entry = raw as { extends?: unknown; env?: unknown };
    if (typeof entry.extends !== "string" || !isProviderId(entry.extends)) continue;
    const env = typeof entry.env === "object" && entry.env !== null ? (entry.env as Record<string, unknown>) : {};
    const dir = env[PROVIDERS[entry.extends].configVar];
    found[id] = { family: entry.extends, configDir: typeof dir === "string" && dir !== "" ? dir : null };
  }
  return found;
}

/** What `provider` runs on: itself for one of ours, its entry in `families` for a profile
 *  extending one, else null. */
export function familyOf(provider: string, families: Record<string, ProviderFamily>): ProviderFamily | null {
  if (isProviderId(provider)) return { family: provider, configDir: null };
  return Object.hasOwn(families, provider) ? families[provider]! : null;
}

/** Which provider a config directory belongs to, from its name alone, or null. Only for
 *  unregistered directories; registered accounts carry their provider. No `node:` imports,
 *  since this is bundled into the client. */
export function providerForHome(home: string): ProviderId | null {
  const base = home.slice(home.lastIndexOf("/") + 1);
  if (CLAUDE_DIR.test(base)) return "claude";
  if (base === ".codex" || base.startsWith(".codex-")) return "codex";
  return null;
}

/**
 * The environment a session opens with to run on one account: the account's directory in the
 * provider's credential variable. The session keeps its own config directory (transcript,
 * settings, MCP servers) and `--resume` still finds the conversation; only the login changes.
 * `defaultDir` is the provider's default config directory, reached with an empty value.
 */
export function envFor(
  account: { provider: ProviderId; home: string },
  defaultDir: string,
): Record<string, string> {
  const spec = PROVIDERS[account.provider];
  const value = spec.credDefaultEmpty && canonical(account.home) === canonical(defaultDir) ? "" : account.home;
  return { [spec.credVar]: value };
}
