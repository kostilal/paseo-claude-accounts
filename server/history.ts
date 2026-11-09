import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Bar } from "../shared/parse.ts";
import type { Sample, SampleWindow } from "../shared/forecast.ts";
import { createSerial } from "./serial.ts";
import type { UsageResult } from "./usage.ts";

/** A week to forecast from and a day beyond it, so the oldest full day still has one to compare with. */
const KEEP_MS = 8 * 24 * 3_600_000;

/** Time, then the 5-hour window's used and reset, then the week's; null for what is not there. */
type Row = [number, number | null, number | null, number | null, number | null];

export interface HistoryDeps {
  path: string;
  now?(): number;
  log?(line: string): void;
}

function windowOf(bar: Bar | null): SampleWindow | null {
  if (bar === null) return null;
  const at = Date.parse(bar.resetsAt);
  return { used: bar.utilization, resetsAt: Number.isFinite(at) ? at : null };
}

function rowOf(t: number, result: UsageResult): Row {
  const five = windowOf(result.fiveHour);
  const week = windowOf(result.sevenDay);
  return [t, five?.used ?? null, five?.resetsAt ?? null, week?.used ?? null, week?.resetsAt ?? null];
}

function sampleOf(row: Row): Sample {
  const [t, fiveUsed, fiveResets, weekUsed, weekResets] = row;
  return {
    t,
    five: fiveUsed === null ? null : { used: fiveUsed, resetsAt: fiveResets },
    week: weekUsed === null ? null : { used: weekUsed, resetsAt: weekResets },
  };
}

const sameFigures = (a: Row, b: Row) => a.slice(1).every((value, i) => value === b[i + 1]);

/** `rows` with `next` added: within a stretch of identical readings only its first and latest
 *  are kept, so a quiet night costs two rows, and nothing older than the week and a day. */
export function appended(rows: readonly Row[], next: Row, now: number): Row[] {
  const last = rows[rows.length - 1];
  const before = rows[rows.length - 2];
  const flat = last !== undefined && before !== undefined && sameFigures(before, last) && sameFigures(last, next);
  return [...(flat ? rows.slice(0, -1) : rows), next].filter((row) => now - row[0] <= KEEP_MS);
}

const isRow = (value: unknown): value is Row =>
  Array.isArray(value) && value.length === 5 && typeof value[0] === "number" && value.slice(1).every((part) => part === null || typeof part === "number");

/** What the file holds, or nothing when it is missing or not ours: it is rebuilt from new readings. */
function parsed(text: string): Map<string, Row[]> {
  const body = JSON.parse(text) as { homes?: unknown };
  const homes = typeof body.homes === "object" && body.homes !== null ? (body.homes as Record<string, unknown>) : {};
  return new Map(Object.entries(homes).map(([home, rows]) => [home, Array.isArray(rows) ? rows.filter(isRow) : []]));
}

/**
 * The usage readings of each config directory, on disk, so the forecast knows the recent pace
 * and survives a daemon restart. Every reading the plugin takes anyway lands here: this adds no
 * request to the rate-limited endpoint. Kept per directory because that is where a reading comes
 * from; a login held in several directories reads them merged. Holds percentages and reset
 * times, no secrets. Nothing here ever throws to the caller.
 */
export function createHistory(deps: HistoryDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.error(line));
  const serial = createSerial();
  let rows = new Map<string, Row[]>();
  let loading: Promise<void> | null = null;

  function load(): Promise<void> {
    loading ??= readFile(deps.path, "utf8").then(
      (text) => {
        try {
          rows = parsed(text);
        } catch {
          log(`accounts: ${deps.path} could not be read; the history starts over`);
        }
      },
      () => {},
    );
    return loading;
  }

  async function write(): Promise<void> {
    await mkdir(dirname(deps.path), { recursive: true });
    const temp = `${deps.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 1, homes: Object.fromEntries(rows) }), { encoding: "utf8", mode: 0o600 });
    await rename(temp, deps.path);
  }

  return {
    /** Adds one reading. Resolves in every case: a failed write is logged and tried with the next. */
    record(home: string, result: UsageResult, measuredAt: number): Promise<void> {
      if (result.state !== "ok") return Promise.resolve();
      return serial(async () => {
        await load();
        rows.set(home, appended(rows.get(home) ?? [], rowOf(measuredAt, result), now()));
        await write();
      }).catch((error: unknown) => {
        log(`accounts: could not save the usage history: ${error instanceof Error ? error.message : String(error)}`);
      });
    },

    /** Every reading of these directories, oldest first. */
    async samplesOf(homes: readonly string[]): Promise<Sample[]> {
      await load();
      return [...new Set(homes)]
        .flatMap((home) => rows.get(home) ?? [])
        .sort((a, b) => a[0] - b[0])
        .map(sampleOf);
    },
  };
}
