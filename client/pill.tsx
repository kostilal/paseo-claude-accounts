import {
  type PluginButtonContentProps,
  type PluginButtonIconProps,
  type PluginButtonRegistration,
  type PluginClientContext,
  useAgent,
  useRpc,
} from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { fetchUsage, refreshAccountRpc } from "../shared/accounts.ts";
import { loginName, loginOwner } from "../shared/identity.ts";
import { type Strings, t } from "../shared/i18n.ts";
import { detectAppLocale, usePreferences, useStrings } from "./locale.ts";
import { nearlyFull } from "../shared/auto.ts";
import { type PillAccount, type SwitchCode, claudeProvidersRpc, pillStateRpc, switchAccountRpc } from "../shared/switch.ts";
import { currentOf, exhaustedResetIn, hasSpare, pillFigure, pillLabel, pillPercent, pillTag, planName, refreshNotice, rowAgeText, tightestOf, usageLine, weekLine } from "./format.ts";
import { createPillRegistry, trackClaudeAgents } from "./pill-registry.ts";
import { AccountRing } from "./ring.tsx";
import { typeScale } from "./typography.ts";
import { Banner, Button, EmptyState, RefreshDot, Skeleton, meterTone } from "./ui.tsx";

/** A row is named by its login, whose it is first, not by the config directory holding it. */
export function loginTitle(account: PillAccount, strings: Strings): string {
  return loginName(account, strings.personalAccount, account.label !== "" ? account.label : strings.notLoggedIn);
}

function messageFor(code: SwitchCode, strings: Strings): string {
  switch (code) {
    case "paseo-not-found":
      return strings.switchPaseoMissing;
    case "missing-directory":
      return strings.switchMissingDirectory;
    case "unsupported-provider":
      return strings.switchUnsupportedProvider;
    case "not-logged-in":
      return strings.switchNotLoggedIn;
    case "unknown-account":
      return strings.switchUnknownAccount;
    case "first-turn":
      return strings.switchFirstTurn;
    case "unknown-chat":
      return strings.switchUnknownChat;
    case "archived":
      return strings.switchArchived;
    case "provider-mismatch":
      return strings.switchProviderMismatch;
    case "not-applied":
      return strings.switchNotApplied;
    case "":
    case "reload-failed":
      return "";
  }
}

type NoticeTone = "info" | "warn" | "bad";

function rawErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A switch finishes after the popover has closed, so a failure cannot be shown where it was
 *  asked for. It is kept per chat and shown the next time that chat's popover opens. */
const failedSwitches = new Map<string, { code: SwitchCode; error: string }>();

function switchNotice(
  failure: { code: SwitchCode; error: string } | null,
  strings: Strings,
): { text: string; tone: NoticeTone } | null {
  if (failure === null) return null;
  if (failure.code === "reload-failed") return { text: failure.error, tone: "bad" };
  const text = messageFor(failure.code, strings);
  return text === "" ? null : { text, tone: "bad" };
}

/** The warning for a chat whose account is close to a limit, naming the fuller window; null
 *  when neither window is. The chat is not moved: whether it needs more room is the person's
 *  call. */
function nearlyFullText(account: PillAccount | null, strings: Strings): string | null {
  if (account === null) return null;
  const windows = [
    { name: strings.fiveHourUsage, bar: account.fiveHour },
    { name: strings.sevenDayUsage, bar: account.sevenDay },
  ].filter((window) => nearlyFull(window.bar));
  const fullest = windows.sort((a, b) => b.bar!.utilization - a.bar!.utilization)[0];
  if (fullest === undefined) return null;
  return strings.pillNearlyFull
    .replace("{window}", fullest.name)
    .replace("{pct}", String(Math.round(fullest.bar!.utilization)));
}

const pillKey = (agentId: string) => ["accounts", "pill", agentId];

/**
 * The pill icon: a ring of the window the pill reads, the fuller of the two (full once either
 * window is exhausted), plus a green dot when the allowance is (nearly) gone and another account
 * could take over. The label beside it is host-owned, so the figure is pushed through
 * `registration.update()`.
 */
