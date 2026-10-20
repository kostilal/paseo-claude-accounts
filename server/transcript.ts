import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface TranscriptFs {
  readdir(path: string): Promise<string[]>;
  isFile(path: string): Promise<boolean>;
}

const nodeFs: TranscriptFs = {
  readdir: (path) => readdir(path),
  isFile: (path) => stat(path).then((found) => found.isFile(), () => false),
};

/**
 * Whether Claude Code has written the transcript of `sessionId` under any of `homes`
 * (`<home>/projects/<project>/<sessionId>.jsonl`). Session ids are unique, so every project
 * folder is looked in rather than working out how Claude Code names the chat's.
 */
export async function transcriptExists(
  sessionId: string,
  homes: readonly string[],
  fs: TranscriptFs = nodeFs,
): Promise<boolean> {
  for (const home of homes) {
    const projects = join(home, "projects");
    const folders = await fs.readdir(projects).catch(() => [] as string[]);
    for (const folder of folders) {
      if (await fs.isFile(join(projects, folder, `${sessionId}.jsonl`))) return true;
    }
  }
  return false;
}

/** How long after a chat is created its first turn may still be unsaved. Claude Code writes the
 *  transcript seconds into that turn; the margin keeps a slow first turn covered. Older chats
 *  are never held back, so a transcript in a folder this plugin does not know about can delay a
 *  switch by this much at most, not forever. The price: the age is the chat's, not its first
 *  turn's, so a chat left empty for longer than this and switched in the first seconds of its
 *  first turn is not protected. */
export const FIRST_TURN_MS = 10 * 60 * 1000;

/**
 * Whether restarting a chat now would break it. Paseo records a Claude session's id as soon as
 * the session starts, but Claude Code writes the transcript only some seconds into the first
 * turn; a restart in between makes Paseo resume a session that was never saved, and every later
 * message fails with "No conversation found". A chat with no session yet starts afresh, and one
 * whose transcript is on disk resumes it, so both are safe. Only a chat created in the last
 * `FIRST_TURN_MS` can be in its first turn; when its age is unknown it is let through.
 */
export async function unsavedSession(
  session: { provider: string; sessionId: string | null; createdAt?: string | null },
  hasTranscript: (sessionId: string) => Promise<boolean>,
  now: number = Date.now(),
): Promise<boolean> {
  if (session.provider !== "claude" || session.sessionId === null || session.sessionId === "") return false;
  const created = Date.parse(session.createdAt ?? "");
  if (Number.isNaN(created) || now - created > FIRST_TURN_MS) return false;
  return !(await hasTranscript(session.sessionId));
}
