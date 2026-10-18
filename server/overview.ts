import type { PaseoApi } from "./paseo.ts";
import type { AccountView, Overview } from "../shared/accounts.ts";
import { loginKey } from "../shared/identity.ts";
import type { Identity } from "../shared/parse.ts";
import { PROVIDERS, providerForHome } from "../shared/providers.ts";
import { accountById, hiddenHomes, type Registry } from "../shared/registry.ts";
import { displayName, isClaudeNotFound } from "./discover.ts";
import { chooseUsageHome, groupByLogin, type LoginCandidate } from "./groupLogins.ts";
import { usageForLogin, usageOrder } from "./groupUsage.ts";
import { type ProfileIdentity, ownLogin } from "./profile.ts";
import type { ProjectRow } from "./projects.ts";
import type { UsageResult } from "./usage.ts";

/** Project paths, for per-project `.claude-data` discovery. */
export interface ProjectsReader {
  list(paseo: PaseoApi): Promise<ProjectRow[]>;
}

/** The part of `createUsage` these two need. */
export interface UsageReader {
  authorised(dir: string): boolean;
  stale(dir: string, force?: boolean): boolean;
  cached(dir: string): UsageResult | null;
  measure(dir: string, defaultDir: string, manual: boolean): Promise<UsageResult>;
}

export interface OverviewDeps {
  discover(projectPaths: readonly string[], refresh: boolean): Promise<AccountView[]>;
  readRegistry(): Promise<Registry>;
  projects: ProjectsReader;
  usage: UsageReader;
  defaultDir(): string;
  /** Who a Claude directory's own login belongs to, asked of Anthropic; see server/profile.ts.
   *  Absent, or null: the identity discovery reported stands. */
  profile?(home: string, refresh: boolean): Promise<ProfileIdentity | null>;
  log?(line: string): void;
}

