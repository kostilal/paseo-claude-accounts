import { createHash } from "node:crypto";
import { type Identity, record } from "../shared/parse.ts";
import { serviceName } from "../shared/service.ts";
import { type Credential, readCredential } from "./keychain.ts";
import { timeoutSignal } from "./net.ts";

const ENDPOINT = "https://api.anthropic.com/api/oauth/profile";
/** A background Keychain read that takes longer than this has a dialog waiting. */
const BACKGROUND_TIMEOUT_MS = 3_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** How long an answer stands before the Keychain is read again to see whether the login
 *  changed. The profile itself is only asked again when the token did. */
const FRESH_FOR_MS = 10 * 60 * 1000;

/** Whose login a config directory holds, as Anthropic answers for that login's own token. */
export interface ProfileIdentity {
  email: string;
  orgName: string;
  orgId: string;
}

export interface ProfileDeps {
  readCredential(service: string, timeoutMs: number | null): Promise<Credential>;
  request(token: string): Promise<Response>;
  now?(): number;
}

const liveDeps: ProfileDeps = {
  readCredential,
  request: (token) =>
    fetch(ENDPOINT, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    }),
};

/** `identity` with its email and organisation replaced by the login's own answer, when there
 *  is one. Logged-in state and plan stay: they come from the credential, which is reliable. */
export function withProfile(identity: Identity, profile: ProfileIdentity | null): Identity {
  if (profile === null) return identity;
  return { ...identity, email: profile.email, orgName: profile.orgName, orgId: profile.orgId };
}

/** A registered Claude account's identity with its email and organisation taken from its own
 *  login. Discovery reads a cache that chats running on another account rewrite, so without
 *  this a project whose chats were moved elsewhere would read, and group, as that account.
 *  Other providers, logged-out directories and a missing `profile` keep what was discovered. */
export async function ownLogin(
  account: { provider: string; home: string },
  discovered: Identity,
  profile: ((home: string) => Promise<ProfileIdentity | null>) | undefined,
): Promise<Identity> {
  if (account.provider !== "claude" || !discovered.loggedIn || profile === undefined) return discovered;
  return withProfile(discovered, await profile(account.home).catch(() => null));
}

/** Body of `GET /api/oauth/profile`, or null when it names no account. */
export function parseProfile(raw: string): ProfileIdentity | null {
  const body = record(JSON.parse(raw));
  const account = record(body.account);
  const organization = record(body.organization);
  const email = typeof account.email === "string" ? account.email : "";
  if (email === "") return null;
  return {
    email,
    orgName: typeof organization.name === "string" ? organization.name : "",
    orgId: typeof organization.uuid === "string" ? organization.uuid : "",
  };
}

/**
 * Who each config directory is really logged in as. `claude auth status` reads the account
 * cached in the directory's `.claude.json`, and Claude Code rewrites that cache to whatever
 * login a chat in the directory runs on — so once a project's chats are switched to another
 * account, its own login would read as that account. This asks Anthropic with the
 * directory's own token instead, the same credential its usage is read from.
 *
 * Answers are kept per directory and keyed on a digest of the token (the token itself is
 * never stored), so the profile is asked again only when the token changed. A read that
 * fails — a Keychain dialog, an expired token, no network — keeps the last answer rather
 * than dropping to the rewritable cache, and is not retried within the freshness window, so
 * a waiting dialog is not brought back on every poll.
 */
export function createProfiles(deps: ProfileDeps = liveDeps) {
  const cache = new Map<string, { at: number; token: string; identity: ProfileIdentity | null }>();
  const digest = (token: string) => createHash("sha256").update(token).digest("hex");

  /** `manual`: a person asked and waits for a Keychain dialog. `refresh`: skip the window. */
  async function identityOf(
    dir: string,
    defaultDir: string,
    options: { manual?: boolean; refresh?: boolean } = {},
  ): Promise<ProfileIdentity | null> {
    const now = (deps.now ?? Date.now)();
    const entry = cache.get(dir);
    if (!options.refresh && entry !== undefined && now - entry.at < FRESH_FOR_MS) return entry.identity;
    const keep = (): ProfileIdentity | null => {
      cache.set(dir, { at: now, token: entry?.token ?? "", identity: entry?.identity ?? null });
      return entry?.identity ?? null;
    };

    let credential: Credential;
    try {
      credential = await deps.readCredential(await serviceName(dir, defaultDir), options.manual ? null : BACKGROUND_TIMEOUT_MS);
    } catch {
      return keep();
    }
    const token = digest(credential.token);
    // The same token is the same grant, and a grant belongs to one account for good.
    if (entry !== undefined && entry.token === token && entry.identity !== null) {
      cache.set(dir, { ...entry, at: now });
      return entry.identity;
    }
    if (credential.expiresAt !== null && credential.expiresAt <= now) return keep();
    try {
      const response = await deps.request(credential.token);
      if (response.status === 200) {
        const identity = parseProfile(await response.text());
        cache.set(dir, { at: now, token, identity });
        return identity;
      }
    } catch {
      // network or parse failure: fall through and keep what was known
    }
    return keep();
  }

  return { identityOf };
}
