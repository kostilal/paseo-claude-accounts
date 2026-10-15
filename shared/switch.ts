import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { bar, usageState } from "./accounts.ts";

/** Every way a switch can decline, as codes the client translates. */
export const switchCode = z.enum([
  "",
  "unknown-account",
  "unsupported-provider",
  "missing-directory",
  /** The target has no minted token, so the hook would inject nothing and the chat would
   *  reopen on its old account. Refused before anything is written. */
  "no-token",
  /** The target directory exists but nobody is logged into it. Separate from `no-token`
   *  because the remedy differs (`codex login` rather than minting a token). */
  "not-logged-in",
  "paseo-not-found",
  "reload-failed",
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
    /** The child process's message for `reload-failed`; empty otherwise. */
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
  /** That directory, used by `accounts.mint-token`. */
  home: z.string().default(""),
  /** Whether a press can work: a minted token for a token switch, a login for a directory
   *  switch. Otherwise the row offers to mint a token. */
  hasToken: z.boolean().default(false),
  /** The login key from shared/identity.ts; the row's identity. */
  key: z.string(),
  /** The parts a row is titled by, joined with `loginLabel`. */
  email: z.string().default(""),
  orgName: z.string().default(""),
  /** `Identity.subscriptionType`. */
  plan: z.string().default(""),
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
