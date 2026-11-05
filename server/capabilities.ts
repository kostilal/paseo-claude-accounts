import { defineRpc, type PluginRpcContract } from "@getpaseo/plugin";
import { type ZodType, z } from "zod";
import { listAccounts, usageState } from "../shared/accounts.ts";
import { switchAccountRpc, switchAllRpc, switchCode } from "../shared/switch.ts";

/**
 * What an assistant outside Paseo may do with this plugin, such as God Mode, which drives
 * Paseo from ChatGPT over the relay. Paseo hands a remote client only plugin ids and a blind
 * `invokePluginRpc`: no list of methods, no schemas, nothing that says which call reads and
 * which one restarts a chat. So the plugin says it itself, under a method every plugin can
 * answer the same way, in the `paseo.capabilities/1` shape.
 *
 * Reading the accounts, telling which account a chat really runs on and what is left of it, and
 * moving chats between accounts are offered. Adding, deleting and logging in stay on the Accounts
 * screen: they open terminals or forget accounts, which a misheard sentence must never do.
 *
 * Every operation points at a real RPC of this plugin, and the arguments it advertises are
 * rendered from zod contracts that the handler's own contract accepts, so the description
 * cannot promise an argument the handler would refuse.
 */

export const CAPABILITIES_SCHEMA = "paseo.capabilities/1";

// The daemon parses every answer with its contract's output schema, and a zod object drops the
// keys it does not name: a key missing here never reaches the caller.
const operation = z.object({
  id: z.string(),
  kind: z.enum(["read", "action"]),
  method: z.string(),
  title: z.string(),
  description: z.string(),
  /** JSON Schema of the arguments the caller supplies; never the fixed ones. */
  input: z.record(z.string(), z.unknown()),
  fixed: z.record(z.string(), z.unknown()).optional(),
  /** Reads only: what "show me the accounts" means. */
  default: z.boolean().optional(),
  /** The fields of the answer worth reading out. */
  output: z.object({ fields: z.array(z.string()) }).optional(),
  /** Actions only. Both switches restart chats, so both are `disruptive` and confirmed first. */
  risk: z.enum(["low", "outward", "disruptive", "destructive"]).optional(),
  confirm: z.enum(["none", "always"]).optional(),
  /** What the user hears before a confirmed action runs. */
  confirmText: z.string().optional(),
  /** Text fields of the answer that, when not empty, say it was not done. */
  outcome: z.object({ error: z.union([z.string(), z.array(z.string())]) }).optional(),
  /** Actions only: the read that tells the user which chat the action restarts. */
  target: z
    .object({ read: z.string(), args: z.record(z.string(), z.string()), show: z.array(z.string()) })
    .optional(),
});

export const capabilities = z.object({
  schema: z.literal(CAPABILITIES_SCHEMA),
  title: z.string(),
  summary: z.string(),
  aliases: z.array(z.string()),
  operations: z.array(operation),
});

export type Capabilities = z.output<typeof capabilities>;

export const describeRpc = defineRpc({
  name: "meta.describe",
  input: z.object({}),
  output: capabilities,
});

/** One window of an account's allowance, as a listener hears it. */
const windowView = z.object({
  /** Percent used, 0 to 100. */
  utilization: z.number(),
  /** Percent left, 0 to 100. */
  left: z.number(),
  resetsAt: z.string(),
  /** Seconds until it resets; 0 once it has; null when the endpoint gave no time. */
  resetsInSeconds: z.number().nullable(),
  resetsIn: z.string(),
});

/**
 * One chat, by its exact id: the account it really runs on and what is left of that account's
 * allowance. Strings are empty, never missing, when a fact is not known, so every field can be
 * shown or compared without a check.
 */
export const chatRpc = defineRpc({
  name: "accounts.chat",
  input: z.object({
    agentId: z.string().min(1),
    /** Measure the account's usage now instead of taking it from the cache. */
    force: z.boolean().default(false),
  }),
  output: z.object({
    title: z.string(),
    /** The chat's project, or its working directory's name when it has none. */
    project: z.string(),
    /** `running`: a turn is in progress. `idle`. `closed`: no session is open. "" for no chat. */
    turn: z.string(),
    archived: z.boolean(),
    /** A profile's chat says the provider it extends: that is whose accounts it can move to. */
    provider: z.string(),
    /** The registry id of the account the chat runs on; "" when that cannot be told. Never the
     *  default account standing in for an unknown one. */
    account: z.string(),
    accountName: z.string(),
    /** The account the plugin has on record for the chat, which a new session opens on; "" when
     *  there is none. It can differ from `account`: see `note`. */
    bound: z.string(),
    email: z.string(),
    orgName: z.string(),
    subscriptionType: z.string(),
    /** What `account` rests on. `process`: the chat's running Claude process. `session`: the
     *  login its session was last opened on. `binding`: the account its next start will use.
     *  `none`: it cannot be told. */
    basis: z.enum(["process", "session", "binding", "none"]),
    /** Where the sources disagree, or why nothing could be told; "" when they agree. */
    note: z.string(),
    usage: usageState.or(z.literal("not-measured")),
    fiveHour: windowView.nullable(),
    sevenDay: windowView.nullable(),
    /** When the numbers were measured, ISO; "" when nothing was. */
    usageAt: z.string(),
    usageAgeSeconds: z.number().nullable(),
    /** Old, held through a rate limit, or from a window that has since reset. */
    usageStale: z.boolean(),
    /** Seconds the usage endpoint keeps answering with old numbers; 0 when it does not. */
    usageHeldSeconds: z.number(),
    usageError: z.string(),
    /** Why there is no such chat; empty when there is. */
    error: z.string(),
  }),
});