function AccountPillIcon(
  props: PluginButtonIconProps & { registration: { current: PluginButtonRegistration | null } },
) {
  const { theme, size, workspaceId, registration } = props;
  const agentId = props.context === "agent" ? props.agentId : "";
  const strings = useStrings();
  const { showPill } = usePreferences();
  const askPill = useRpc(pillStateRpc);
  const cwd = useAgent(agentId, (agent) => agent.cwd);

  const { data, dataUpdatedAt } = useQuery({
    queryKey: pillKey(agentId),
    queryFn: () => askPill({ agentId, cwd: cwd ?? "", workspaceId, manual: false }),
    enabled: cwd !== null,
    refetchInterval: 30_000,
  });

  const current = data === undefined ? null : currentOf(data);
  // The wait is counted from the last poll: reading `dataUpdatedAt` renders the pill again on
  // every poll, while `data` alone changes only when the numbers do, and the wait would stand still.
  const figure = current === null ? strings.pillNoAccount : pillFigure(current, dataUpdatedAt, strings);
  // Named only when another account has the same address, or the figure would not say which.
  const label = pillLabel(data === undefined ? "" : pillTag(data, strings), figure, strings);
  useEffect(() => {
    registration.current?.update({ label, visible: showPill });
  }, [label, showPill, registration]);

  // The green dot weighs the week: it says another account has room, and a nearly spent week
  // is as good a reason to move as a nearly spent 5 hours.
  const tightest = current === null ? null : tightestOf(current.fiveHour, current.sevenDay);
  const exhausted = current !== null && exhaustedResetIn(current.fiveHour, current.sevenDay, Date.now()) !== null;
  const spare = data !== undefined && (exhausted || (tightest !== null && tightest >= 90)) && hasSpare(data);
  const ringPercent = current === null ? null : pillPercent(current);
  // The host clips anything larger than the icon slot.
  const ringSize = size;

  return (
    <View style={{ width: ringSize, height: ringSize }}>
      <AccountRing theme={theme} size={ringSize} provider={current?.provider ?? "claude"} tightest={ringPercent} />
      {spare && (
        <View
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: theme.colors.statusSuccess,
            borderWidth: 1,
            borderColor: theme.colors.surface0,
          }}
        />
      )}
    </View>
  );
}

/**
 * The pill's popover: logged-in accounts with their usage. Tapping another account switches
 * this chat onto it.
 */
