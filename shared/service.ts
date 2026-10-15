import { canonical } from "./path.ts";

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The Keychain service Claude Code stores a config directory's credentials under: the bare
 *  name for the default directory, otherwise suffixed with the first eight hex characters of
 *  the SHA-256 of the directory's path. Uses Web Crypto because `shared/` is also bundled
 *  into the client, where `node:*` imports are not allowed. */
export async function serviceName(configDir: string, defaultDir: string): Promise<string> {
  const dir = canonical(configDir);
  if (dir === canonical(defaultDir)) return "Claude Code-credentials";
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(dir));
  return `Claude Code-credentials-${toHex(digest).slice(0, 8)}`;
}