export type ChatAccountAnswer = z.output<typeof chatRpc.output>;

/**
 * A dry run of moving one chat to one account: what would be moved, where from and where to,
 * and why it cannot be. It changes nothing, which is why God Mode may read it before it asks.
 */
export const moveCheckRpc = defineRpc({
  name: "accounts.move-check",
  input: z.object({ agentId: z.string().min(1), account: z.string().min(1) }),
  output: z.object({
    title: z.string(),
    project: z.string(),
    /** `running`, `idle` or `closed`. */
    turn: z.string(),
    /** The account the chat runs on now, with its login; "unknown" when that cannot be told. */
    current: z.string(),
    /** The account it would move to, with its login. */
    to: z.string(),
    /** Why the move cannot happen; "" when it can. */
    code: switchCode,
    error: z.string(),
  }),
});

export type MoveCheckAnswer = z.output<typeof moveCheckRpc.output>;

export interface AccountsOperation {
  id: string;
  kind: "read" | "action";
  contract: PluginRpcContract;
  title: string;
  description: string;
  /** What the caller supplies; merged under `fixed` it must satisfy the contract's input. */
  input: ZodType;
  fixed?: Record<string, unknown>;
  default?: true;
  fields: string[];
  risk?: "disruptive";
  confirmText?: string;
  outcome?: { error: string | string[] };
  target?: { read: string; args: Record<string, string>; show: string[] };
}

const none = z.object({});
const agentId = z.string().min(1).describe("The chat's full id, not a short one");
const account = z.string().min(1).describe("switchTo of a row in accounts");

// `hidden` lists directories the user took off the list; nobody asks about them by voice.
const OVERVIEW_FIELDS = ["accounts", "error", "overridingVar"];

// `bound` is left out on purpose: `account` is the answer, and `note` says when the record differs.
const CHAT_ACCOUNT_FIELDS = [
  "title",
  "project",
  "turn",
  "archived",
  "provider",
  "account",
  "accountName",
  "email",
  "orgName",
  "subscriptionType",
  "basis",
  "note",
  "usage",
  "fiveHour",
  "sevenDay",
  "usageAt",
  "usageAgeSeconds",
  "usageStale",
  "usageHeldSeconds",
  "usageError",
  "error",
];

