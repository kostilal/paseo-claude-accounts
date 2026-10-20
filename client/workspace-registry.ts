import type { PluginButtonRegistration } from "@getpaseo/plugin/client";

/**
 * The two workspace update kinds the registry acts on. Declared structurally because
 * @getpaseo/client is not an allowed client-bundle import.
 */
export type WorkspaceUpdate =
  | { kind: "upsert"; workspace: { id: string; archivingAt?: string | null } }
  | { kind: "remove"; id: string };

/** The two calls made on `client.paseo.workspaces`, declared structurally like WorkspaceUpdate. */
export interface WorkspaceSource<Update> {
  list(options: { subscribe: {} }): Promise<{
    entries: ReadonlyArray<unknown>;
    subscription?: { release(): Promise<void> };
  }>;
  subscribe(handler: (update: Update) => void): () => void;
}

/** An entry's workspace id, unless the workspace is being archived. */
function liveWorkspace(raw: unknown): string | null {
  const probe = (raw ?? {}) as Record<string, unknown>;
  const workspace = (probe.workspace ?? probe) as Record<string, unknown>;
  if (typeof workspace.id !== "string" || workspace.id === "") return null;
  if (typeof workspace.archivingAt === "string" && workspace.archivingAt !== "") return null;
  return workspace.id;
}

/**
 * One header button per workspace, kept in step with the daemon's workspaces. Returns a stop
 * function that removes every button. A workspace is attached once: the daemon reports it again
 * on every change, and replacing the button each time would close an open popover.
 *
 * The list must be a subscribing one, for the same reason as `trackClaudeAgents`: without it,
 * workspaces opened after load never get a button.
 */
export function trackWorkspaces<Update>(
  workspaces: WorkspaceSource<Update>,
  attach: (workspaceId: string) => PluginButtonRegistration,
): () => void {
  const buttons = new Map<string, PluginButtonRegistration>();
  let stopped = false;
  let release: (() => Promise<void>) | null = null;

  const add = (id: string) => {
    if (stopped || buttons.has(id)) return;
    // One workspace the host will not take must not cost the others their buttons.
    try {
      buttons.set(id, attach(id));
    } catch (error) {
      console.warn(`[claude-accounts] no header button for ${id}: ${String(error)}`);
    }
  };
  const drop = (id: string) => {
    buttons.get(id)?.remove();
    buttons.delete(id);
  };

  const unsubscribe = workspaces.subscribe((raw) => {
    if (stopped) return;
    const update = raw as unknown as WorkspaceUpdate;
    if (update.kind === "remove") return drop(update.id);
    if (update.kind !== "upsert") return;
    const id = liveWorkspace(update.workspace);
    if (id !== null) add(id);
    else if (typeof update.workspace?.id === "string") drop(update.workspace.id);
  });

  void workspaces
    .list({ subscribe: {} })
    .then((result) => {
      const subscription = result.subscription;
      if (subscription !== undefined) release = () => subscription.release();
      if (stopped) {
        void release?.().catch(() => {});
        return;
      }
      for (const entry of result.entries) {
        const id = liveWorkspace(entry);
        if (id !== null) add(id);
      }
    })
    .catch((error: unknown) => {
      // Nothing to seed; the listener still receives updates.
      console.warn(`[claude-accounts] could not list workspaces: ${String(error)}`);
    });

  return () => {
    stopped = true;
    unsubscribe();
    void release?.().catch(() => {});
    for (const button of buttons.values()) button.remove();
    buttons.clear();
  };
}
