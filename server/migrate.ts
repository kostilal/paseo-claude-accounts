import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { STATE_FILE, loadRegistry, writeRegistry } from "./store.ts";

const run = promisify(execFile);

/** Claude Accounts 0.1.x filed a separate switching token per login in the Keychain under this
 *  service and recorded the login on the account as `tokenLogin`/`tokenOrg`. 0.2 runs every
 *  account on its directory's own login, so both are obsolete. Claude Code's own
 *  `Claude Code-credentials*` items are a different service and are never touched. */
const LEGACY_SERVICE = "paseo-claude-accounts";

/** Deletes every item in the plugin's own Keychain service, one at a time until none is left
 *  (`security` removes the first match per call). The whole service is the plugin's switching
 *  tokens, obsolete in 0.2, so there is nothing to keep — orphans from any earlier version go
 *  too. Capped so a `security` that always succeeds cannot loop for ever. */
async function purgeLegacyKeys(): Promise<void> {
  for (let n = 0; n < 1000; n += 1) {
    try {
      await run("security", ["delete-generic-password", "-s", LEGACY_SERVICE]);
    } catch {
      return; // none left (exit 44), or a Keychain that will not answer: best-effort
    }
  }
}

/**
 * Brings a 0.1.x install up to 0.2: deletes the obsolete switching tokens from the Keychain and
 * drops the `tokenLogin`/`tokenOrg` fields from the state file (`parseRegistry` ignores them, so
 * rewriting the registry is enough). Idempotent — a file without those fields is left untouched —
 * and best-effort: a Keychain that refuses is logged, not fatal.
 */
export async function migrateFromTokens(
  path: string = STATE_FILE,
  log: (line: string) => void = (line) => console.error(line),
  purge: () => Promise<void> = purgeLegacyKeys,
): Promise<void> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return; // no state file yet: a fresh install has nothing to migrate
  }
  if (!/"token(Login|Org)"\s*:/.test(text)) return; // already migrated

  try {
    JSON.parse(text);
  } catch {
    return; // unreadable; writeRegistry would move it aside, which migration must not do
  }
  await purge().catch((error: unknown) => log(`accounts: could not remove old switching keys: ${String(error)}`));

  const read = await loadRegistry(path);
  if (read.state !== "ok") return;
  await writeRegistry(read.registry, path, log);
  log("accounts: migrated to 0.2 (switching keys removed; accounts now run on their own login)");
}