export const OPERATIONS: AccountsOperation[] = [
  {
    id: "accounts",
    kind: "read",
    contract: listAccounts,
    default: true,
    fixed: { refresh: false, force: false },
    title: "Claude accounts and their usage",
    description:
      "One row per login on this Mac. name: the account's label; email, orgName, subscriptionType: whose login and which plan; isDefault: new chats open on it; usage: ok, expired, unauthorised, none, error or unsupported, with fiveHour (null with ok: none reported) and sevenDay: percent used, reset time. switchTo is the account to switch to, empty when nobody is logged in to it. Usage may be ten minutes old. error claude-not-found: no claude command. overridingVar: a variable that makes switching useless. To know which account a CHAT uses, read chat_account: isDefault only says where new chats open.",
    input: none,
    fields: OVERVIEW_FIELDS,
  },
  {
    id: "accounts_fresh",
    kind: "read",
    contract: listAccounts,
    fixed: { refresh: true, force: true },
    title: "Claude accounts, usage measured now",
    description:
      "The same rows as accounts, with every login read again and usage measured now instead of taken from the cache. Takes a few seconds. A reading under a minute old is kept, and a rate-limited one stays until the wait is over.",
    input: none,
    fields: OVERVIEW_FIELDS,
  },
  {
    id: "chat_account",
    kind: "read",
    contract: chatRpc,
    fixed: { force: false },
    title: "Which account a chat runs on, and its limits",
    description:
      "Which account one chat really runs on, and what is left of its allowance. account is empty when it cannot be told: never assume the default account. basis: process (running now), session (last opened on), binding (will open on), none. note says where sources disagree. usageAgeSeconds, usageStale: how old the numbers are. fiveHour, sevenDay: utilization and left in percent, resetsAt, resetsIn; with usage ok, a null fiveHour means none reported. usageHeldSeconds: rate-limited, the old numbers are kept. usage unauthorised: allow the Keychain read once on the Mac. Only the full chat id works.",
    input: z.object({ agentId }),
    fields: CHAT_ACCOUNT_FIELDS,
    outcome: { error: "error" },
  },
  {
    id: "chat_account_fresh",
    kind: "read",
    contract: chatRpc,
    fixed: { force: true },
    title: "Which account a chat runs on, limits measured now",
    description:
      "The same as chat_account, with the account's usage measured now instead of taken from the cache (up to ten minutes old). Takes a few seconds. A reading under a minute old is kept, and a rate-limited one stays until usageHeldSeconds is over.",
    input: z.object({ agentId }),
    fields: CHAT_ACCOUNT_FIELDS,
    outcome: { error: "error" },
  },
  {
    id: "chat_move_check",
    kind: "read",
    contract: moveCheckRpc,
    title: "Can this chat move to that account?",
    description:
      "Dry run of switch_chat, changes nothing: the chat (title, project, turn running, idle or closed), the account it is on now (current) and the one it would move to (to). code and error say why the move is impossible: unknown-chat, archived, provider-mismatch, unsupported-provider, unknown-account, not-logged-in, missing-directory, first-turn.",
    input: z.object({ agentId, account }),
    fields: ["title", "project", "turn", "current", "to", "code", "error"],
    outcome: { error: ["code", "error"] },
  },
  {
    id: "switch_chat",
    kind: "action",
    contract: switchAccountRpc,
    title: "Move a chat to another account",
    description:
      "Restart one chat on another account of the same provider; the conversation carries on and other chats keep theirs. A turn in progress is cut off (interrupted). applied: verified (the new session opened on it), next-open (a closed chat takes it when opened), pending (restart still running), unverified. A code says it was refused or failed: not-applied or reload-failed (the chat kept its account), or what chat_move_check lists.",
    input: z.object({ agentId, account }),
    fields: ["code", "error", "from", "to", "applied", "interrupted"],
    risk: "disruptive",
    confirmText:
      "Move the chat {target.title} in {target.project} from {target.current} to {target.to} (chat is {target.turn}). It restarts on the new account and a running turn is cut off; a closed chat takes the account when it next opens.",
    outcome: { error: ["code", "error"] },
    target: {
      read: "chat_move_check",
      args: { agentId: "agentId", account: "account" },
      show: ["title", "project", "current", "to", "turn"],
    },
  },
  {
    id: "switch_all",
    kind: "action",
    contract: switchAllRpc,
    title: "Move all chats to an account",
    description:
      "Move every chat of the account's provider, in every workspace, onto this account and make it the default for new chats. Idle chats restart on it now, closed ones when they next open, and chats in the middle of a turn are left alone (skipped). failed counts chats whose restart failed and kept their account; error is the first such failure. A code says it was refused before anything changed.",
    input: z.object({ account }),
    fields: ["code", "moved", "restarted", "failed", "skipped", "error"],
    risk: "disruptive",
    confirmText:
      "Move every chat to account {account} and make it the default: idle chats restart on it now, closed ones when they next open, and chats in the middle of a turn are left alone.",
    // Not `error`: it names a failed restart while the other chats did move.
    outcome: { error: "code" },
  },
];

function jsonSchema(schema: ZodType): Record<string, unknown> {
  // `io: "input"` so a default reads as optional, the way a caller may leave it out.
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return rest;
}

function render(): Capabilities {
  return {
    schema: CAPABILITIES_SCHEMA,
    title: "Claude Accounts",
    summary:
      "The Claude and Codex accounts on this Mac and their allowance; which account a chat really runs on; moves one chat, or every chat, to another account.",
    aliases: ["accounts", "claude accounts", "usage", "аккаунты", "лимиты", "quota", "limits", "subscription", "аккаунт чата", "подписка"],
    operations: OPERATIONS.map((op) => ({
      id: op.id,
      kind: op.kind,
      method: op.contract.name,
      title: op.title,
      description: op.description,
      input: jsonSchema(op.input),
      ...(op.fixed ? { fixed: op.fixed } : {}),
      ...(op.default ? { default: true } : {}),
      output: { fields: op.fields },
      ...(op.risk ? { risk: op.risk, confirm: "always" as const } : {}),
      ...(op.confirmText ? { confirmText: op.confirmText } : {}),
      ...(op.outcome ? { outcome: op.outcome } : {}),
      ...(op.target ? { target: op.target } : {}),
    })),
  };
}

let rendered: Capabilities | null = null;

/**
 * Rendered on the first call rather than at load: `contribute()` must not be able to fail
 * because of a schema that will not render. A broken description costs this one method,
 * never the plugin.
 */
export function describeAccounts(): Capabilities {
  rendered ??= render();
  return rendered;
}
