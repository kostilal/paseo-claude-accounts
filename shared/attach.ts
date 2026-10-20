import { PluginAttachmentSearchPayloadSchema, defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** The `resourceType` of the composer's "Claude account" attachment. Paseo turns a picked item
 *  into a text attachment carrying it in `externalResource`, which is how the workspace-create
 *  hook recognises it. */
export const ACCOUNT_RESOURCE = "claude-account";

export const accountSearchRpc = defineRpc({
  name: "accounts.attach-search",
  input: z.object({ query: z.string().default("") }),
  output: PluginAttachmentSearchPayloadSchema,
});

/**
 * The account a new workspace's first chat was asked to open on, from the attachments it was
 * created with; null when none was. The last one wins, as the latest choice. Read structurally:
 * the request's attachment union is Paseo's to extend.
 */
export function askedAccount(attachments: readonly unknown[]): string | null {
  let asked: string | null = null;
  for (const raw of attachments) {
    const attachment = (raw ?? {}) as { type?: unknown; externalResource?: { resourceType?: unknown; id?: unknown } };
    if (attachment.type !== "text") continue;
    const resource = attachment.externalResource;
    if (resource?.resourceType !== ACCOUNT_RESOURCE || typeof resource.id !== "string" || resource.id === "") continue;
    asked = resource.id;
  }
  return asked;
}
