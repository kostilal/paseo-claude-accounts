import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { bar, usageState } from "./accounts.ts";

/** Every way a switch can decline, as codes the client translates. */
export const switchCode = z.enum([
  "",
  "unknown-account",
  "unsupported-provider",
  "missing-directory",
  /** The target directory exists but nobody is logged into it, so the hook would run the
   *  session on an empty login. Refused before anything is written; the remedy is to log in. */
  "not-logged-in",
  /** The chat's first turn has not been saved yet: a restart now would lose the conversation.
   *  Refused before anything is written; the remedy is to wait for the first reply. */
  "first-turn",
  "paseo-not-found",
  "reload-failed",
  /** No chat has exactly this id. */
  "unknown-chat",
  /** The chat is archived, and a restart would bring it back from the archive. */
  "archived",
  /** The account belongs to another provider than the chat: the hook would ignore it. */
  "provider-mismatch",
  /** The chat restarted, but the new session did not take the account; the binding was put back. */
  "not-applied",
]);

export type SwitchCode = z.output<typeof switchCode>;

export const switchAccountRpc = defineRpc({
  name: "accounts.switch",
  input: z.object({
    agentId: z.string(),
    /** The account id to move this one chat to. */
    account: z.string(),
  }),
  output: z.object({
    code: switchCode.default(""),
    /** The child process's message for `reload-failed`, or why `not-applied`; empty otherwise. */
    error: z.string().default(""),
    /** The account the chat was bound to before this call; "" when it had none. */
    from: z.string().default(""),
    /** The account the chat is bound to now because of this call; "" when nothing moved. */
    to: z.string().default(""),
    /** How sure it is that the chat took the account. `verified`: the hook gave the new session
     *  that account. `next-open`: a closed chat only changed its binding and takes the account when
     *  it next opens. `pending`: the restart was still running when the time was up. `unverified`:
     *  nothing says either way. "": not claimed. */
    applied: z.enum(["", "verified", "next-open", "pending", "unverified"]).default(""),
    /** A turn was in progress when the restart began and may have been cut off. */
    interrupted: z.boolean().default(false),
  }),
});

export const switchAllRpc = defineRpc({
  name: "accounts.switch-all",
  input: z.object({
    /** The account id to move every chat of its provider to, in every workspace, except
     *  chats in the middle of a turn. */
    account: z.string(),
  }),
  output: z.object({
    /** A refusal of the target, before anything was written. */
    code: switchCode.default(""),
    /** Chats now bound to the account. */
    moved: z.number().default(0),
    /** Of those, open chats restarted on it now; closed ones switch when they next open. */
    restarted: z.number().default(0),
    /** Open chats whose restart failed; they keep their previous account. */
    failed: z.number().default(0),
    /** Chats in the middle of a turn, or whose first turn is not saved yet, left on their
     *  account rather than cut off or broken. */
    skipped: z.number().default(0),
    /** The first failed restart's message; empty otherwise. */
    error: z.string().default(""),
  }),
});

export const pillAccount = z.object({
  /** The registry's label for the directory a press lands in (`switchTo`, or the lowest
   *  member of `accountIds`). Rows are titled by their login; this is the fallback, and what
   *  the "held in more than one directory" note names. */
  label: z.string(),
  /** The provider of the directory a press lands in. */
  provider: z.string().default("claude"),
  /** That directory. */
  home: z.string().default(""),
  /** The login key from shared/identity.ts; the row's identity. */
  key: z.string(),
  /** The parts a row is titled by, joined with `loginName`. */
  email: z.string().default(""),
  orgName: z.string().default(""),
  /** `Identity.subscriptionType`. */
  plan: z.string().default(""),
  /** `Identity.rateLimitTier`, which says a Max plan's multiple; "" when the profile did not say. */
  tier: z.string().default(""),
  /** Every registry account whose directory holds this login, sorted. */
  accountIds: z.array(z.string()).default([]),
  /** The account id a press switches to. Empty exactly when `loggedIn` is false. */
  switchTo: z.string().default(""),
  loggedIn: z.boolean(),
  /** True for the login the session runs on now (any member of `accountIds` matches). */
  current: z.boolean(),
  usage: usageState.default("unauthorised"),
  fiveHour: bar.nullable().default(null),
  sevenDay: bar.nullable().default(null),
  /** When the shown numbers were measured, ms since the epoch; null when nothing was. */
  usageAt: z.number().nullable().default(null),
  /** Until when a rate limit holds those numbers; null when none does. */
  heldUntil: z.number().nullable().default(null),
});

export const pillState = z.object({
  /** "" when nothing is bound or resolved. The pill's text comes from the row with
   *  `current: true`. */
  currentId: z.string().default(""),
  /** The higher of the current account's two utilizations, 0–100, or null when unknown. */
  tightest: z.number().nullable().default(null),
  accounts: z.array(pillAccount).default([]),
  /** `claude-not-found`: no directory could be identified, so every row reads logged out
   *  for that reason rather than because nobody is logged in. */
  error: z.enum(["", "claude-not-found"]).default(""),
  /** See `overview.overridingVar`. */
  overridingVar: z.string().default(""),
});

export type PillAccount = z.output<typeof pillAccount>;
export type PillState = z.output<typeof pillState>;

export const pillStateRpc = defineRpc({
  name: "accounts.pill",
  input: z.object({
    agentId: z.string(),
    cwd: z.string(),
    workspaceId: z.string().nullable().default(null),
    /** True when a person opened the popover; only then may a Keychain dialog appear. */
    manual: z.boolean().default(false),
  }),
  output: pillState,
});

/** The provider ids whose chats get a pill: ours that switch, and the custom providers
 *  (profiles) extending one of them. */
export const claudeProvidersRpc = defineRpc({
  name: "accounts.claude-providers",
  input: z.object({}),
  output: z.object({ providers: z.array(z.string()) }),
});
