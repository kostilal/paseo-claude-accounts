import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadings } from "./readings.ts";
import type { Entry } from "./usage.ts";

async function tempFile() {
  const dir = await mkdtemp(join(tmpdir(), "accounts-readings-"));
  return join(dir, "usage-readings.json");
}

function entry(over: Partial<Entry> = {}): Entry {
  return {
    at: 1000,
    measuredAt: 1000,
    heldUntil: null,
    result: { state: "ok", fiveHour: null, sevenDay: { utilization: 62, resetsAt: "2026-11-12T00:00:00Z" }, error: "" },
    onForce: "floor",
    ...over,
  };
}

test("what one run saves the next one loads, in a file only its owner can read", async () => {
  const path = await tempFile();
  const first = createReadings({ path });
  const plain = entry();
  const held = entry({ at: 2000, heldUntil: 9000, freshFor: 7000, onForce: "keep" });
  await first.save("/h/a", plain);
  await first.save("/h/b", held);
  assert.deepEqual(new Map(createReadings({ path }).load()), new Map([["/h/a", plain], ["/h/b", held]]));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("a new save replaces that directory's reading and leaves the others", async () => {
  const path = await tempFile();
  const first = createReadings({ path });
  await first.save("/h/a", entry());
  await first.save("/h/b", entry());
  const next = createReadings({ path });
  const newer = entry({ at: 5000, measuredAt: 5000 });
  await next.save("/h/a", newer);
  assert.deepEqual(new Map(createReadings({ path }).load()), new Map([["/h/a", newer], ["/h/b", entry()]]));
});

test("saves made together end on the last of them", async () => {
  const path = await tempFile();
  const readings = createReadings({ path });
  const last = entry({ at: 3000, measuredAt: 3000 });
  await Promise.all([readings.save("/h/a", entry()), readings.save("/h/a", entry({ at: 2000 })), readings.save("/h/a", last)]);
  assert.deepEqual(new Map(createReadings({ path }).load()), new Map([["/h/a", last]]));
});

test("a missing file or one that cannot be read is nothing kept", async () => {
  const missing = await tempFile();
  assert.deepEqual([...createReadings({ path: missing }).load()], []);
  const broken = await tempFile();
  await writeFile(broken, "{not json");
  assert.deepEqual([...createReadings({ path: broken }).load()], []);
  const wrong = await tempFile();
  await writeFile(wrong, JSON.stringify({ "/h/a": { at: "soon" } }));
  assert.deepEqual([...createReadings({ path: wrong }).load()], []);
});

test("a failed write is logged and rejects nothing", async () => {
  const blocker = await tempFile();
  await writeFile(blocker, "a file where a directory is needed");
  const lines: string[] = [];
  const readings = createReadings({ path: join(blocker, "usage-readings.json"), log: (line) => lines.push(line) });
  await readings.save("/h/a", entry());
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /could not save/);
});
