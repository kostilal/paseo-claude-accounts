import type { PaseoApi } from "@getpaseo/client";

export type TerminalResult = { terminal: string; code: "" | "no-workspace"; error: string };

/**
 * Opens a Paseo terminal running `script` in a zsh login shell, so the user's PATH is
 * there. Values reach the script as positional arguments (`$1`, `$2`, …), never by being
 * spliced into its text, so a path with spaces or quotes stays one argument.
 *
 * `terminals.create` needs a workspace and the sidebar is not scoped to one, so any live
 * workspace hosts the shell. Having none open is reported as `no-workspace`.
 */
export async function openTerminal(
  paseo: PaseoApi,
  title: string,
  script: string,
  args: readonly string[],
): Promise<TerminalResult> {
  const workspaces = await paseo.workspaces.list();
  const live = workspaces.entries.find((entry) => entry.archivingAt === null);
  if (live === undefined) return { terminal: "", code: "no-workspace", error: "" };
  const handle = await paseo.terminals.create({
    workspaceId: live.id,
    name: title,
    command: "/bin/zsh",
    // The word after the script is `$0`, which names the script in error messages.
    args: ["-lc", script, "claude-accounts", ...args],
  });
  return { terminal: handle.id, code: "", error: "" };
}
