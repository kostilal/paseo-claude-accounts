import { timeoutSignal } from "./net.ts";
import type { Identity } from "../shared/parse.ts";
import { canonical } from "../shared/path.ts";
import { type Registry, tokenKey } from "../shared/registry.ts";

const TOKEN = /sk-ant-oat[0-9]{2}-[A-Za-z0-9_-]+/g;
const TOKEN_TAIL = /^[A-Za-z0-9_-]+/;
/** Shorter than any real token; prefixes below this are not tried. */
const MIN_TOKEN_LENGTH = 100;

/** Terminal escape sequences: OSC, CSI, charset selection, and the two-byte modes. */
const ESCAPES = [
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,
  /\x1b[[?][0-9;?]*[ -/]*[@-~]/g,
  /\x1b[()#%][A-Za-z0-9]/g,
  /\x1b[=>78]/g,
];

/**
 * Every plausible reading of the token in a `claude setup-token` terminal transcript,
 * longest first.
 *
 * `setup-token` prints the token for a person, not a program: it arrives wrapped in
 * escape sequences and may be split across two lines at the terminal's width, or glued to
 * the word after it. So each match is tried as is, joined with the start of the next line
 * when it runs to the end of its own, and, for joined readings, cut back to every shorter
 * prefix. The caller checks each candidate against the API and keeps the first that works.
 */
export function tokenCandidates(transcript: string): string[] {
  let text = transcript;
  for (const escape of ESCAPES) text = text.replace(escape, "");
  const lines = text.split("\n").map((line) => line.replace(/\r+$/, ""));

  const found: string[] = [];
  lines.forEach((line, index) => {
    for (const match of line.matchAll(TOKEN)) {
      const end = match.index + match[0].length;
      const next = lines[index + 1];
      if (end === line.trimEnd().length && next !== undefined) {
        const tail = TOKEN_TAIL.exec(next.trimStart());
        if (tail !== null) found.push(match[0] + tail[0]);
      }
      found.push(match[0]);
    }
  });
  for (const candidate of [...found]) {
    for (let length = candidate.length - 1; length >= MIN_TOKEN_LENGTH; length -= 1) {
      found.push(candidate.slice(0, length));
    }
  }
  return [...new Set(found)].sort((a, b) => b.length - a.length);
}

export interface FinishDeps {
  /** The organisation the API says this token bills ("" when it does not say), or null
   *  when the API does not accept the token. */
  validate(token: string): Promise<string | null>;
  /** The email `claude auth status` reports for this token, or "" when it does not say. */
  whoami(token: string): Promise<string>;
  /** Who the config directory itself is logged in as. */
  identify(home: string): Promise<Identity>;
  writeToken(login: string, token: string): Promise<void>;
  readRegistry(): Promise<Registry>;
  writeRegistry(value: Registry): Promise<void>;
}

export type FinishResult =
  | { ok: true; login: string }
  | { ok: false; reason: "no-token" | "no-login" }
  /** The browser approved the key for another organisation than the one the directory is
   *  signed in to; `org` names the directory's. */
  | { ok: false; reason: "wrong-org"; org: string };

/**
 * Turns a finished `setup-token` transcript into a stored token: the first candidate the
 * API accepts is filed in the Keychain under the login and organisation it belongs to, and
 * the account at `home` records them as `tokenLogin` and `tokenOrg`.
 *
 * The login comes from the token itself where possible. `setup-token` authorises whoever is
 * signed in to the browser, which need not be the account the directory is signed in as;
 * the directory's own login is only the fallback. The organisation is not allowed to differ:
 * one email can hold a personal plan and a Team seat, and a key for the wrong one would bill
 * an allowance the pill does not show, so such a key is refused and nothing is written.
 */
export async function finishMint(home: string, transcript: string, deps: FinishDeps): Promise<FinishResult> {
  let token: string | null = null;
  let org = "";
  for (const candidate of tokenCandidates(transcript)) {
    const accepted = await deps.validate(candidate);
    if (accepted !== null) {
      token = candidate;
      org = accepted;
      break;
    }
  }
  if (token === null) return { ok: false, reason: "no-token" };

  const dir = canonical(home);
  // Asked at most once, and only when needed: it runs `claude auth status`.
  let directory: Promise<Identity | null> | null = null;
  const identifyDir = () => (directory ??= deps.identify(dir).catch(() => null));

  if (org !== "") {
    const own = await identifyDir();
    if (own?.loggedIn && own.orgId && own.orgId !== org) {
      return { ok: false, reason: "wrong-org", org: own.orgName };
    }
  }

  let login = await deps.whoami(token).catch(() => "");
  if (login === "") login = (await identifyDir())?.email ?? "";
  if (login === "") return { ok: false, reason: "no-login" };

  const filed = { tokenLogin: login, ...(org === "" ? {} : { tokenOrg: org }) };
  await deps.writeToken(tokenKey(filed)!, token);
  const registry = await deps.readRegistry();
  if (registry.accounts.some((account) => account.home === dir)) {
    await deps.writeRegistry({
      ...registry,
      accounts: registry.accounts.map((account) => {
        if (account.home !== dir) return account;
        // A key minted without a known organisation must not keep a previous one's.
        const { tokenOrg: _previous, ...rest } = account;
        return { ...rest, ...filed };
      }),
    });
  }
  return { ok: true, login };
}

const MODELS_ENDPOINT = "https://api.anthropic.com/v1/models?limit=1";

/** The organisation a token the API recognises bills, read from the
 *  `anthropic-organization-id` header ("" when the answer does not carry it), or null for a
 *  token it does not recognise. 200, or 403 for a valid token without access to this
 *  endpoint, is recognised; 401 and anything else is not the token. Never logs the token. */
export async function validateToken(token: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher(MODELS_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
      },
      signal: timeoutSignal(15_000),
    });
    if (response.status !== 200 && response.status !== 403) return null;
    return response.headers.get("anthropic-organization-id") ?? "";
  } catch {
    return null;
  }
}

/** Whether Anthropic still accepts a switching key: `rejected` only for a 401, which is what
 *  an expired or revoked token gets. Anything else that is not a yes (a timeout, no network,
 *  a 5xx) is `unknown`, and callers must not treat it as a broken key. */
export async function tokenStatus(
  token: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<"ok" | "rejected" | "unknown"> {
  try {
    const response = await fetcher(MODELS_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
      },
      signal: timeoutSignal(timeoutMs),
    });
    if (response.status === 200 || response.status === 403) return "ok";
    return response.status === 401 ? "rejected" : "unknown";
  } catch {
    return "unknown";
  }
}
