import { loginKey } from "../shared/identity.ts";
import type { Identity } from "../shared/parse.ts";

/** One registry account's directory, as grouping sees it. Usage is not part of it: grouping
 *  decides which directory's usage gets read, not the other way around. */
export interface LoginCandidate {
  accountId: string;
  home: string;
  identity: Identity;
}

/** What is known about "here", so `switchTo` prefers a directory already in play. All
 *  fields are null where there is no single "here" (the accounts screen lists every
 *  project at once), and `switchTo` falls through to the lowest id. */
export interface SwitchContext {
  boundAccountId: string | null;
  resolvedAccountId: string | null;
  /** The registry account whose directory is this project's own `.claude-data`, if any. */
  projectAccountId: string | null;
}

export interface LoginGroup {
  key: string;
  email: string;
  orgName: string;
  /** `Identity.subscriptionType`. */
  plan: string;
  /** Every registry account whose directory holds this login, sorted. */
  accountIds: string[];
  /** The account a press switches to. Empty exactly when `loggedIn` is false. */
  switchTo: string;
  loggedIn: boolean;
}

/** Picks which of a login's accounts a press lands on: the bound account, then the agent's
 *  resolved account, then this project's own directory, then the lowest id. Deterministic so
 *  a row never switches somewhere different on each press. All members share the login, so
 *  this only decides which directory's name the row shows. */
export function chooseCandidate(accountIds: readonly string[], context: SwitchContext): string {
  const sorted = [...accountIds].sort();
  if (context.boundAccountId !== null && sorted.includes(context.boundAccountId)) {
    return context.boundAccountId;
  }
  if (context.resolvedAccountId !== null && sorted.includes(context.resolvedAccountId)) {
    return context.resolvedAccountId;
  }
  if (context.projectAccountId !== null && sorted.includes(context.projectAccountId)) {
    return context.projectAccountId;
  }
  return sorted[0]!;
}

/** Folds directories into one row per login (several config directories can be logged in to
 *  the same account). Groups keep the order their first directory appeared in, so the list
 *  does not reshuffle between polls. A row's fields all come from the one directory
 *  `chooseCandidate` names, picked among logged-in members when there are any, so one
 *  member with an expired token cannot make the whole login look logged out. */
export function groupByLogin(directories: readonly LoginCandidate[], context: SwitchContext): LoginGroup[] {
  const order: string[] = [];
  const membersByKey = new Map<string, LoginCandidate[]>();
  for (const directory of directories) {
    const key = loginKey(directory.identity, directory.home);
    const members = membersByKey.get(key);
    if (members === undefined) {
      order.push(key);
      membersByKey.set(key, [directory]);
    } else {
      members.push(directory);
    }
  }

  return order.map((key) => {
    const members = membersByKey.get(key)!;
    const accountIds = members.map((member) => member.accountId).sort();
    const loggedInIds = members.filter((member) => member.identity.loggedIn).map((member) => member.accountId);
    const pool = loggedInIds.length > 0 ? loggedInIds : accountIds;
    const candidateId = chooseCandidate(pool, context);
    const identity =
      members.find((member) => member.accountId === candidateId)?.identity ??
      ({ loggedIn: false, email: "", orgName: "", subscriptionType: "" } satisfies Identity);
    return {
      key,
      email: identity.email,
      orgName: identity.orgName,
      plan: identity.subscriptionType,
      accountIds,
      switchTo: identity.loggedIn ? candidateId : "",
      loggedIn: identity.loggedIn,
    };
  });
}

/** Which directory a login's usage is read from, independent of `switchTo`. Keychain access
 *  is granted per directory, while `switchTo` varies by context, so the first authorised
 *  member (in sorted order) wins and `switchTo` is only the fallback. Null when there is
 *  nothing to read. */
export function chooseUsageHome(
  group: { accountIds: readonly string[]; switchTo: string },
  homeOf: (accountId: string) => string | null,
  authorised: (home: string) => boolean,
): string | null {
  const sorted = [...group.accountIds].sort();
  for (const accountId of sorted) {
    const home = homeOf(accountId);
    if (home !== null && authorised(home)) return home;
  }
  return group.switchTo === "" ? null : homeOf(group.switchTo);
}

/** A switch only works through a minted token on the bound account, so when the chosen
 *  member has none and a sibling on the same login does, bind the sibling (lowest id). */
export function preferTokenHolder(group: LoginGroup, hasToken: (accountId: string) => boolean): LoginGroup {
  if (group.switchTo === "" || hasToken(group.switchTo)) return group;
  const holder = [...group.accountIds].sort().find((id) => hasToken(id));
  return holder === undefined ? group : { ...group, switchTo: holder };
}
