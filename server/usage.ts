import { timeoutSignal } from "./net.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { UsageState } from "../shared/accounts.ts";
import { type Bar, parseUsage } from "../shared/parse.ts";
import { tmpdir } from "node:os";
import { claudeEnv, findClaude } from "./claude.ts";
import { serviceName } from "../shared/service.ts";
import { type Credential, KeychainTimeout, NO_TOKEN, readCredential } from "./keychain.ts";

const run = promisify(execFile);

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const BACKGROUND_TIMEOUT_MS = 3_000;
/** Bounds the request so a stalled network cannot hold up callers that await usage
 *  (binding an account among them). */
const REQUEST_TIMEOUT_MS = 10_000;
const FRESH_FOR_MS = 10 * 60 * 1000;
/** How long an expired-token reading stands. Short, because it cost no request and Claude
 *  Code or a fresh login may write a new token at any time. Just under the screen's 30 s
 *  poll, so each poll reads afresh while pills polling alongside share that read. */
const EXPIRED_FRESH_FOR_MS = 25_000;
/** Minimum age before Reload repeats a reading that cost a request: the endpoint answers
 *  rapid polling with a 429 and a long wait. */
const FORCE_FLOOR_MS = 60_000;
/** How often one directory's expired token may be refreshed. */
const REFRESH_COOLDOWN_MS = 15 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 30_000;

export interface UsageResult {
  state: UsageState;
  fiveHour: Bar | null;
  sevenDay: Bar | null;
  error: string;
}

export interface UsageDeps {
  readCredential(service: string, timeoutMs: number | null): Promise<Credential>;
  request(token: string, userAgent: string): Promise<Response>;
  version(): Promise<string>;
  /** Has Claude Code refresh the access token stored for `dir`. */
  refresh?(dir: string): Promise<void>;
  now?(): number;
}

/** On a 429 the endpoint sends a `retry-after` of about 25 minutes; the last good reading
 *  is kept and nothing is asked again until the wait is over. This is the fallback wait. */
const DEFAULT_RETRY_AFTER_MS = 25 * 60 * 1000;

function retryAfterMs(response: Response): number {
  const header = response.headers?.get?.("retry-after") ?? null;
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
}

async function claudeVersion(): Promise<string> {
  try {
    const { stdout } = await run(await findClaude(), ["--version"], { timeout: 10_000 });
    return stdout.trim().split(" ")[0] ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const liveDeps: UsageDeps = {
  readCredential,
  request: (token, userAgent) =>
    fetch(ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": `claude-code/${userAgent}`,
      },
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    }),
  version: claudeVersion,
  // `/usage` is a local command: no model turn, no cost, but Claude Code refreshes its own
  // token first and writes it back to its own Keychain item. Refreshing through Claude Code
  // rather than with the refresh token directly avoids racing it over a rotating token.
  // No settings are loaded and nothing is saved, so the user's hooks and plugins stay out.
  refresh: async (dir) => {
    await run(
      await findClaude(),
      ["-p", "/usage", "--no-session-persistence", "--setting-sources", "local", "--output-format", "json"],
      { env: claudeEnv(dir), cwd: tmpdir(), timeout: REFRESH_TIMEOUT_MS },
    );
  },
};

/** Whether a failed Keychain read only means there is nothing there yet (no item: `security`
 *  exits 44; or no claude.ai token in it). A login fixes those, so Reload retries them; other
 *  failures (denied, locked) would only bring the same dialog back. */
function nothingThereYet(error: unknown): boolean {
  if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === 44) return true;
  return error instanceof Error && error.message === NO_TOKEN;
}

function blank(state: UsageState, error = ""): UsageResult {
  return { state, fiveHour: null, sevenDay: null, error };
}

interface Entry {
  at: number;
  result: UsageResult;
  /** How long this reading stands; FRESH_FOR_MS when absent. */
  freshFor?: number;
  /** What Reload may do inside the window. `retake`: expired or empty, which a login changes.
   *  `floor`: cost a request, so not again within FORCE_FLOOR_MS. `keep`: a Keychain dialog
   *  or a 429, where asking again only repeats the problem. */
  onForce: "retake" | "floor" | "keep";
}

/** Usage readings per config directory, with a cache. Callers check `authorised()` before
 *  reading in the background; a background read that hits a Keychain dialog is killed and
 *  the directory drops back to `unauthorised` rather than blocking the daemon. */
