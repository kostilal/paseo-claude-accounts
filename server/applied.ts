import { canonical } from "../shared/path.ts";
import { PROVIDERS, type ProviderId, envFor } from "../shared/providers.ts";
import { type CliProvider, type SessionDir, liveLoginDir } from "./sessionDir.ts";
import type { OpenRecord } from "./sessionLedger.ts";

/** What the evidence says about a restarted session and the account it was asked to take. */
export interface Applied {
  /** `match`: the session runs on the account. `mismatch`: the hook gave it another one, or none.
   *  `unknown`: nothing says either way. */
  verdict: "match" | "mismatch" | "unknown";
  reason: string;
}

export interface AppliedInput {
  /** The last open of the chat the hook recorded. */
  record: OpenRecord | undefined;
  /** The chat's CLI process as it is now, if there is one. */
  live: SessionDir;
  provider: CliProvider;
  target: { provider: ProviderId; home: string };
  defaultDir: string;
  /** When the switch began, ms since the epoch: an open before it says nothing about the switch. */
  since: number;
}

/**
 * Whether a restarted session took the account it was switched to. The hook's record is the
 * evidence that exists right after a restart: the environment of a session is fixed when it
 * opens, and Claude Code only starts with the chat's next turn, so there may be no process yet.
 * A process that agrees is proof on its own; one that disagrees with the record is not taken for
 * either, since it may be the old one still shutting down.
 */
export function judgeApplied(input: AppliedInput): Applied {
  const { record, live, target } = input;
  const expected = envFor(target, input.defaultDir)[PROVIDERS[input.provider].credVar];

  if (record !== undefined && record.at >= input.since) {
    const process = live.found ? canonical(liveLoginDir(live, input.provider, input.defaultDir)) : null;
    const given = record.injected;
    if (given === expected) {
      if (process === null || process === canonical(target.home)) return { verdict: "match", reason: "" };
      return { verdict: "unknown", reason: "the hook gave the new session this account, but a running process still uses another login" };
    }
    if (process !== null && process === canonical(target.home)) return { verdict: "match", reason: "" };
    return given === undefined
      ? { verdict: "mismatch", reason: "the hook left the session alone: it opened on its own folder's login, not on the account asked for" }
      : { verdict: "mismatch", reason: "the session was opened on another account than the one asked for" };
  }

  if (live.found && canonical(liveLoginDir(live, input.provider, input.defaultDir)) === canonical(target.home)) {
    return { verdict: "match", reason: "" };
  }
  return {
    verdict: "unknown",
    reason: live.found
      ? "a running process uses another login, and no session has opened since the switch began"
      : "no session has opened since the switch began, and no process is running yet",
  };
}
