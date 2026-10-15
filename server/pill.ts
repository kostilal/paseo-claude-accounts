import type { Identity } from "../shared/parse.ts";
import { PROVIDERS } from "../shared/providers.ts";
import { accountById, type Registry, resolveAccount } from "../shared/registry.ts";
import type { PillState } from "../shared/switch.ts";
import { isClaudeNotFound } from "./discover.ts";
import { chooseUsageHome, groupByLogin, type LoginCandidate, preferTokenHolder } from "./groupLogins.ts";
import { usageForLogin, usageOrder } from "./groupUsage.ts";
import type { UsageResult } from "./usage.ts";

export interface PillInput {
  agentId: string;
  cwd: string;
  manual: boolean;
}

export interface PillDeps {
  readRegistry(): Promise<Registry>;
  /** Who a directory is logged in as; grouping needs the email and org, not just a flag. */
  identify(home: string): Promise<Identity>;
  /** This project's own `.claude-data` directory, or null. Preferred when a login is held
   *  in several directories; see chooseCandidate. */
  projectHome(): Promise<string | null>;
  /** Whether a directory's Keychain read has been authorised. Synchronous, so choosing
   *  which member to read never waits. */
  authorised(home: string): boolean;
  /** The allowance for one account's directory, or a blank result when it is not known. */
  usageFor(home: string, manual: boolean): Promise<UsageResult>;
}

/** A logged-out login's usage: nothing to read. */
const noUsage: UsageResult = { state: "unauthorised", fiveHour: null, sevenDay: null, error: "" };

/** A provider with no usage meter. Distinct from `noUsage` so the row does not offer an
 *  authorise button that can never work. */
const unmeterable: UsageResult = { state: "unsupported", fiveHour: null, sevenDay: null, error: "" };

/** Used when the `claude` binary is missing; the pill reports that once for the list. */
const unidentified: Identity = { loggedIn: false, email: "", orgName: "", subscriptionType: "" };

/** The higher of the two utilizations (0–100), since the fuller window decides whether to
 *  switch. Null when neither is known, rather than a misleading 0%. */
function tightestOf(usage: UsageResult): number | null {
  const values = [usage.fiveHour?.utilization, usage.sevenDay?.utilization].filter(
    (value): value is number => typeof value === "number",
  );
  return values.length === 0 ? null : Math.max(...values);
}

/** Everything one agent's pill draws: which login it is on and what each login has left.
 *  Logged-out logins are listed too (disabled, with the reason), so none seems to vanish. */
export async function pillStateFor(input: PillInput, deps: PillDeps): Promise<PillState> {
  const registry = await deps.readRegistry();
  const bound = resolveAccount(registry, { agentId: input.agentId });

  // This project's own registered directory, if any. It is the fallback for "which account
  // is this chat on" when nothing is bound, and a preference for where a press lands; it
  // never overrides a binding.
  const projectHome = await deps.projectHome();
  const projectAccountId =
    projectHome === null
      ? null
      : (registry.accounts.find((account) => account.home === projectHome)?.id ?? null);
  const current = bound ?? (projectAccountId === null ? null : accountById(registry, projectAccountId));

  // A missing `claude` binary affects every directory, so it is reported once for the list
  // rather than as a column of "Not logged in". Other failures reject the call.
  let claudeMissing = false;
  const candidates: LoginCandidate[] = await Promise.all(
    registry.accounts.map(async (account) => ({
      accountId: account.id,
      home: account.home,
      identity: await deps.identify(account.home).catch((error: unknown) => {
        if (!isClaudeNotFound(error)) throw error;
        claudeMissing = true;
        return unidentified;
      }),
    })),
  );

  const hasToken = (id: string) => {
    const login = accountById(registry, id)?.tokenLogin;
    return login !== undefined && login !== "";
  };
  const groups = groupByLogin(candidates, {
    boundAccountId: bound?.id ?? null,
    resolvedAccountId: current?.id ?? null,
    projectAccountId,
  }).map((group) => preferTokenHolder(group, hasToken));

  const accounts = await Promise.all(
    groups.map(async (group) => {
      const homeOf = (id: string) => accountById(registry, id)?.home ?? null;
      const preferred = chooseUsageHome(group, homeOf, deps.authorised);
      // The account a press lands on (the lowest member when the login cannot be switched
      // to). Its provider decides whether there is a meter at all.
      const landsOn = group.switchTo !== "" ? group.switchTo : group.accountIds[0]!;
      const landsOnAccount = accountById(registry, landsOn);
      const mechanism = PROVIDERS[landsOnAccount?.provider ?? "claude"];
      const usage = !(mechanism?.meterable ?? true)
        ? unmeterable
        : !group.loggedIn
          ? noUsage
          : await usageForLogin(usageOrder(group, homeOf, preferred), (home) => deps.usageFor(home, input.manual));
      return {
        label: landsOnAccount?.label ?? landsOn,
        provider: landsOnAccount?.provider ?? "claude",
        home: landsOnAccount?.home ?? "",
        // Whether a press can work: a directory switch needs a login, a token switch a token.
        hasToken:
          mechanism?.switch.kind === "home"
            ? group.loggedIn
            : group.switchTo !== "" && hasToken(group.switchTo),
        key: group.key,
        email: group.email,
        orgName: group.orgName,
        plan: group.plan,
        accountIds: group.accountIds,
        switchTo: group.switchTo,
        loggedIn: group.loggedIn,
        // Any member counts, not only switchTo: it is the same subscription.
        current: current !== null && group.accountIds.includes(current.id),
        usage: usage.state,
        fiveHour: usage.fiveHour,
        sevenDay: usage.sevenDay,
      };
    }),
  );

  const currentRow = accounts.find((row) => row.current) ?? null;
  return {
    currentId: current?.id ?? "",
    error: claudeMissing ? ("claude-not-found" as const) : ("" as const),
    tightest:
      currentRow === null
        ? null
        : tightestOf({
            state: currentRow.usage,
            fiveHour: currentRow.fiveHour,
            sevenDay: currentRow.sevenDay,
            error: "",
          }),
    accounts,
  };
}