function note(deps: { log?(line: string): void }): (line: string) => void {
  return deps.log ?? ((line: string) => console.error(line));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A registered directory that discovery no longer finds. Shown as logged out rather than
 *  dropped, since a binding may still point at it. */
const notDiscovered: Identity = { loggedIn: false, email: "", orgName: "", subscriptionType: "" };

/** The accounts screen's data, shared by `accounts.list` and `accounts.bind`. */
export function createOverview(deps: OverviewDeps) {
  const log = note(deps);

  /** `force` is the Reload button and implies `refresh`: identity and usage are re-read. */
  return async function overviewFor(paseo: PaseoApi, refresh = false, force = false): Promise<Overview> {
    const projectRows = await deps.projects.list(paseo);
    const paths = projectRows.map((row) => row.path);
    const [registry, identified] = await Promise.all([
      deps.readRegistry(),
      // A missing `claude` is reported once over the whole screen rather than as every row
      // being logged out. Any other discovery failure fails the call.
      deps.discover(paths, refresh || force).catch((error: unknown) => {
        if (!isClaudeNotFound(error)) throw error;
        log(`accounts: ${message(error)}; no directory could be identified`);
        return null;
      }),
    ]);
    const discovered = identified ?? [];
    const byHome = new Map(discovered.map((row) => [row.id, row]));

    // One row per login across all registered directories.
    const candidates: LoginCandidate[] = await Promise.all(
      registry.accounts.map(async (account) => {
        const found = byHome.get(account.home);
        const discoveredIdentity: Identity =
          found === undefined
            ? notDiscovered
            : {
                loggedIn: found.loggedIn,
                email: found.email,
                orgName: found.orgName,
                subscriptionType: found.subscriptionType,
              };
        const profile = deps.profile;
        return {
          accountId: account.id,
          home: account.home,
          identity: await ownLogin(
            account,
            discoveredIdentity,
            profile && ((home) => profile(home, refresh || force)),
          ),
        };
      }),
    );
    // No single project or agent in view, so switchTo falls through to the lowest id.
    const groups = groupByLogin(candidates, {
      boundAccountId: null,
      resolvedAccountId: null,
      projectAccountId: null,
    });

    const registered = groups.map((group) => {
      // switchTo, or the lowest member when the login cannot be switched to.
      const landsOnId = group.switchTo !== "" ? group.switchTo : group.accountIds[0]!;
      const landsOn = accountById(registry, landsOnId);
      return {
        id: landsOnId,
        // The directory's label; the client titles the row by its login.
        name: landsOn?.label ?? landsOnId,
        home: landsOn?.home ?? "",
        provider: landsOn?.provider ?? "claude",
        registered: true,
        key: group.key,
        loggedIn: group.loggedIn,
        email: group.email,
        orgName: group.orgName,
        subscriptionType: group.plan,
        accountIds: group.accountIds,
        switchTo: group.switchTo,
        isDefault: group.accountIds.includes(registry.defaults?.[landsOn?.provider ?? "claude"] ?? ""),
        usage: "unauthorised" as const,
        fiveHour: null,
        sevenDay: null,
        usageErrorCode: "" as const,
        usageError: "",
      };
    });

    // Logged-in directories not yet registered are offered as suggestions, one per
    // directory (not grouped: adding a directory is separate from switching to it).
    // Directories the user removed stay hidden, or discovery would bring them straight back.
    const homes = new Set(registry.accounts.map((account) => account.home));
    const hidden = hiddenHomes(registry);
    const suggestions = discovered
      .filter((row) => row.loggedIn && !homes.has(row.id) && !hidden.has(row.id))
      .map((row) => ({ ...row, home: row.id, registered: false }));

    const accounts = [...registered, ...suggestions];
    // Background reads are bounded (three seconds on a Keychain dialog) and cached, so a
    // poll costs at most one attempt per directory per freshness window. Each login is
    // caught on its own so one failure cannot blank the whole screen.
    const measure = async (home: string) => {
      const cached = deps.usage.cached(home);
      return deps.usage.stale(home, force) || cached === null
        ? deps.usage.measure(home, deps.defaultDir(), false)
        : cached;
    };
    const withUsage = await Promise.all(
      accounts.map(async (account) => {
        // No meter for this provider: say so rather than offer an authorise button.
        if (!(PROVIDERS[account.provider as "claude" | "codex"]?.meterable ?? true)) {
          return { ...account, usage: "unsupported" as const, fiveHour: null, sevenDay: null, usageError: "" };
        }
        if (!account.loggedIn) return account;
        const homes = account.registered
          ? usageOrder(
              account,
              (id) => accountById(registry, id)?.home ?? null,
              chooseUsageHome(account, (id) => accountById(registry, id)?.home ?? null, deps.usage.authorised),
            )
          : [account.home];
        try {
          const result = await usageForLogin(homes, measure);
          return {
            ...account,
            usage: result.state,
            fiveHour: result.fiveHour,
            sevenDay: result.sevenDay,
            usageError: result.error,
          };
        } catch (error) {
          log(`accounts: no usage for ${account.id}: ${message(error)}`);
          return { ...account, usage: "error" as const, usageError: message(error) };
        }
      }),
    );
    // Hidden directories, so the screen can offer them back.
    const hiddenRows = [...hidden].map((home) => {
      const found = byHome.get(home);
      return {
        home,
        name: found?.name || home.slice(home.lastIndexOf("/") + 1),
        loggedIn: found?.loggedIn ?? false,
        email: found?.email ?? "",
        orgName: found?.orgName ?? "",
      };
    });
    return {
      accounts: withUsage,
      hidden: hiddenRows,
      error: identified === null ? ("claude-not-found" as const) : ("" as const),
      overridingVar: "",
    };
  };
}

export interface UsageRowDeps {
  /** Every config directory the plugin considers real: discovered ones plus every directory
   *  in the registry (which may live outside the discovered locations). */
  knownHomes(paseo: PaseoApi): Promise<string[]>;
  identify(dir: string, refresh: boolean): Promise<Identity>;
  usage: UsageReader;
  defaultDir(): string;
}

/** One directory's row, measured on a button press (`accounts.usage`). `account` is a
 *  directory path; the caller maps registry ids to directories and back, and fills in
 *  the grouping fields. */
export function createUsageRow(deps: UsageRowDeps) {
  return async function usageRowFor(paseo: PaseoApi, account: string): Promise<AccountView> {
    const known = new Set(await deps.knownHomes(paseo));
    if (!known.has(account)) {
      // A code, not a sentence: the client translates it.
      return {
        id: account,
        name: displayName(account),
        home: "",
        provider: providerForHome(account) ?? "claude",
        registered: false,
        key: loginKey({ email: "", orgName: "" }, account),
        loggedIn: false,
        email: "",
        orgName: "",
        subscriptionType: "",
        accountIds: [],
        switchTo: "",
        isDefault: false,
        usage: "error" as const,
        fiveHour: null,
        sevenDay: null,
        usageErrorCode: "unknown-account" as const,
        usageError: "",
      };
    }
    // Both read fresh, since a person asked. Providers without a meter are not measured,
    // which would only prompt the Keychain for nothing.
    const meterable = PROVIDERS[(providerForHome(account) ?? "claude")].meterable;
    const [identity, result] = await Promise.all([
      deps.identify(account, true),
      meterable
        ? deps.usage.measure(account, deps.defaultDir(), true)
        : Promise.resolve({ state: "unsupported" as const, fiveHour: null, sevenDay: null, error: "" }),
    ]);
    return {
      id: account,
      name: displayName(account),
      home: account,
      provider: providerForHome(account) ?? "claude",
      registered: true,
      key: loginKey(identity, account),
      loggedIn: identity.loggedIn,
      email: identity.email,
      orgName: identity.orgName,
      subscriptionType: identity.subscriptionType,
      accountIds: [],
      switchTo: "",
      isDefault: false,
      usage: result.state,
      fiveHour: result.fiveHour,
      sevenDay: result.sevenDay,
      usageErrorCode: "" as const,
      usageError: result.error,
    };
  };
}
