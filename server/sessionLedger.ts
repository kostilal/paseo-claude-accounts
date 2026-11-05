import { PROVIDERS, isProviderId } from "../shared/providers.ts";

/**
 * What the `agent.session_open` hook did the last time a chat's session opened. A session's
 * environment is fixed when it opens, and the CLI process only starts with its first turn, so
 * right after a restart there is no process to read: this record is the one place that says
 * which account the new session was given.
 */
export interface OpenRecord {
  /** When the hook answered, ms since the epoch. */
  at: number;
  /** Why Paseo opened it: create, resume, refresh or import. */
  reason: string;
  provider: string;
  /** The value of the provider's credential variable the hook set; "" selects the default
   *  directory. Undefined: the hook left the session as Paseo built it. */
  injected: string | undefined;
}

/** The part of the session-open request the ledger reads. */
export interface OpenedSession {
  agentId: string;
  provider: string;
  reason: string;
  purpose?: string;
}

/** The latest open of each chat, in memory: a restart of the daemon starts a new ledger, and
 *  every session opens afresh through the hook then anyway. The oldest are forgotten past `max`. */
export function createSessionLedger(max = 2000, now: () => number = Date.now) {
  const records = new Map<string, OpenRecord>();
  return {
    note(request: OpenedSession, env: Record<string, string> | undefined): void {
      // A history-only open reads a transcript and starts nothing.
      if (request.purpose === "history" || !isProviderId(request.provider)) return;
      // Deleted first, so insertion order stays the order of recency.
      records.delete(request.agentId);
      records.set(request.agentId, {
        at: now(),
        reason: request.reason,
        provider: request.provider,
        injected: env?.[PROVIDERS[request.provider].credVar],
      });
      while (records.size > max) {
        const oldest = records.keys().next().value;
        if (oldest === undefined) break;
        records.delete(oldest);
      }
    },
    last: (agentId: string): OpenRecord | undefined => records.get(agentId),
  };
}
