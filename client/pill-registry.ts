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
 * The daemon reports an agent again on every change while it works, and the host keeps a
 * popover's open state on its registration, so a pill is only replaced when the agent's
 * workspace changes (`update()` cannot move a registration to another workspace). Replacing
 * it on every report would close an open popover each time the agent printed something.
 */
export function createPillRegistry(deps: {
  attach(agentId: string, workspaceId: string): PluginButtonRegistration;
}): PillRegistry {
  const pills = new Map<string, { registration: PluginButtonRegistration; workspaceId: string }>();
  let stopped = false;

  function attach(agentId: string, workspaceId: string) {
    if (stopped) return;
    const current = pills.get(agentId);
    if (current !== undefined && current.workspaceId === workspaceId) return;
    current?.registration.remove();
    pills.set(agentId, { registration: deps.attach(agentId, workspaceId), workspaceId });
  }

  return {
    seed(entries) {
      for (const entry of entries) attach(entry.agentId, entry.workspaceId);
    },
    apply(update) {
      if (stopped) return;
      if (update.kind === "remove") {
        pills.get(update.agentId)?.registration.remove();
        pills.delete(update.agentId);
        return;
      }
      if (update.kind !== "upsert" || !update.agent.workspaceId) return;
      attach(update.agent.id, update.agent.workspaceId);
    },
    stop() {
      stopped = true;
      for (const { registration } of pills.values()) registration.remove();
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

/** An entry's agent (`entry.agent`, or the entry itself on older hosts) with its provider, or
 *  null when it has no id or no workspace to attach a pill to. */
function agentOf(raw: unknown): { agentId: string; workspaceId: string; provider: string } | null {
  const probe = (raw ?? {}) as Record<string, unknown>;
  const agent = (probe.agent ?? probe) as Record<string, unknown>;
  if (typeof agent.id !== "string" || typeof agent.workspaceId !== "string" || agent.workspaceId === "") return null;
  return { agentId: agent.id, workspaceId: agent.workspaceId, provider: typeof agent.provider === "string" ? agent.provider : "" };
}

/**
 * Feeds the registry every existing and future Claude agent. Returns a stop function.
 *
 * The list must be a subscribing one: since Paseo 0.10 the daemon streams `agent_update`
 * only to clients holding a list subscription, and `agents.subscribe()` is just a local
 * listener. Without it, chats opened after load never get a pill.
 *
 * A Claude agent is one whose provider `providers` names: Claude's own and every custom
 * provider (profile) extending it. They are asked alongside the list, and again once for
 * each provider seen later that they did not name, so a profile added while the app runs gets
 * pills too. When they cannot be asked, only Claude's own chats get one.
 */
export function trackClaudeAgents<Update>(
  agents: AgentSource<Update>,
  registry: PillRegistry,
  providers: () => Promise<readonly string[]> = async () => ["claude"],
): () => void {
  let stopped = false;
  let release: (() => Promise<void>) | null = null;
  const claude = new Set<string>(["claude"]);
  const asked = new Set<string>();
  /** Agents reported by the update stream: the list's snapshot is older than what it says. */
  const reported = new Set<string>();
  /** The latest known state of each agent whose provider is not (yet) known to be Claude's.
   *  Applied as soon as an answer names its provider, so no chat waits for its next update. */
  const pending = new Map<string, { agentId: string; workspaceId: string; provider: string }>();

  function flush() {
    if (stopped) return;
    for (const [agentId, agent] of pending) {
      if (!claude.has(agent.provider)) continue;
      pending.delete(agentId);
      registry.apply({ kind: "upsert", agent: { id: agentId, workspaceId: agent.workspaceId } });
    }
  }

  function ask() {
    void providers().then(
      (ids) => {
        for (const id of ids) claude.add(id);
        flush();
      },
      () => {},
    );
  }

  /** Attaches a Claude agent now; holds any other until an answer names its provider, asking
   *  once per provider not named before. */
  function place(agent: { agentId: string; workspaceId: string; provider: string }) {
    if (claude.has(agent.provider)) {
      pending.delete(agent.agentId);
      registry.apply({ kind: "upsert", agent: { id: agent.agentId, workspaceId: agent.workspaceId } });
      return;
    }
    pending.set(agent.agentId, agent);
    if (agent.provider === "" || asked.has(agent.provider)) return;
    asked.add(agent.provider);
    ask();
  }

  const unsubscribe = agents.subscribe((raw) => {
    const update = raw as unknown as AgentUpdate & { agent?: { provider?: string } };
    if (update.kind === "remove") {
      reported.add(update.agentId);
      pending.delete(update.agentId);
      registry.apply(update);
      return;
    }
    if (update.kind !== "upsert") return;
    reported.add(update.agent.id);
    const agent = agentOf(update.agent);
    if (agent === null) {
      pending.delete(update.agent.id);
      return;
    }
    place(agent);
  });

  // The providers are asked side by side with the list: a slow answer must not hold back the
  // subscription or Claude's own chats; profiles' chats follow when it comes.
  ask();
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
        const agent = agentOf(entry);
        if (agent === null || reported.has(agent.agentId)) continue;
        if (claude.has(agent.provider)) entries.push(agent);
        else pending.set(agent.agentId, agent);
      }
      registry.seed(entries);
      flush();
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
