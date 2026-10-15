import type { PluginButtonRegistration } from "@getpaseo/plugin/client";

/**
 * The two agent update kinds the registry acts on. Declared structurally because
 * @getpaseo/client is not an allowed client-bundle import.
 */
export type AgentUpdate =
  | { kind: "upsert"; agent: { id: string; workspaceId?: string } }
  | { kind: "remove"; agentId: string };

export interface PillRegistry {
  /** Seeds agents that already exist; the update stream only reports changes. */
  seed(entries: ReadonlyArray<{ agentId: string; workspaceId: string }>): void;
  apply(update: AgentUpdate): void;
  /** Removes every live registration. Idempotent; nothing applied afterwards does anything. */
  stop(): void;
}

/**
 * One pill registration per agent, keyed by agentId. Free of React so it can be tested.
 *
 * A repeat upsert removes and recreates the pill: `update()` cannot change a registration's
 * workspaceId, and the wire never proves the workspace is unchanged.
 */
export function createPillRegistry(deps: {
  attach(agentId: string, workspaceId: string): PluginButtonRegistration;
}): PillRegistry {
  const pills = new Map<string, PluginButtonRegistration>();
  let stopped = false;

  function attach(agentId: string, workspaceId: string) {
    if (stopped) return;
    pills.get(agentId)?.remove();
    pills.set(agentId, deps.attach(agentId, workspaceId));
  }

  return {
    seed(entries) {
      for (const entry of entries) attach(entry.agentId, entry.workspaceId);
    },
    apply(update) {
      if (stopped) return;
      if (update.kind === "remove") {
        pills.get(update.agentId)?.remove();
        pills.delete(update.agentId);
        return;
      }
      if (update.kind !== "upsert" || !update.agent.workspaceId) return;
      attach(update.agent.id, update.agent.workspaceId);
    },
    stop() {
      stopped = true;
      for (const registration of pills.values()) registration.remove();
      pills.clear();
    },
  };
}

/** The two calls made on `client.paseo.agents`, declared structurally like AgentUpdate. */
export interface AgentSource<Update> {
  list(options: { subscribe: {} }): Promise<{
    entries: ReadonlyArray<unknown>;
    subscription?: { release(): Promise<void> };
  }>;
  subscribe(handler: (update: Update) => void): () => void;
}

/** An entry's agent (`entry.agent`, or the entry itself on older hosts), if it is a Claude
 *  agent. Only Claude sessions get a pill: the session-open hook only injects Claude tokens. */
function claudeAgent(raw: unknown): { agentId: string; workspaceId: string } | null {
  const probe = (raw ?? {}) as Record<string, unknown>;
  const agent = (probe.agent ?? probe) as Record<string, unknown>;
  if (agent.provider !== "claude") return null;
  if (typeof agent.id !== "string" || typeof agent.workspaceId !== "string" || agent.workspaceId === "") return null;
  return { agentId: agent.id, workspaceId: agent.workspaceId };
}

/**
 * Feeds the registry every existing and future Claude agent. Returns a stop function.
 *
 * The list must be a subscribing one: since Paseo 0.10 the daemon streams `agent_update`
 * only to clients holding a list subscription, and `agents.subscribe()` is just a local
 * listener. Without it, chats opened after load never get a pill.
 */
export function trackClaudeAgents<Update>(agents: AgentSource<Update>, registry: PillRegistry): () => void {
  let stopped = false;
  let release: (() => Promise<void>) | null = null;

  const unsubscribe = agents.subscribe((raw) => {
    const update = raw as unknown as AgentUpdate & { agent?: { provider?: string } };
    if (update.kind === "upsert" && update.agent.provider !== "claude") return;
    registry.apply(update);
  });

  void agents
    .list({ subscribe: {} })
    .then((result) => {
      const subscription = result.subscription;
      if (subscription !== undefined) release = () => subscription.release();
      if (stopped) {
        void release?.().catch(() => {});
        return;
      }
      const entries: Array<{ agentId: string; workspaceId: string }> = [];
      for (const entry of result.entries) {
        const agent = claudeAgent(entry);
        if (agent !== null) entries.push(agent);
      }
      registry.seed(entries);
    })
    .catch(() => {
      // Nothing to seed; the listener still receives updates.
    });

  return () => {
    stopped = true;
    unsubscribe();
    void release?.().catch(() => {});
    registry.stop();
  };
}
