import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { record } from "../shared/parse.ts";
import type { Bar } from "../shared/parse.ts";
import type { UsageResult } from "./usage.ts";

/**
 * Limits a login has run into, read from Claude Code's own transcripts.
 *
 * The usage endpoint stopped reporting the 5-hour window for some plans (`five_hour: null`,
 * also while the window is exhausted), so the meter read "fine" for an account whose chats
 * were being refused. Claude Code still records every refusal in the chat's transcript, with
 * the window and its reset time (`quotaLimits`), and records whose login the session runs on
 * (`session-owner` lines with the account and organisation uuids). A refusal is pinned on the
 * owner line before it, since a chat moved to another account keeps writing the same file.
 */

/** Windows Claude Code names in `quotaLimits.rateLimitType`, as the meter calls them. */
const WINDOWS = { five_hour: "fiveHour", seven_day: "sevenDay" } as const;
type WindowKey = (typeof WINDOWS)[keyof typeof WINDOWS];

/** Files untouched for longer are not read the first time round. A 5-hour refusal cannot be
 *  older than this and still hold; a weekly one can, but the endpoint still reports that
 *  window, and reading a week of transcripts (often gigabytes) on start would cost too much. */
const LOOKBACK_MS = 6 * 60 * 60 * 1000;
/** Most bytes read at once, so one huge transcript is not held in memory whole. */
const CHUNK_BYTES = 8 * 1024 * 1024;
/** Scans are triggered by reads, which the pill and screen do often. */
const SCAN_EVERY_MS = 60_000;

export interface QuotaHit {
  accountId: string;
  orgId: string;
  window: WindowKey;
  /** When the window opens again, ms since the epoch. */
  resetsAt: number;
}

interface Owner {
  accountId: string;
  orgId: string;
}

/** What is known of one transcript after reading it up to `offset`. */
interface FileState {
  offset: number;
  /** The owner in force at `offset`. */
  owner: Owner | null;
  /** A line cut off by the end of the file, finished by the next read. */
  partial: string;
  hits: QuotaHit[];
}

/** Reads transcript lines in order, keeping the owner in force and collecting refusals.
 *  Lines that are not JSON or carry neither are skipped. */
export function readLines(lines: readonly string[], start: Owner | null): { owner: Owner | null; hits: QuotaHit[] } {
  let owner = start;
  const hits: QuotaHit[] = [];
  for (const line of lines) {
    // Cheap filter first: most lines are neither, and some are megabytes long.
    if (!line.includes('"session-owner"') && !line.includes('"quotaLimits"')) continue;
    let entry: Record<string, unknown>;
    try {
      entry = record(JSON.parse(line));
    } catch {
      continue;
    }
    if (entry.type === "session-owner") {
      const accountId = entry.accountUuid;
      const orgId = entry.organizationUuid;
      if (typeof accountId === "string" && typeof orgId === "string" && accountId !== "") owner = { accountId, orgId };
      continue;
    }
    const quota = record(entry.quotaLimits);
    if (quota.status !== "rejected" || owner === null) continue;
    const window = WINDOWS[quota.rateLimitType as keyof typeof WINDOWS];
    const resetsAt = quota.resetsAt;
    if (window === undefined || typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) continue;
    hits.push({ ...owner, window, resetsAt: resetsAt * 1000 });
  }
  return { owner, hits };
}

/** Each bar `withHits` made, with the endpoint's own one it stands in for. */
const replaced = new WeakMap<Bar, Bar | null>();

/** The endpoint's own bar behind `bar`: what is saved for the forecast, which models the
 *  endpoint's numbers and not a refusal laid over them. */
export function rawBar(bar: Bar | null): Bar | null {
  if (bar === null) return null;
  return replaced.has(bar) ? (replaced.get(bar) ?? null) : bar;
}

/** `result` with every live refusal of its login shown as a full window resetting when the
 *  refusal said. A window the endpoint already reports as full is left as it is. Readings
 *  that carry no numbers (expired, error) stay as they are: the caller tries another of the
 *  login's directories. */
