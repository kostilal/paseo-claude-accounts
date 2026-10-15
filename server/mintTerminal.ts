import type { PaseoApi } from "@getpaseo/client";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SHELL_CONFIG_DIR, shellDirArg } from "./claude.ts";
import type { FinishResult } from "./mint.ts";
import { type TerminalResult, openTerminal } from "./terminal.ts";

/**
 * The script a mint terminal runs. `claude setup-token` waits on a browser and only
 * renders on a tty, so it runs where a person can see it, under `script` to keep a
 * transcript. The daemon reads that transcript, files the token, and leaves a one-line
 * result for the terminal to print.
 *
 * `$1` config directory (empty for `~/.claude`), `$2` claude, `$3` transcript, `$4` done
 * marker, `$5` result file, `$6` label. `umask 077` keeps the transcript, which holds the
 * token until the daemon deletes it, readable by the user alone.
 */
export const MINT_SCRIPT = `set -u
umask 077
${SHELL_CONFIG_DIR}
claude="$2"; transcript="$3"; done="$4"; result="$5"; label="$6"
printf '\\n== %s\\n== A browser will open. Approve access with the account you want this to bill, then come back here.\\n\\n' "$label"
cols="$(stty size 2>/dev/null | cut -d' ' -f2)"
stty cols 400 2>/dev/null
script -q "$transcript" "$claude" setup-token
[ -n "$cols" ] && stty cols "$cols" 2>/dev/null
: > "$done"
printf '\\n== Checking the key...\\n'
i=0
while [ ! -s "$result" ] && [ "$i" -lt 60 ]; do sleep 0.5; i=$((i + 1)); done
if [ -s "$result" ]; then cat "$result"; else printf '== Paseo will pick the key up on its next refresh. You can close this terminal.\\n'; fi
rm -f "$result"
`;

/** A mint whose terminal never finished is cleaned up after this long. */
const ABANDONED_AFTER_MS = 30 * 60_000;
const POLL_MS = 1_000;

const RESULT_TEXT: Record<"ok" | FinishResultReason | "error", (login: string) => string> = {
  ok: (login) => `== Done. Chats can now be switched to ${login}. You can close this terminal.\n`,
  "no-token": () => "!! No working key was found in the output. Close this terminal and try again.\n",
  "no-login": () => "!! Could not tell which account the key belongs to. Close this terminal and try again.\n",
  error: () => "!! The key could not be saved to the Keychain. Close this terminal and try again.\n",
};

type FinishResultReason = Extract<FinishResult, { ok: false }>["reason"];

interface Files {
  meta: string;
  transcript: string;
  done: string;
  result: string;
}

function filesFor(dir: string, id: string): Files {
  return {
    meta: join(dir, `${id}.json`),
    transcript: join(dir, `${id}.transcript`),
    done: join(dir, `${id}.done`),
    result: join(dir, `${id}.result`),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export interface MintsOptions {
  dir: string;
  finish(home: string, transcript: string): Promise<FinishResult>;
  log(line: string): void;
}

/**
 * Mint terminals and the work of finishing them. While a mint is pending its directory is
 * checked every second; every read of account state also calls `adopt`, so a mint that
 * finished while the daemon was busy is still picked up.
 */
export function createMints(options: MintsOptions) {
  const { dir, finish, log } = options;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<boolean> | null = null;
  /** Bumped by every `open`, so a pass that found nothing pending does not stop the timer
   *  a mint opened meanwhile has just started. */
  let generation = 0;

  async function pending(): Promise<string[]> {
    try {
      return (await readdir(dir)).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
    } catch {
      return [];
    }
  }

  async function adoptOne(id: string): Promise<boolean> {
    const files = filesFor(dir, id);
    let meta: { home?: unknown; at?: unknown };
    try {
      meta = JSON.parse(await readFile(files.meta, "utf8"));
    } catch {
      await rm(files.meta, { force: true });
      return false;
    }
    if (!(await exists(files.done))) {
      if (typeof meta.at === "number" && Date.now() - meta.at > ABANDONED_AFTER_MS) {
        await Promise.all([files.meta, files.transcript, files.done].map((path) => rm(path, { force: true })));
      }
      return false;
    }
    const transcript = await readFile(files.transcript, "utf8").catch(() => "");
    await Promise.all([files.transcript, files.done].map((path) => rm(path, { force: true })));
    let text: string;
    let changed = false;
    try {
      const outcome = typeof meta.home === "string" ? await finish(meta.home, transcript) : null;
      if (outcome?.ok) {
        changed = true;
        log(`accounts: token saved for ${outcome.login}`);
        text = RESULT_TEXT.ok(outcome.login);
      } else {
        const reason = outcome?.reason ?? "no-token";
        log(`accounts: mint finished without a token (${reason})`);
        text = RESULT_TEXT[reason]("");
      }
    } catch (error) {
      log(`accounts: mint failed: ${error instanceof Error ? error.message : String(error)}`);
      text = RESULT_TEXT.error("");
    }
    await writeFile(files.result, text, { mode: 0o600 }).catch(() => {});
    await rm(files.meta, { force: true });
    return changed;
  }

  /** Finishes every mint whose terminal is done. Resolves to whether any token was saved.
   *  Concurrent callers share one pass, so a mint is never finished twice. */
  function adopt(): Promise<boolean> {
    running ??= (async () => {
      const started = generation;
      let changed = false;
      for (const id of await pending()) changed = (await adoptOne(id)) || changed;
      if (generation === started && (await pending()).length === 0) stopWatching();
      return changed;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  function watch() {
    if (timer !== null) return;
    timer = setInterval(() => void adopt().catch((error) => log(`accounts: mint check failed: ${String(error)}`)), POLL_MS);
    timer.unref?.();
  }

  function stopWatching() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  async function open(paseo: PaseoApi, home: string, name: string, claude: string): Promise<TerminalResult> {
    generation += 1;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const files = filesFor(dir, `${Date.now()}-${randomUUID()}`);
    await writeFile(files.meta, JSON.stringify({ home, at: Date.now() }), { mode: 0o600 });
    const opened = await openTerminal(paseo, `claude setup-token — ${name}`, MINT_SCRIPT, [
      shellDirArg(home),
      claude,
      files.transcript,
      files.done,
      files.result,
      name,
    ]).catch(async (error: unknown) => {
      await rm(files.meta, { force: true });
      throw error;
    });
    if (opened.code !== "") await rm(files.meta, { force: true });
    else watch();
    return opened;
  }

  return { open, adopt, stop: stopWatching };
}
