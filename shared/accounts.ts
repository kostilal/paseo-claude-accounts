import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const bar = z.object({ utilization: z.number(), resetsAt: z.string() });

/** `unauthorised`: the Keychain has not been read for this account yet; the row shows a
 *  button instead of a meter. `unsupported`: the provider has no usage endpoint (Codex
 *  reports limits only in live response headers). `none`: the endpoint answered with no
 *  usage windows. */
export const usageState = z.enum(["unauthorised", "ok", "expired", "none", "error", "unsupported"]);

export const accountView = z.object({
  /** Unique row id. For a registered row, `switchTo` (or the lowest member of `accountIds`
   *  when the login cannot be switched to); for an unregistered suggestion, its absolute
   *  directory. Actions on the login itself address `switchTo`. */
  id: z.string(),
  /** The registry's label for the directory `id` points at. Rows are titled by their
   *  login (`loginLabel`); this is the fallback when the login is unknown. */
  name: z.string(),
  /** The config directory: one of possibly several holding this login (see `accountIds`). */
  home: z.string().default(""),
  provider: z.string().default("claude"),
  /** False for a discovered directory not yet added. Its `id` is an absolute path, which
   *  cannot collide with a registry id (a slug never starts with a slash). */
  registered: z.boolean().default(true),
  /** The login key from shared/identity.ts. */
  key: z.string().default(""),
  loggedIn: z.boolean(),
  /** The parts a row is titled by, joined with `loginLabel` (which calls
   *  `subscriptionType` `plan`). */
  email: z.string().default(""),
  orgName: z.string().default(""),
  subscriptionType: z.string().default(""),
  /** Every registry account whose directory holds this login, sorted. Empty for a
   *  suggestion. */
  accountIds: z.array(z.string()).default([]),
  /** The account id a press switches to, chosen deterministically by the server. Empty for
   *  a suggestion, and for a registered row exactly when `loggedIn` is false. */
  switchTo: z.string().default(""),
  /** Whether new chats of this provider open on this login ("Move all chats here" chose it). */
  isDefault: z.boolean().default(false),
  /** Under Auto: whether this is the login Auto would pick for a new chat now. */
  autoNow: z.boolean().default(false),
  usage: usageState.default("unauthorised"),
  fiveHour: bar.nullable().default(null),
  sevenDay: bar.nullable().default(null),
  /** A code the client translates (the daemon does not know the locale). Empty when
   *  `usageError` carries raw text instead. */
  usageErrorCode: z.enum(["", "unknown-account"]).default(""),
  usageError: z.string().default(""),
});

/** A directory the user removed from the list, shown under "Show hidden" so it can be
 *  brought back. Named by its login when discovery still finds it, else by its folder. */
export const hiddenView = z.object({
  home: z.string(),
  name: z.string(),
  loggedIn: z.boolean().default(false),
  email: z.string().default(""),
  orgName: z.string().default(""),
});

export const overview = z.object({
  accounts: z.array(accountView),
  /** Every home in the registry's `hidden`, in the order it was hidden. */
  hidden: z.array(hiddenView).default([]),
  /** `claude-not-found`: no `claude` command, so no directory could be identified. */
  error: z.enum(["", "claude-not-found"]).default(""),
  /** A variable such as `ANTHROPIC_API_KEY` that makes Claude Code ignore the account
   *  token, so switching has no effect; "" when there is none. */
  overridingVar: z.string().default(""),
});

export type Bar = z.output<typeof bar>;
export type UsageState = z.output<typeof usageState>;
export type AccountView = z.output<typeof accountView>;
export type HiddenView = z.output<typeof hiddenView>;
export type Overview = z.output<typeof overview>;

export const listAccounts = defineRpc({
  name: "accounts.list",
  input: z.object({
    refresh: z.boolean().default(false),
    /** The Reload button: `refresh`, plus usage re-measured instead of read from cache. */
    force: z.boolean().default(false),
  }),
  output: overview,
});

export const fetchUsage = defineRpc({
  name: "accounts.usage",
  input: z.object({ account: z.string() }),
  output: accountView,
});

export const loginAccount = defineRpc({
  name: "accounts.login",
  input: z.object({ account: z.string() }),
  output: z.object({
    terminal: z.string(),
    /** A case the client can translate. Empty when `error` carries raw text instead. */
    code: z.enum(["", "no-workspace", "unknown-account"]).default(""),
    /** Free text for unanticipated failures. */
    error: z.string().default(""),
  }),
});

/** Registers an account. With `login: true` it also creates the directory if needed and
 *  opens a login terminal; with `login: false` it registers an already logged-in directory. */
export const connectAccount = defineRpc({
  name: "accounts.connect",
  input: z.object({
    provider: z.string(),
    /** An absolute path, or "" to let the daemon create a fresh directory in the home
     *  folder. It need not exist yet; the login fills it. */
    home: z.string().default(""),
    /** Empty to name it after its directory. */
    label: z.string().default(""),
    login: z.boolean().default(true),
  }),
  output: z.object({
    /** The registered account's id, empty when `code` is set. */
    account: z.string().default(""),
    terminal: z.string().default(""),
    code: z
      .enum(["", "not-absolute", "unsupported-provider", "already-registered", "no-workspace"])
      .default(""),
    error: z.string().default(""),
  }),
});

/** Takes accounts off the list. Non-destructive: no directory is deleted, no Keychain item
 *  touched, nobody logged out. Bound chats are unbound and the directories are hidden so
 *  discovery does not offer them straight back. `accounts` may mix registry ids and absolute
 *  paths (a row can span several directories). All or nothing. */
export const removeAccount = defineRpc({
  name: "accounts.remove",
  input: z.object({ accounts: z.array(z.string()).min(1) }),
  output: z.object({
    /** Registry ids deleted, sorted. Empty when only a suggestion was hidden, or on a code. */
    removed: z.array(z.string()).default([]),
    /** Homes newly hidden from suggestions, sorted. */
    hidden: z.array(z.string()).default([]),
    /** `unknown-account`: a target named nothing; nothing was written.
     *  `registry-unreadable`: the state file exists but cannot be read, so writing would
     *  replace it with an almost empty one. */
    code: z.enum(["", "unknown-account", "registry-unreadable"]).default(""),
    error: z.string().default(""),
  }),
});

/** Lets hidden directories back into discovery as suggestions. Nothing is registered;
 *  homes that are not hidden are skipped. */
export const unhideAccount = defineRpc({
  name: "accounts.unhide",
  input: z.object({ homes: z.array(z.string()).min(1) }),
  output: z.object({
    /** Homes taken out of `hidden`, sorted. */
    restored: z.array(z.string()).default([]),
    /** `registry-unreadable`: as for `accounts.remove`. */
    code: z.enum(["", "registry-unreadable"]).default(""),
    error: z.string().default(""),
  }),
});
