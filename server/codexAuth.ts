import { type Identity, record } from "../shared/parse.ts";

const loggedOut: Identity = { loggedIn: false, email: "", orgName: "", subscriptionType: "" };

/** The custom OIDC claim holding Codex's subscription details. */
const AUTH_CLAIM = "https://api.openai.com/auth";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A JWT's payload, or null when there is nothing object-shaped to read. The signature is not
 *  verified: the token comes from a file in the user's own home directory, so anyone able to
 *  forge it could rewrite the directory anyway. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  if (segments.length !== 3) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(segments[1]!, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  // Not `record()`, which would turn a non-object into `{}`; here that must be null.
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

/** Who a Codex config directory is logged in as, from its `auth.json`. Read from the
 *  `id_token` because `codex login status` prints no address and exits 0 either way.
 *  A ChatGPT login yields the full identity; an API key is logged in but anonymous; anything
 *  else is logged out. Never throws, so one bad file cannot empty the list. */
export function parseCodexAuth(raw: string): Identity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return loggedOut;
  }
  const body = record(parsed);
  const tokens = record(body.tokens);
  const idToken = tokens.id_token;
  if (typeof idToken !== "string" || idToken === "") {
    return str(body.OPENAI_API_KEY) === ""
      ? loggedOut
      : { loggedIn: true, email: "", orgName: "", subscriptionType: "" };
  }
  const claims = decodeJwtPayload(idToken);
  if (claims === null) return loggedOut;
  const auth = record(claims[AUTH_CLAIM]);
  const organizations = Array.isArray(auth.organizations) ? auth.organizations : [];
  // The default organization is the one usage bills to, not necessarily the first.
  const org = organizations.map(record).find((entry) => entry.is_default === true) ?? {};
  return {
    loggedIn: true,
    email: str(claims.email),
    orgName: str(org.title),
    subscriptionType: str(auth.chatgpt_plan_type),
  };
}
