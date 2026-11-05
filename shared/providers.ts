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

/**
 * Variables that make Claude Code ignore `CLAUDE_CODE_OAUTH_TOKEN`: an API key or auth
 * token is preferred over it, and a cloud provider or gateway replaces Anthropic's API
 * altogether. With any of these in a session's environment, switching accounts changes nothing.
 */
export const OVERRIDING_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_GATEWAY",
] as const;

/** What makes a profile run on something other than a directory's login: those, a token of its
 *  own, which wins over that login, or an endpoint of its own. */
const OWN_AUTH_VARS: readonly string[] = [...OVERRIDING_VARS, "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL"];

const envOf = (entry: unknown): Record<string, unknown> => {
  const env = (entry as { env?: unknown } | null | undefined)?.env;
  return typeof env === "object" && env !== null ? (env as Record<string, unknown>) : {};
};

/** What a Paseo provider id runs on: the provider whose accounts it switches between, and the
 *  config directory its profile pins (`CLAUDE_CONFIG_DIR` in a custom provider's `env`), or
 *  null when it pins none. */
export interface ProviderFamily {
  family: ProviderId;
  configDir: string | null;
}

/**
 * Every custom provider in the daemon's config that extends one of ours (`"extends": "claude"`),
 * by id. `config` is what `paseo.config.get()` answers, with the providers at its top, not under
 * `agents` as in the config file. Such a profile runs the same CLI, so its chats switch accounts
 * like the provider's own; its `env` reaches the session under whatever the session-open hook
 * sets. A profile on an API key, a cloud provider or a gateway runs on no login, so it has no
 * account to switch and is left out. This only decides who gets a pill: a wrapper command or a file
 * descriptor can still set a key unseen, so the list can never prove a profile runs on a login, and
 * nothing that stops a chat may rest on it. No `node:` imports, since this is bundled into the
 * client.
 */
export function providerFamilies(config: { providers?: unknown } | null | undefined): Record<string, ProviderFamily> {
  const providers = config?.providers;
  const found: Record<string, ProviderFamily> = {};
  if (typeof providers !== "object" || providers === null) return found;
  for (const [id, raw] of Object.entries(providers as Record<string, unknown>)) {
    if (isProviderId(id) || typeof raw !== "object" || raw === null) continue;
    const entry = raw as { extends?: unknown };
    if (typeof entry.extends !== "string" || !isProviderId(entry.extends)) continue;
    // As the session gets it: the daemon lays a profile's env over the provider's it extends.
    const env = { ...envOf((providers as Record<string, unknown>)[entry.extends]), ...envOf(entry) };
    if (OWN_AUTH_VARS.some((name) => typeof env[name] === "string" && env[name] !== "")) continue;
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