export function createUsage(deps: UsageDeps = liveDeps) {
  const authorisedDirs = new Set<string>();
  const cache = new Map<string, Entry>();
  const refreshedAt = new Map<string, number>();

  /** A fresh credential after a refresh, or null when none is allowed yet or it did not help. */
  async function refreshed(dir: string, service: string, timeoutMs: number | null): Promise<Credential | null> {
    const now = (deps.now ?? Date.now)();
    if (deps.refresh === undefined || now - (refreshedAt.get(dir) ?? -Infinity) < REFRESH_COOLDOWN_MS) return null;
    refreshedAt.set(dir, now);
    try {
      await deps.refresh(dir);
      const credential = await deps.readCredential(service, timeoutMs);
      return credential.expiresAt !== null && credential.expiresAt <= (deps.now ?? Date.now)() ? null : credential;
    } catch {
      return null;
    }
  }

  /** `manual`: a person pressed the button and waits for the Keychain dialog. Otherwise the
   *  read gets three seconds, and a timeout means a dialog is up. */
  async function measure(dir: string, defaultDir: string, manual: boolean): Promise<UsageResult> {
    const now = deps.now ?? Date.now;
    const timeoutMs = manual ? null : BACKGROUND_TIMEOUT_MS;
    const service = await serviceName(dir, defaultDir);
    let credential: Credential;
    try {
      credential = await deps.readCredential(service, timeoutMs);
    } catch (error) {
      if (error instanceof KeychainTimeout) {
        authorisedDirs.delete(dir);
        // Cached so background polls make one bounded attempt per freshness window.
        cache.set(dir, { at: now(), result: blank("unauthorised"), onForce: "keep" });
        return blank("unauthorised");
      }
      authorisedDirs.delete(dir);
      const result = blank("error", error instanceof Error ? error.message : String(error));
      cache.set(dir, { at: now(), result, onForce: nothingThereYet(error) ? "retake" : "keep" });
      return result;
    }

    authorisedDirs.add(dir);
    // Known expired without asking the rate-limited endpoint. Claude Code only refreshes a
    // token while it runs in that directory, so a directory nobody uses expires within hours.
    if (credential.expiresAt !== null && credential.expiresAt <= now()) {
      const fresh = await refreshed(dir, service, timeoutMs);
      if (fresh !== null) return read(dir, fresh, service, timeoutMs);
      const result = blank("expired");
      cache.set(dir, { at: now(), result, freshFor: EXPIRED_FRESH_FOR_MS, onForce: "retake" });
      return result;
    }
    return read(dir, credential, service, timeoutMs);
  }

  /** Asks the endpoint with a credential, refreshing once on a 401. */
  async function read(dir: string, credential: Credential, service: string, timeoutMs: number | null): Promise<UsageResult> {
    const now = deps.now ?? Date.now;
    let result: UsageResult;
    let onForce: Entry["onForce"] = "floor";
    try {
      const response = await deps.request(credential.token, await deps.version());
      if (response.status === 401) {
        const fresh = await refreshed(dir, service, timeoutMs);
        if (fresh !== null) return read(dir, fresh, service, timeoutMs);
        result = blank("expired");
        onForce = "retake";
      } else if (response.status === 429) {
        // Keep the last good reading and hold it until the wait is over.
        const previous = cache.get(dir)?.result ?? null;
        const wait = retryAfterMs(response);
        const kept = previous !== null && previous.state === "ok" ? previous : blank("error", "rate limited by the usage endpoint");
        cache.set(dir, { at: now(), result: kept, freshFor: wait, onForce: "keep" });
        return kept;
      } else {
        const meter = parseUsage(await response.text());
        result =
          meter.fiveHour === null && meter.sevenDay === null
            ? blank("none")
            : { state: "ok", fiveHour: meter.fiveHour, sevenDay: meter.sevenDay, error: "" };
      }
    } catch (error) {
      result = blank("error", error instanceof Error ? error.message : String(error));
    }
    cache.set(dir, { at: now(), result, onForce });
    return result;
  }

  return {
    measure,
    authorised: (dir: string) => authorisedDirs.has(dir),
    cached: (dir: string) => cache.get(dir)?.result ?? null,
    /** Whether a reading is due. `force` (the Reload button) may retake a fresh reading as
     *  far as its `onForce` allows. */
    stale: (dir: string, force = false) => {
      const entry = cache.get(dir);
      if (entry === undefined) return true;
      const age = (deps.now ?? Date.now)() - entry.at;
      if (age > (entry.freshFor ?? FRESH_FOR_MS)) return true;
      if (!force) return false;
      return entry.onForce === "retake" || (entry.onForce === "floor" && age > FORCE_FLOOR_MS);
    },
  };
}
