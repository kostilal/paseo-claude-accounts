/** `.claude` itself, or `.claude` followed by `-`, `_` or `.` and a name. */
export const CLAUDE_DIR = /^\.claude(?:[-_.].+)?$/;

/** A short name for a config directory: `~/.claude` is "default", `~/.claude-work` and
 *  `~/.claude-work-data` are "work", and a per-project `.claude-data` is named after the
 *  project folder. Pure string work, so it runs in both bundles. */
export function displayName(dir: string): string {
  const base = dir.slice(dir.lastIndexOf("/") + 1);
  if (base === ".claude-data") {
    const parent = dir.slice(0, dir.lastIndexOf("/"));
    return parent.slice(parent.lastIndexOf("/") + 1) || "default";
  }
  if (CLAUDE_DIR.test(base)) {
    const withoutPrefix = base.replace(/^\.claude[-_.]?/, "");
    const withoutSuffix = withoutPrefix.replace(/-data$/, "");
    return withoutSuffix === "" ? "default" : withoutSuffix;
  }
  if (base === ".codex" || base.startsWith(".codex-")) {
    const withoutPrefix = base.replace(/^\.codex-?/, "");
    return withoutPrefix === "" ? "default" : withoutPrefix;
  }
  return base;
}

/** `base`, or `base-2`, `base-3`… until one is free, so two directories with the same
 *  display name never share an account id. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
