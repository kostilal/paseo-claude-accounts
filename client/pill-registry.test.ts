import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginButtonRegistration } from "@getpaseo/plugin/client";
import { createPillRegistry, trackClaudeAgents } from "./pill-registry.ts";

/** Records only what the registry itself ever calls on a registration: remove(). */
function spyRegistration(): PluginButtonRegistration & { removeCalls: number } {
  return {
    removeCalls: 0,
    update() {},
    remove() {
      this.removeCalls += 1;
    },
  };
}

/** A fake attach(): hands back a fresh spy every call, so a test can tell "a new
 *  registration was made" apart from "the old one is still around". */
function stubAttach() {
  const created: Array<PluginButtonRegistration & { removeCalls: number }> = [];
  return {
    created,
    attach(_agentId: string, _workspaceId: string): PluginButtonRegistration {
      const registration = spyRegistration();
      created.push(registration);
      return registration;
    },
  };
}

test("seed attaches every entry from an already-fetched list", () => {
  const { attach, created } = stubAttach();
  const registry = createPillRegistry({ attach });
  registry.seed([
    { agentId: "a", workspaceId: "w" },
    { agentId: "b", workspaceId: "w" },
  ]);
  assert.equal(created.length, 2);
});

test("a remove for an agent nobody attached is a harmless no-op", () => {
  const { attach, created } = stubAttach();
  const registry = createPillRegistry({ attach });
  registry.apply({ kind: "remove", agentId: "ghost" });
  assert.equal(created.length, 0);
});

test("upsert, then remove, then upsert again: never a revived registration, never a double one", () => {
  const { attach, created } = stubAttach();
  const registry = createPillRegistry({ attach });

  registry.apply({ kind: "upsert", agent: { id: "a", workspaceId: "w" } });
  assert.equal(created.length, 1, "the first upsert creates one registration");
  const first = created[0];
  assert.equal(first.removeCalls, 0);

  registry.apply({ kind: "remove", agentId: "a" });
  assert.equal(first.removeCalls, 1, "the tracked registration is removed exactly once");
  assert.equal(created.length, 1, "remove does not itself create anything");

  registry.apply({ kind: "upsert", agent: { id: "a", workspaceId: "w" } });
  assert.equal(created.length, 2, "the re-upsert creates a fresh registration rather than reviving the dead one");
  const second = created[1];
  assert.notEqual(second, first);
  assert.equal(second.removeCalls, 0, "the fresh registration is untouched");
  // Proves the map dropped the dead registration rather than keeping it alongside.
  assert.equal(first.removeCalls, 1, "the dead registration is not removed a second time");
});

test("a repeat upsert without an intervening remove replaces rather than duplicates", () => {
  const { attach, created } = stubAttach();
  const registry = createPillRegistry({ attach });

  registry.apply({ kind: "upsert", agent: { id: "a", workspaceId: "w" } });
  const first = created[0];
  registry.apply({ kind: "upsert", agent: { id: "a", workspaceId: "w2" } });

  assert.equal(created.length, 2, "a fresh registration is made for the repeat report");
  assert.equal(first.removeCalls, 1, "the old one is removed before the new one is created — never two live at once");
});

test("an upsert missing a workspaceId is ignored rather than attached with a hole in it", () => {
  const { attach, created } = stubAttach();
  const registry = createPillRegistry({ attach });
  registry.apply({ kind: "upsert", agent: { id: "a" } });
  assert.equal(created.length, 0);
});

test("stop removes every live registration, and anything applied afterwards does nothing", () => {
  const { attach, created } = stubAttach();
  const registry = createPillRegistry({ attach });

  registry.apply({ kind: "upsert", agent: { id: "a", workspaceId: "w" } });
  registry.apply({ kind: "upsert", agent: { id: "b", workspaceId: "w" } });
  registry.stop();

  assert.equal(created[0].removeCalls, 1);
  assert.equal(created[1].removeCalls, 1);

  registry.apply({ kind: "upsert", agent: { id: "c", workspaceId: "w" } });
  registry.apply({ kind: "remove", agentId: "a" });

  assert.equal(created.length, 2, "nothing new is created once stopped");
  assert.equal(created[0].removeCalls, 1, "nothing already-removed is touched again");
  assert.equal(created[1].removeCalls, 1);
});

/** A fake of the two calls trackClaudeAgents makes on `client.paseo.agents`. */
function fakeAgents(entries: unknown[]) {
  const calls: unknown[] = [];
  let handler: ((update: unknown) => void) | null = null;
  let released = 0;
  let unsubscribed = 0;
  return {
    calls,
    emit: (update: unknown) => handler?.(update),
    released: () => released,
    unsubscribed: () => unsubscribed,
    api: {
      async list(options: unknown) {
        calls.push(options);
        return {
          entries,
          subscription: {
            async release() {
              released += 1;
            },
          },
        };
      },
      subscribe(next: (update: unknown) => void) {
        handler = next;
        return () => {
          unsubscribed += 1;
        };
      },
    },
  };
}

// Paseo streams agent_update only to a client holding a list subscription.
test("tracking asks for a subscribing list, so chats opened later still get a pill", async () => {
  const { attach, created } = stubAttach();
  const agents = fakeAgents([
    { agent: { id: "a", workspaceId: "w", provider: "claude" } },
    { agent: { id: "x", workspaceId: "w", provider: "codex" } },
  ]);
  const stop = trackClaudeAgents(agents.api, createPillRegistry({ attach }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(agents.calls, [{ subscribe: {} }]);
  assert.equal(created.length, 1);
  agents.emit({ kind: "upsert", agent: { id: "b", workspaceId: "w", provider: "claude" } });
  agents.emit({ kind: "upsert", agent: { id: "y", workspaceId: "w", provider: "codex" } });
  assert.equal(created.length, 2);
  stop();
  assert.equal(agents.unsubscribed(), 1);
  assert.equal(agents.released(), 1);
});

test("a stop before the list answers still releases the subscription it gets", async () => {
  const { attach, created } = stubAttach();
  const agents = fakeAgents([{ agent: { id: "a", workspaceId: "w", provider: "claude" } }]);
  const stop = trackClaudeAgents(agents.api, createPillRegistry({ attach }));
  stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created.length, 0);
  assert.equal(agents.released(), 1);
});
