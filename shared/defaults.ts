import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { Strings } from "./i18n.ts";

/** Why the default account cannot open a new chat. Empty when it can, or when none is set. */
export const defaultProblem = z.enum([
  "",
  /** The default names an account that was removed (or a hand-edited id). */
  "unknown-account",
  /** The account has no switching key recorded, or the Keychain no longer holds it. */
  "no-token",
  /** Anthropic answered 401 to the key: it expired or was revoked. */
  "token-rejected",
  /** The account's directory is gone. */
  "missing-directory",
]);

export type DefaultProblem = z.output<typeof defaultProblem>;

/** Why a new chat was not started at all, so it never reaches Claude Code without a login. */
export type RefusalCode =
  | Exclude<DefaultProblem, "">
  /** No default is set and the chat's own directory is not logged in. */
  | "not-set"
  /** As `not-set`, and no account could be chosen as a default either. */
  | "no-accounts";

export const defaultOption = z.object({
  id: z.string(),
  /** The registry label. */
  label: z.string(),
  /** Whose subscription the account's switching key bills. */
  login: z.string().default(""),
});

export type DefaultOption = z.output<typeof defaultOption>;

export const getDefaultRpc = defineRpc({
  name: "accounts.default",
  input: z.object({ provider: z.string().default("claude") }),
  output: z.object({
    /** The default's account id, or "" when none is set. */
    account: z.string().default(""),
    /** Why that default cannot open a chat now; checked live (Keychain, then Anthropic). */
    problem: defaultProblem.default(""),
    /** The label of `account`, kept even when the account is gone so a problem can name it. */
    label: z.string().default(""),
    /** Accounts of this provider that can be chosen: Claude ones need a switching key. */
    options: z.array(defaultOption).default([]),
  }),
});

export const setDefaultRpc = defineRpc({
  name: "accounts.set-default",
  input: z.object({
    provider: z.string().default("claude"),
    /** The account new chats open on; "" clears the default. */
    account: z.string(),
  }),
  output: z.object({
    /** A refusal: nothing was written. */
    code: z.union([defaultProblem, z.enum(["registry-unreadable", "unsupported-provider"])]).default(""),
  }),
});

/** The sentence a refused chat, or the settings banner, shows. `{label}` and `{dir}` are
 *  the account's label and the chat's own config directory. */
export function refusalText(strings: Strings, code: RefusalCode, values: { label?: string; dir?: string } = {}): string {
  const template = {
    "unknown-account": strings.refuseDefaultGone,
    "no-token": strings.refuseDefaultNoToken,
    "token-rejected": strings.refuseDefaultRejected,
    "missing-directory": strings.refuseDefaultMissingDir,
    "not-set": strings.refuseNotSet,
    "no-accounts": strings.refuseNoAccounts,
  }[code];
  return template.replace("{label}", values.label ?? "").replace("{dir}", values.dir ?? "");
}
