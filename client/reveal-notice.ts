import type { Strings } from "../shared/i18n.ts";

/**
 * The notice for one row's usage reveal. `reveal` is a single mutation shared by every row,
 * so `variables` (the `switchTo` last passed to `mutate`) scopes the result to the row that
 * asked. Covers a rejected call, an account that no longer resolves, and a server-side error.
 * Kept free of JSX so `node --test` can load it.
 */
export function revealNotice(
  reveal: {
    variables: string | undefined;
    isError: boolean;
    error: unknown;
    isSuccess: boolean;
    data: { usageErrorCode: "" | "unknown-account"; usageError: string } | undefined;
  },
  switchTo: string,
  strings: Strings,
): string | null {
  if (reveal.variables !== switchTo) return null;
  if (reveal.isError) return reveal.error instanceof Error ? reveal.error.message : String(reveal.error);
  if (reveal.isSuccess && reveal.data !== undefined) {
    if (reveal.data.usageErrorCode === "unknown-account") return strings.usageUnknownAccount;
    if (reveal.data.usageError !== "") return reveal.data.usageError;
  }
  return null;
}
