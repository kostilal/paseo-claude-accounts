/** A directory path without trailing slashes. Shared so the Keychain service hash and the
 *  cwd-to-project match always agree on what a path is. */
export function canonical(path: string): string {
  return path.replace(/\/+$/, "");
}