export function AccountPopover(props: PluginButtonContentProps) {
  const { theme, layout, workspaceId, close } = props;
  const agentId = props.context === "agent" ? props.agentId : "";
  const strings = useStrings();
  const askPill = useRpc(pillStateRpc);
  const askUsage = useRpc(fetchUsage);
  const askRefresh = useRpc(refreshAccountRpc);
  const doSwitch = useRpc(switchAccountRpc);
  const queries = useQueryClient();
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const status = useAgent(agentId, (agent) => agent.status);
  const busy = status === "running" || status === "initializing";

  const key = pillKey(agentId);
  const { data, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: key,
    queryFn: () => askPill({ agentId, cwd: cwd ?? "", workspaceId, manual: false }),
    enabled: cwd !== null,
    // Poll quickly while open: logins finish in a terminal the popover cannot observe.
    // The daemon caches the read, so this is cheap.
    refetchInterval: 5_000,
  });

  const reveal = useMutation({
    mutationFn: (account: string) => askUsage({ account }),
    onSuccess: () => queries.invalidateQueries({ queryKey: key }),
  });

  const showFreshNumbers = () => {
    void queries.invalidateQueries({ queryKey: ["accounts", "pill"] });
    void queries.invalidateQueries({ queryKey: ["accounts", "overview"] });
  };

  // Each round button answers for its own row, and several accounts may refresh at once.
  const [refreshing, setRefreshing] = useState<readonly string[]>([]);
  const [refreshed, setRefreshed] = useState<Readonly<Record<string, { text: string; tone: NoticeTone }>>>({});

  function refreshRow(account: PillAccount) {
    setRefreshing((rows) => [...rows, account.key]);
    setRefreshed(({ [account.key]: _, ...others }) => others);
    void askRefresh({ account: account.switchTo })
      .then(
        (answer) => refreshNotice(answer, Date.now(), strings),
        (reason: unknown) => ({ text: `${strings.usageReadFailed} ${rawErrorText(reason)}`, tone: "bad" as const }),
      )
      .then((result) => setRefreshed((others) => (result === null ? others : { ...others, [account.key]: result })))
      .finally(() => {
        setRefreshing((rows) => rows.filter((row) => row !== account.key));
        showFreshNumbers();
      });
  }


  // A press while the agent is working arms the row; a second press switches. Rows stay
  // pressable through a turn because noticing a limit happens while the agent is working.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!busy) setArmed(null);
  }, [busy]);

  function pressRow(account: PillAccount) {
    if (busy && armed !== account.switchTo) {
      setArmed(account.switchTo);
      return;
    }
    setArmed(null);
    // Close at once and let the switch finish in the background; the pill catches up when
    // the session has restarted on the new account.
    failedSwitches.delete(agentId);
    close();
    void doSwitch({ agentId, account: account.switchTo })
      .then((result) => {
        if (result.code !== "") failedSwitches.set(agentId, result);
      })
      .catch((reason: unknown) => failedSwitches.set(agentId, { code: "reload-failed", error: rawErrorText(reason) }))
      .finally(() => void queries.invalidateQueries({ queryKey: ["accounts", "pill"] }));
  }

  const notice = switchNotice(failedSwitches.get(agentId) ?? null, strings);
  // Reading `dataUpdatedAt` draws the rows again on every poll, or the times beside them would
  // stand still while the numbers do not change.
  const now = Math.max(Date.now(), dataUpdatedAt);
  const loadFailedBanner = (
    <Banner
      theme={theme}
      tone="bad"
      text={`${strings.pillLoadFailed} ${rawErrorText(error)}`}
      action={{ label: strings.retry, onPress: () => void refetch() }}
    />
  );

  const rows = data === undefined ? [] : data.accounts.filter((account) => account.loggedIn);
  const ordered = [...rows.filter((row) => row.current), ...rows.filter((row) => !row.current)];
  const warning = nearlyFullText(rows.find((row) => row.current) ?? null, strings);
  // The current account's usage could not be read: offer a manual reveal under the list.
  const unread = rows.find((row) => row.current && (row.usage === "unauthorised" || row.usage === "error")) ?? null;
  // The button above the list presses every row's own, so each row says what came back. Not the
  // rows that have not been allowed the Keychain: each would bring up a dialog of its own.
  const refreshable = ordered.filter((row) => row.usage !== "unsupported" && row.usage !== "unauthorised" && row.switchTo !== "");
  const noticeColour = { info: theme.colors.foregroundMuted, warn: theme.colors.statusWarning, bad: theme.colors.statusDanger };

  return (
    <View style={{ padding: layout.compact ? 10 : 12, gap: 8, minWidth: layout.compact ? 280 : 340, maxWidth: 420 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ ...typeScale.body, fontWeight: "600", color: theme.colors.foreground }}>{strings.pillTitle}</Text>
        {refreshable.length > 0 && (
          <RefreshDot theme={theme} label={strings.refreshAllAccounts} busy={refreshing.length > 0} onPress={() => refreshable.forEach(refreshRow)} />
        )}
      </View>
      <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>{strings.pillHint}</Text>
      {cwd === null ? (
        <Banner theme={theme} tone="info" text={strings.pillAgentUnknown} />
      ) : data !== undefined ? (
        <>
          {isError && loadFailedBanner}
          {data.error === "claude-not-found" && <Banner theme={theme} tone="bad" text={strings.claudeNotFound} />}
          {data.overridingVar !== "" && (
            <Banner theme={theme} tone="bad" text={strings.apiKeyOverride.replace("{var}", data.overridingVar)} />
          )}
          {ordered.length === 0 ? (
            <EmptyState theme={theme} icon="Users" title={strings.pillEmptyTitle} detail={strings.pillEmptyDetail} />
          ) : (
            // No ScrollView of its own. On a phone the popover is a content-sized sheet, and a
            // scrollable inside it reports only the list's height to the sheet, which then
            // opens too short to show the list. The host scrolls the popover on every layout.
            <View style={{ gap: 6 }}>
              {ordered.map((account) => {
                const tightest = tightestOf(account.fiveHour, account.sevenDay);
                const title = loginTitle(account, strings);
                // One address can be the person's own plan and a company seat: the row leads
                // with whose it is, and the plan and the address go underneath.
                const owner = loginOwner(account, strings.personalAccount);
                const plan = planName(account.plan, account.tier);
                const subtitle = [plan, owner !== "" ? account.email : ""].filter((part) => part !== "").join(" · ");
                const pressable = !account.current;
                const refreshes = account.usage !== "unsupported" && account.switchTo !== "";
                const tone =
                  tightest !== null && tightest >= 70 ? theme.colors[meterTone(tightest)] : theme.colors.foregroundMuted;
                return (
                  <View key={account.key} style={{ gap: 6 }}>
                    <View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={plan !== "" ? `${title} · ${plan}` : title}
                      accessibilityState={{ selected: account.current, disabled: !pressable }}
                      disabled={!pressable}
                      hitSlop={2}
                      onPress={() => pressRow(account)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        borderWidth: account.current ? 2 : 1,
                        borderColor: account.current
                          ? theme.colors.accent
                          : armed === account.switchTo
                            ? theme.colors.statusWarning
                            : theme.colors.border,
                        backgroundColor: account.current ? theme.colors.surface2 : theme.colors.surface1,
                      }}
                    >
                      <AccountRing theme={theme} size={30} provider={account.provider} tightest={tightest} />
                      <View style={{ flex: 1, gap: 2 }}>
                        {/* Clear of the corner, which holds the time and the round button. */}
                        <Text style={{ ...typeScale.body, fontWeight: "600", color: theme.colors.foreground, paddingRight: refreshes ? 96 : 0 }} numberOfLines={1}>
                          {owner !== "" ? owner : title}
                        </Text>
                        {subtitle !== "" && (
                          <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }} numberOfLines={1}>
                            {subtitle}
                          </Text>
                        )}
                        <Text style={{ ...typeScale.meta, color: tone }} numberOfLines={1}>
                          {usageLine(account, now, strings)}
                        </Text>
                        {weekLine(account, now, strings) !== "" && (
                          <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }} numberOfLines={1}>
                            {weekLine(account, now, strings)}
                          </Text>
                        )}
                        {account.usage === "expired" && (
                          <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }} numberOfLines={2}>
                            {strings.usageExpired}
                          </Text>
                        )}
                        {refreshed[account.key] !== undefined && (
                          <Text style={{ ...typeScale.meta, color: noticeColour[refreshed[account.key]!.tone] }} numberOfLines={3}>
                            {refreshed[account.key]!.text}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                    {/* Beside the row rather than inside it, so a press here can never switch the chat. */}
                    {refreshes && (
                      <View pointerEvents="box-none" style={{ position: "absolute", top: 7, right: 7, flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {account.usageAt !== null && (
                          <Text numberOfLines={1} style={{ ...typeScale.meta, fontSize: 10, color: account.heldUntil !== null && account.heldUntil > now ? theme.colors.statusWarning : theme.colors.foregroundMuted }}>
                            {rowAgeText(account.usageAt, account.heldUntil, now, strings)}
                          </Text>
                        )}
                        <RefreshDot
                          theme={theme}
                          label={`${strings.refreshAccount}: ${title}`}
                          busy={refreshing.includes(account.key)}
                          onPress={() => refreshRow(account)}
                        />
                      </View>
                    )}
                    </View>
                    {armed === account.switchTo && <Banner theme={theme} tone="warn" text={strings.switchBusy} />}
                  </View>
                );
              })}
            </View>
          )}
          {warning !== null && <Banner theme={theme} tone="warn" text={warning} />}
          {unread !== null && (
            <Button
              theme={theme}
              label={strings.showUsage}
              variant="ghost"
              disabled={reveal.isPending}
              onPress={() => reveal.mutate(unread.switchTo)}
            />
          )}
        </>
      ) : isError ? (
        loadFailedBanner
      ) : (
        <View style={{ gap: 6 }}>
          <Skeleton theme={theme} height={56} />
          <Skeleton theme={theme} height={56} />
        </View>
      )}
      {notice !== null && <Banner theme={theme} tone={notice.tone} text={notice.text} />}
    </View>
  );
}

