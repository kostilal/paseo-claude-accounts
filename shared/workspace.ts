import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { pillAccount, switchCode } from "./switch.ts";

/** Where the next new chat in a workspace opens when the workspace has no account of its own. */
export const nextSource = z.enum([
  /** The provider's default picks by allowance; `account` is what it would pick now. */
  "auto",
  /** The provider's default account. */
  "default",
  /** No default: the chat's own folder's login. `account` is empty. */
  "folder",
]);

export const workspaceStateRpc = defineRpc({
  name: "accounts.workspace",
  input: z.object({
    workspaceId: z.string(),
    provider: z.string().default("claude"),
    /** True when a person opened the popover; only then may a Keychain dialog appear. */
    manual: z.boolean().default(false),
  }),
  output: z.object({
    /** The workspace's own account id, or "" when it has none. */
    account: z.string().default(""),
    /** Where a new chat would open without one. */
    next: z.object({ source: nextSource, account: z.string().default("") }),
    /** Every login with its allowance; `current` marks the workspace's own account. */
    accounts: z.array(pillAccount).default([]),
  }),
});

export const setWorkspaceRpc = defineRpc({
  name: "accounts.set-workspace",
  input: z.object({
    workspaceId: z.string(),
    provider: z.string().default("claude"),
    /** The account new chats in the workspace open on; "" gives the choice back to the
     *  default. Chats already open keep theirs. */
    account: z.string(),
  }),
  output: z.object({
    /** A refusal of the account, before anything was written. */
    code: z.union([switchCode, z.literal("registry-unreadable")]).default(""),
  }),
});

export type WorkspaceState = z.output<typeof workspaceStateRpc.output>;
