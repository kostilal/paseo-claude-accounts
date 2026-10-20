import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginButtonRegistration } from "@getpaseo/plugin/client";
import { trackWorkspaces } from "./workspace-registry.ts";

/** A fake `client.paseo.workspaces`: `entries` seed the list, `emit` sends an update. */
function source(entries: unknown[]) {
  let handler: ((update: unknown) => void) | null = null;
  let released = 0;
  return {
    api: {
      list: async () => ({ entries, subscription: { release: async () => void (released += 1) } }),
      subscribe: (next: (update: unknown) => void) => {
        handler = next;
        return () => {
          handler = null;
        };
      },
    },
    emit: (update: unknown) => handler?.(update),
    released: () => released,
  };
}

function buttons() {
  const live = new Map<string, number>();
  let made = 0;
  return {
    live,
    made: () => made,
    attach(workspaceId: string): PluginButtonRegistration {
      made += 1;
      live.set(workspaceId, (live.get(workspaceId) ?? 0) + 1);
      return {
        update() {},
        remove() {
          const left = (live.get(workspaceId) ?? 1) - 1;
          if (left === 0) live.delete(workspaceId);
          else live.set(workspaceId, left);
        },
      };
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("every listed workspace gets one button, except one being archived", async () => {
  const feed = source([{ id: "wks_1" }, { id: "wks_2", archivingAt: "2026-10-20T00:00:00Z" }, { id: "" }]);
  const b = buttons();
  trackWorkspaces(feed.api, (id) => b.attach(id));
  await settle();
  assert.deepEqual([...b.live.keys()], ["wks_1"]);
});

test("a workspace reported again keeps its button, so an open popover stays open", async () => {
  const feed = source([{ id: "wks_1" }]);
  const b = buttons();
  trackWorkspaces(feed.api, (id) => b.attach(id));
  await settle();
  feed.emit({ kind: "upsert", workspace: { id: "wks_1" } });
  feed.emit({ kind: "upsert", workspace: { id: "wks_1" } });
  assert.equal(b.made(), 1);
});

test("a new workspace gets a button; a removed or archiving one loses it", async () => {
  const feed = source([]);
  const b = buttons();
  trackWorkspaces(feed.api, (id) => b.attach(id));
  await settle();
  feed.emit({ kind: "upsert", workspace: { id: "wks_1" } });
  feed.emit({ kind: "upsert", workspace: { id: "wks_2" } });
  assert.deepEqual([...b.live.keys()].sort(), ["wks_1", "wks_2"]);
  feed.emit({ kind: "remove", id: "wks_1" });
  feed.emit({ kind: "upsert", workspace: { id: "wks_2", archivingAt: "2026-10-20T00:00:00Z" } });
  assert.deepEqual([...b.live.keys()], []);
});

test("stopping removes every button, releases the list and ignores later updates", async () => {
  const feed = source([{ id: "wks_1" }]);
  const b = buttons();
  const stop = trackWorkspaces(feed.api, (id) => b.attach(id));
  await settle();
  stop();
  feed.emit({ kind: "upsert", workspace: { id: "wks_2" } });
  assert.deepEqual([...b.live.keys()], []);
  assert.equal(feed.released(), 1);
});

test("stopping before the list answers attaches nothing and still releases it", async () => {
  const feed = source([{ id: "wks_1" }]);
  const b = buttons();
  const stop = trackWorkspaces(feed.api, (id) => b.attach(id));
  stop();
  await settle();
  assert.equal(b.made(), 0);
  assert.equal(feed.released(), 1);
});
