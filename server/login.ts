import type { PaseoApi } from "@getpaseo/client";
import type { ProviderId } from "../shared/providers.ts";
import { SHELL_CONFIG_DIR, findClaude, shellDirArg } from "./claude.ts";
import { type TerminalResult, openTerminal } from "./terminal.ts";

/** `$1` is the config directory (empty for `~/.claude`), `$2` the `claude` executable. */
export const CLAUDE_LOGIN_SCRIPT = `${SHELL_CONFIG_DIR}; exec "$2" auth login`;

/** Codex refuses to start in a directory that does not exist, so it is created first. */
export const CODEX_LOGIN_SCRIPT = 'mkdir -p "$1" && CODEX_HOME="$1" exec codex login';

/**
 * A terminal running the provider's login for one config directory. The daemon cannot see
 * whether the browser step finishes; the screen picks the new login up on its next poll.
 */
export async function openLogin(
  paseo: PaseoApi,
  provider: ProviderId,
  dir: string,
  name: string,
  claude: () => Promise<string> = () => findClaude(),
): Promise<TerminalResult> {
  if (provider === "codex") {
    return openTerminal(paseo, `codex login — ${name}`, CODEX_LOGIN_SCRIPT, [dir]);
  }
  return openTerminal(paseo, `claude auth login — ${name}`, CLAUDE_LOGIN_SCRIPT, [
    shellDirArg(dir),
    await claude(),
  ]);
}
