import { defineRpc, type PluginRpcContract } from "@getpaseo/plugin";
import { type ZodType, z } from "zod";
import { listAccounts } from "../shared/accounts.ts";
import { switchAccountRpc, switchAllRpc } from "../shared/switch.ts";

/**
 * What an assistant outside Paseo may do with this plugin, such as God Mode, which drives
 * Paseo from ChatGPT over the relay. Paseo hands a remote client only plugin ids and a blind
 * `invokePluginRpc`: no list of methods, no schemas, nothing that says which call reads and
 * which one restarts a chat. So the plugin says it itself, under a method every plugin can
 * answer the same way, in the `paseo.capabilities/1` shape.
 *
 * Only reading the accounts and moving chats between them are offered. Adding, deleting and
 * logging in stay on the Accounts screen: they open terminals or forget accounts, which a
 * misheard sentence must never do.
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

/** One chat by its exact id: what the confirmation of a switch names it by. */
export const chatRpc = defineRpc({
  name: "accounts.chat",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({
    title: z.string(),
    /** The chat's project, or its working directory's name when it has none. */
    project: z.string(),
    /** Why there is no such chat; empty when there is. */
    error: z.string(),
  }),
});

export type ChatFacts = z.output<typeof chatRpc.output>;

/** What Paseo answers about one agent; `paseo.agents.ref(id).refresh()` fits it. */
export interface ChatLookup {
  agent: { id: string; title: string | null; cwd: string };
  project: { projectName: string } | null;
}

/**
 * The chat with exactly this id. Paseo also answers for a unique prefix of an id or for a
 * title, but `accounts.switch` binds the id it is given and the session-open hook looks a chat
 * up by its full id, so a switch by anything else would report success and leave the chat on
 * its account. Only the exact id counts, which makes such a switch fail its confirmation.
 */
export async function readChat(agentId: string, fetch: (agentId: string) => Promise<ChatLookup | null>): Promise<ChatFacts> {
  const found = await fetch(agentId);
  if (found === null || found.agent.id !== agentId) {
    return { title: "", project: "", error: "no chat has exactly this id; use the chat's full id" };
  }
  const { agent, project } = found;
  return {
    title: agent.title ?? "",
    project: project?.projectName || agent.cwd.slice(agent.cwd.lastIndexOf("/") + 1),
    error: "",
  };
}

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

export const OPERATIONS: AccountsOperation[] = [
  {
    id: "accounts",
    kind: "read",
    contract: listAccounts,
    default: true,
    fixed: { refresh: false, force: false },
    title: "Claude accounts and their usage",
    description:
      "One row per login on this Mac. name: the account's label; email, orgName, subscriptionType: whose login and which plan; isDefault: new chats open on it; usage: ok, expired, unauthorised, none, error or unsupported, with fiveHour and sevenDay utilization in percent and when each resets. switchTo is the account to switch to, empty when nobody is logged in to it. Usage may be ten minutes old. error claude-not-found: no claude command. overridingVar: a variable that makes switching useless.",
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
    id: "chat",
    kind: "read",
    contract: chatRpc,
    title: "One chat",
    description: "The chat with exactly this id: its title and project. Only the full id works.",
    input: z.object({ agentId }),
    fields: ["title", "project", "error"],
    outcome: { error: "error" },
  },
  {
    id: "switch_chat",
    kind: "action",
    contract: switchAccountRpc,
    title: "Move a chat to another account",
    description:
      "Restart one chat on another account; the conversation carries on and other chats keep theirs. A turn in progress is cut off. A code says it was refused: not-logged-in (nobody is logged in to that account), unknown-account, missing-directory, or reload-failed (the chat kept its account).",
    input: z.object({ agentId, account }),
    fields: ["code", "error"],
    risk: "disruptive",
    confirmText:
      "Move the chat {target.title} in {target.project} to account {account}: it restarts on that account, and a turn in progress is cut off.",
    outcome: { error: ["code", "error"] },
    target: { read: "chat", args: { agentId: "agentId" }, show: ["title", "project"] },
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
      "The Claude and Codex accounts on this Mac and how much allowance each has left; can move one chat, or every chat, to another account.",
    aliases: ["accounts", "claude accounts", "usage", "аккаунты", "лимиты"],
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
