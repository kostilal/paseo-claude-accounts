import { CLAUDE_DIR } from "./naming.ts";

/** How each provider is moved from one account to another. Claude switches by an injected
 *  long-lived token, so the session keeps its own config directory (transcript, settings,
 *  MCP servers). Codex switches by directory: its refresh tokens rotate, so a copied token
 *  would race the user's own Codex and could revoke the login. */
export type ProviderId = "claude" | "codex";

export type SwitchKind =
  /** The account's token is injected; the session keeps whatever directory it already had. */
  | { kind: "token"; tokenVar: string }
  /** The account's directory is injected; the provider does its own refreshing inside it. */
  | { kind: "home"; homeVar: string };

export interface ProviderSpec {
  id: ProviderId;
  /** The variable naming a config directory, whether or not the switch uses it. */
  homeVar: string;
  switch: SwitchKind;
  /** Whether switching is implemented; an unsupported provider is refused everywhere. */
  supported: boolean;
  /** Whether remaining allowance can be polled. Codex has no usage endpoint (limits come
   *  only as response headers on live turns), so its rows show `unsupported`. */
  meterable: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  claude: {
    id: "claude",
    homeVar: "CLAUDE_CONFIG_DIR",
    switch: { kind: "token", tokenVar: "CLAUDE_CODE_OAUTH_TOKEN" },
    supported: true,
    meterable: true,
  },
  codex: {
    id: "codex",
    homeVar: "CODEX_HOME",
    switch: { kind: "home", homeVar: "CODEX_HOME" },
    supported: true,
    meterable: false,
  },
};

export function isProviderId(value: string): value is ProviderId {
  return Object.hasOwn(PROVIDERS, value);
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

/** The environment a session opens with for one account. The token branch sets only the
 *  token: the session keeps whatever config directory it would have had, so its transcript,
 *  settings and MCP servers stay put and `--resume` still finds the conversation. The home
 *  branch sets only the directory and ignores any token. */
export function envFor(
  account: { provider: ProviderId; home: string },
  token: string | null,
): Record<string, string> {
  const mechanism = PROVIDERS[account.provider].switch;
  if (mechanism.kind === "home") return { [mechanism.homeVar]: account.home };
  return token === null || token === "" ? {} : { [mechanism.tokenVar]: token };
}
