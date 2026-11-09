import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { bar, usageState } from "../shared/accounts.ts";
import { createSerial } from "./serial.ts";
import type { Entry } from "./usage.ts";

const entry = z.object({
  at: z.number(),
  measuredAt: z.number(),
  heldUntil: z.number().nullable(),
  result: z.object({ state: usageState, fiveHour: bar.nullable(), sevenDay: bar.nullable(), error: z.string() }),
  freshFor: z.number().optional(),
  onForce: z.enum(["retake", "floor", "keep"]),
});

const stored = z.record(z.string(), entry);

export interface ReadingsDeps {
  path: string;
  log?(line: string): void;
}

/** What the file holds. Absent or unreadable: nothing kept, and the next save replaces it. */
function readKept(path: string): Record<string, Entry> {
  try {
    return stored.parse(JSON.parse(readFileSync(path, "utf8"))) as Record<string, Entry>;
  } catch {
    return {};
  }
}

/**
 * The usage readings a plugin reload or a daemon restart must not lose: each directory's last
 * numbers and the wait a 429 asked for, since asking again inside it only earns another 429.
 * Read once and synchronously, because the plugin starts synchronously and the cache is read
 * that way. Mode 0600. Nothing here ever throws to the caller.
 */
export function createReadings(deps: ReadingsDeps) {
  const log = deps.log ?? ((line: string) => console.error(line));
  const serial = createSerial();
  const kept = readKept(deps.path);

  return {
    load: (): Array<[string, Entry]> => Object.entries(kept),

    /** Resolves in every case: a failed write is logged. */
    save(dir: string, reading: Entry): Promise<void> {
      kept[dir] = reading;
      const text = JSON.stringify(kept);
      return serial(async () => {
        await mkdir(dirname(deps.path), { recursive: true });
        const temp = `${deps.path}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temp, text, { encoding: "utf8", mode: 0o600 });
        await rename(temp, deps.path);
      }).catch((error: unknown) => {
        log(`accounts: could not save the usage readings: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
  };
}
