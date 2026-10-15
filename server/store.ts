import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Registry, emptyRegistry, parseRegistry } from "../shared/registry.ts";

/** Where this plugin keeps its state. Holds account records, chat bindings and nothing
 *  secret: tokens live in the Keychain. */
export const STATE_DIR = join(homedir(), ".paseo-claude-accounts");

export const STATE_FILE = join(STATE_DIR, "accounts.json");

/** Where mint terminals leave their transcripts while the daemon finishes them. */
export const MINTS_DIR = join(STATE_DIR, "mints");

/**
 * What the state file is. `absent` is a fresh install and safe to write over; `unreadable`
 * is somebody's state this version did not understand, and must not be overwritten with
 * an empty registry by the next read-modify-write.
 */
export type RegistryState = "absent" | "ok" | "unreadable";

export interface RegistryRead {
  registry: Registry;
  state: RegistryState;
}

/** The registry on disk, and which of the three cases produced it. */
export async function loadRegistry(path: string = STATE_FILE): Promise<RegistryRead> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    // Only ENOENT is `absent`; EACCES and friends leave the bytes where they were.
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return { registry: emptyRegistry(), state: code === "ENOENT" ? "absent" : "unreadable" };
  }
  let parsed: Registry | null;
  try {
    parsed = parseRegistry(JSON.parse(text));
  } catch {
    parsed = null;
  }
  return parsed === null
    ? { registry: emptyRegistry(), state: "unreadable" }
    : { registry: parsed, state: "ok" };
}

/** The registry alone, for callers that only read: absent and unreadable both mean "no
 *  accounts, no bindings". Writers go through `writeRegistry`, which checks for itself. */
export async function readRegistry(path: string = STATE_FILE): Promise<Registry> {
  return (await loadRegistry(path)).registry;
}

/** Where an unreadable file is moved before it is replaced. Timestamped, so nothing is lost twice. */
export function asidePath(path: string, now: Date = new Date()): string {
  return `${path}.unreadable-${now.toISOString().replace(/[:.]/g, "-")}`;
}

/**
 * Writes through a temp file and a rename, so a crash leaves the old file or the new one.
 * A file that exists but could not be read is moved aside first rather than overwritten;
 * if that move fails, nothing is written.
 */
export async function writeRegistry(
  value: Registry,
  path: string = STATE_FILE,
  log: (line: string) => void = (line) => console.error(line),
): Promise<void> {
  if ((await loadRegistry(path)).state === "unreadable") {
    const aside = asidePath(path);
    await rename(path, aside);
    log(`accounts: ${path} could not be read by this version; kept at ${aside} before writing a new one`);
  }
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}