export function withHits(result: UsageResult, hits: readonly QuotaHit[], now: number): UsageResult {
  if (result.state !== "ok" && result.state !== "none") return result;
  const live = hits.filter((hit) => hit.resetsAt > now);
  if (live.length === 0) return result;
  const next: UsageResult = { ...result, state: "ok" };
  for (const key of Object.values(WINDOWS)) {
    const resetsAt = Math.max(...live.filter((hit) => hit.window === key).map((hit) => hit.resetsAt));
    if (!Number.isFinite(resetsAt)) continue;
    const reported: Bar | null = result[key];
    if (reported !== null && reported.utilization >= 100) continue;
    const full: Bar = { utilization: 100, resetsAt: new Date(resetsAt).toISOString() };
    replaced.set(full, reported);
    next[key] = full;
  }
  return next;
}

export interface QuotaFs {
  /** Entries of a directory; [] when it cannot be read. */
  list(path: string): Promise<string[]>;
  /** Size and modification time, or null when it is not a file. */
  stat(path: string): Promise<{ size: number; mtimeMs: number } | null>;
  /** Bytes `from` to `to` of a file, as text. */
  read(path: string, from: number, to: number): Promise<string>;
}

const nodeFs: QuotaFs = {
  list: (path) => readdir(path).catch(() => []),
  stat: (path) =>
    stat(path).then(
      (found) => (found.isFile() ? { size: found.size, mtimeMs: found.mtimeMs } : null),
      () => null,
    ),
  read: async (path, from, to) => {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(to - from);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  },
};

/**
 * Refusals per login, kept up to date by reading transcripts incrementally: each file is read
 * from where the last scan stopped, so a scan costs what was written since.
 */
export function createQuotaHits(deps: { fs?: QuotaFs; now?: () => number } = {}) {
  const fs = deps.fs ?? nodeFs;
  const now = deps.now ?? Date.now;
  const files = new Map<string, FileState>();
  const homes = new Set<string>();
  let lastScan = -Infinity;
  let running: Promise<void> | null = null;

  async function readFile(path: string): Promise<FileState | null> {
    const found = await fs.stat(path);
    if (found === null) {
      files.delete(path);
      return null;
    }
    let state = files.get(path);
    // Rewritten or truncated: read again from the start.
    if (state === undefined || found.size < state.offset) {
      if (now() - found.mtimeMs > LOOKBACK_MS) return null;
      state = { offset: 0, owner: null, partial: "", hits: [] };
    }
    while (found.size > state.offset) {
      const to = Math.min(found.size, state.offset + CHUNK_BYTES);
      const text: string = state.partial + (await fs.read(path, state.offset, to));
      const lines = text.split("\n");
      const partial = lines.pop() ?? "";
      const read: { owner: Owner | null; hits: QuotaHit[] } = readLines(lines, state.owner);
      const live: QuotaHit[] = [...state.hits, ...read.hits].filter((hit) => hit.resetsAt > now());
      state = { offset: to, owner: read.owner, partial, hits: live };
    }
    files.set(path, state);
    return state;
  }

  async function scanHome(home: string): Promise<void> {
    const projects = join(home, "projects");
    for (const project of await fs.list(projects)) {
      const folder = join(projects, project);
      for (const name of await fs.list(folder)) {
        if (!name.endsWith(".jsonl")) continue;
        // Subagent transcripts are not read: they have no owner lines of their own, and the
        // chat's owner as it stands now may not be the one their refusal hit once the chat was
        // moved. The chat's own thread records its refusal when it next asks.
        await readFile(join(folder, name));
      }
    }
  }

  async function scan(): Promise<void> {
    lastScan = now();
    for (const home of homes) await scanHome(home).catch(() => undefined);
    for (const state of files.values()) state.hits = state.hits.filter((hit) => hit.resetsAt > now());
  }

  return {
    /** Adds config directories whose transcripts are read from now on. */
    watch(dirs: Iterable<string>): void {
      for (const dir of dirs) homes.add(dir);
    },
    /** Reads what was written since the last scan, at most once a minute; a scan already running
     *  is shared. */
    refresh(): Promise<void> {
      if (running !== null) return running;
      if (now() - lastScan < SCAN_EVERY_MS) return Promise.resolve();
      running = scan().finally(() => {
        running = null;
      });
      return running;
    },
    /** Live refusals of one login. */
    of(accountId: string, orgId: string): QuotaHit[] {
      const found: QuotaHit[] = [];
      for (const state of files.values()) {
        for (const hit of state.hits) {
          if (hit.accountId === accountId && hit.orgId === orgId && hit.resetsAt > now()) found.push(hit);
        }
      }
      return found;
    },
  };
}
