import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { type AccountView, type Overview, overview } from "../shared/accounts.ts";
import { createSerial } from "./serial.ts";

/** How long the file may go without a write while the overview does not change. */
const REWRITE_AFTER_MS = 5 * 60 * 1000;

const stored = z.object({ savedAt: z.number(), overview });

export interface SnapshotDeps {
  path: string;
  now?(): number;
  log?(line: string): void;
}

export interface SnapshotAnswer {
  overview: Overview | null;
  savedAt: number | null;
}

const hasNumbers = (row: AccountView) => row.fiveHour !== null || row.sevenDay !== null;

/** `next`, with each row that lost its numbers to a failed reading given back its last good
 *  ones, matched by login key. A row whose reading did work stands, even with no numbers: an
 *  account that has no allowance to show (`none`) is an answer, not a loss. */
export function keepLastGood(next: Overview, previous: Overview | null): Overview {
  const before = new Map((previous?.accounts ?? []).map((row) => [row.key, row]));
  return {
    ...next,
    accounts: next.accounts.map((row) => {
      const last = before.get(row.key);
      if (last === undefined) return row;
      // The plan does not change with a failed profile read.
      const rateLimitTier = row.rateLimitTier !== "" ? row.rateLimitTier : last.rateLimitTier;
      if (!hasNumbers(last) || hasNumbers(row) || row.usage === "ok" || row.usage === "none") return { ...row, rateLimitTier };
      return {
        ...row,
        rateLimitTier,
        usage: last.usage,
        fiveHour: last.fiveHour,
        sevenDay: last.sevenDay,
        usageAt: last.usageAt,
        usageErrorCode: last.usageErrorCode,
        usageError: last.usageError,
      };
    }),
  };
}

/**
 * The last overview the Accounts screen was given, so a cold screen can open on it instead of
 * skeletons. In memory and in a file, which survives a daemon restart and holds emails: mode 0600.
 * A missing or unreadable file reads as no snapshot; nothing here ever throws to the caller.
 */
export function createSnapshot(deps: SnapshotDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.error(line));
  const serial = createSerial();
  let memory: { overview: Overview; savedAt: number } | null = null;
  // What the file holds, and when it was written.
  let written: { text: string; at: number } | null = null;
  let loading: Promise<void> | null = null;

  /** Reads the file once, the first time the snapshot is needed. */
  function load(): Promise<void> {
    loading ??= (async () => {
      try {
        const parsed = stored.parse(JSON.parse(await readFile(deps.path, "utf8")));
        memory = parsed;
        written = { text: JSON.stringify(parsed.overview), at: parsed.savedAt };
      } catch {
        // Absent or unreadable: no snapshot yet, and the next save replaces it.
      }
    })();
    return loading;
  }

  async function write(text: string): Promise<void> {
    await mkdir(dirname(deps.path), { recursive: true });
    const temp = `${deps.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, text, { encoding: "utf8", mode: 0o600 });
    await rename(temp, deps.path);
  }

  return {
    /** Queued behind any save under way, so a read right after an overview sees that overview. */
    read(): Promise<SnapshotAnswer> {
      return serial(async () => {
        await load();
        return memory ?? { overview: null, savedAt: null };
      });
    },

    /** Merges `next` over the last good numbers. Resolves in every case: a failed write is logged. */
    save(next: Overview): Promise<void> {
      return serial(async () => {
        await load();
        const merged = keepLastGood(next, memory?.overview ?? null);
        const savedAt = now();
        memory = { overview: merged, savedAt };
        const text = JSON.stringify(merged);
        if (written !== null && written.text === text && savedAt - written.at < REWRITE_AFTER_MS) return;
        await write(JSON.stringify({ savedAt, overview: merged }));
        written = { text, at: savedAt };
      }).catch((error: unknown) => {
        log(`accounts: could not save the overview snapshot: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
  };
}