/** Every pill registered right now, so a settings change can show or hide them all. */
const livePills = new Set<PluginButtonRegistration>();

/**
 * Shows or hides every pill. A hidden pill's icon is unmounted by the host, so the icon
 * can hide its own pill but never bring it back; the settings screen calls this instead.
 */
export function setPillsVisible(visible: boolean): void {
  for (const pill of livePills) pill.update({ visible });
}

/** Attaches one pill per Claude agent as the daemon reports them (see pill-registry.ts). */
export function contributeClient(client: PluginClientContext) {
  const registry = createPillRegistry({
    attach(agentId, workspaceId) {
      const strings = t(detectAppLocale());
      const registration: { current: PluginButtonRegistration | null } = { current: null };
      const created = client.addComposerPill({
        id: "account",
        workspaceId,
        agentId,
        button: {
          title: strings.sidebarTitle,
          label: strings.pillUnread,
          icon: (iconProps: PluginButtonIconProps) => <AccountPillIcon {...iconProps} registration={registration} />,
          visible: true,
          behavior: { kind: "popover", Content: AccountPopover },
        },
      });
      registration.current = created;
      livePills.add(created);
      return {
        ...created,
        update: (patch) => created.update(patch),
        remove: () => {
          livePills.delete(created);
          created.remove();
        },
      };
    },
  });

  return trackClaudeAgents(client.paseo.agents, registry, async () => (await client.rpc(claudeProvidersRpc, {})).providers);
}
