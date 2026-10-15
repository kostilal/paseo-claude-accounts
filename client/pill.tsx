import {
  type PluginButtonContentProps,
  type PluginButtonIconProps,
  type PluginButtonRegistration,
  type PluginClientContext,
  useAgent,
  useRpc,
} from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { fetchUsage, mintToken } from "../shared/accounts.ts";
import { loginLabel } from "../shared/identity.ts";
import { PROVIDERS, type ProviderId } from "../shared/providers.ts";
import { type Strings, t } from "../shared/i18n.ts";
import { detectAppLocale, usePreferences, useStrings } from "./locale.ts";
import { type PillAccount, type SwitchCode, pillStateRpc, switchAccountRpc } from "../shared/switch.ts";
import { currentOf, exhaustedResetIn, hasSpare, pillFigure, tightestOf, usageLine } from "./format.ts";
import { createPillRegistry, trackClaudeAgents } from "./pill-registry.ts";
import { AccountRing } from "./ring.tsx";
import { typeScale } from "./typography.ts";
import { Banner, Button, EmptyState, Skeleton, meterTone } from "./ui.tsx";

/** A row is named by its login, not by the config directory holding it. */
function loginTitle(account: PillAccount, strings: Strings): string {
  return loginLabel(
    { email: account.email, orgName: account.orgName, plan: "" },
    account.label !== "" ? account.label : strings.notLoggedIn,
  );
}

function messageFor(code: SwitchCode, strings: Strings): string {
  switch (code) {
    case "paseo-not-found":
      return strings.switchPaseoMissing;
    case "missing-directory":
      return strings.switchMissingDirectory;
    case "unsupported-provider":
      return strings.switchUnsupportedProvider;
    case "no-token":
      return strings.switchNoToken;
    case "not-logged-in":
      return strings.switchNotLoggedIn;
    case "unknown-account":
      return strings.switchUnknownAccount;
    case "":
    case "reload-failed":
      return "";
  }
}

type NoticeTone = "info" | "warn" | "bad";

function rawErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function switchNotice(
  move: { isPending: boolean; isError: boolean; error: unknown; data: { code: SwitchCode; error: string } | undefined },
  strings: Strings,
): { text: string; tone: NoticeTone } | null {
  if (move.isPending) return { text: strings.switching, tone: "info" };
  if (move.isError) return { text: rawErrorText(move.error), tone: "bad" };
  if (move.data === undefined) return null;
  if (move.data.code === "reload-failed") return { text: move.data.error, tone: "bad" };
  if (move.data.code !== "") {
    const text = messageFor(move.data.code, strings);
    return text === "" ? null : { text, tone: "bad" };
  }
  return null;
}

const pillKey = (agentId: string) => ["accounts", "pill", agentId];

/**
 * The pill icon: a ring of the current account's tightest window, plus a green dot when the
 * allowance is (nearly) gone and another account could take over. The label beside it is
 * host-owned, so the figure is pushed through `registration.update()`.
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

  const { data } = useQuery({
    queryKey: pillKey(agentId),
    queryFn: () => askPill({ agentId, cwd: cwd ?? "", workspaceId, manual: false }),
    enabled: cwd !== null,
    refetchInterval: 30_000,
  });

  const current = data === undefined ? null : currentOf(data);
  // The host rejects an empty label (it throws inside addComposerPill), so use a placeholder.
  const figure = current === null ? strings.pillNoAccount : pillFigure(current, Date.now(), strings);
  const label = figure === "" ? strings.pillUnread : figure;
  useEffect(() => {
    registration.current?.update({ label, visible: showPill });
  }, [label, showPill, registration]);

  const tightest = current === null ? null : tightestOf(current.fiveHour, current.sevenDay);
  const exhausted = current !== null && exhaustedResetIn(current.fiveHour, current.sevenDay, Date.now()) !== null;
  const spare = data !== undefined && (exhausted || (tightest !== null && tightest >= 90)) && hasSpare(data);
  // The host clips anything larger than the icon slot.
  const ringSize = size;

  return (
    <View style={{ width: ringSize, height: ringSize }}>
      <AccountRing theme={theme} size={ringSize} provider={current?.provider ?? "claude"} tightest={tightest} />
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
 * this chat onto it; tapping one without a token mints one instead (opens a terminal).
 */
export function AccountPopover(props: PluginButtonContentProps) {
  const { theme, layout, workspaceId, close } = props;
  const agentId = props.context === "agent" ? props.agentId : "";
  const strings = useStrings();
  const askPill = useRpc(pillStateRpc);
  const askUsage = useRpc(fetchUsage);
  const doSwitch = useRpc(switchAccountRpc);
  const doMint = useRpc(mintToken);
  const queries = useQueryClient();
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const status = useAgent(agentId, (agent) => agent.status);
  const busy = status === "running" || status === "initializing";

  const key = pillKey(agentId);
  const { data, isError, error, refetch } = useQuery({
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

  const mint = useMutation({
    mutationFn: (home: string) => doMint({ home }),
    onSuccess: () => queries.invalidateQueries({ queryKey: key }),
  });

  const move = useMutation({
    mutationFn: (account: string) => doSwitch({ agentId, account }),
    onSuccess: async (result) => {
      await queries.invalidateQueries({ queryKey: key });
      if (result.code === "") close();
    },
  });

  // A press while the agent is working arms the row; a second press switches. Rows stay
  // pressable through a turn because noticing a limit happens while the agent is working.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!busy) setArmed(null);
  }, [busy]);

  /** Whether this provider switches via a minted token (as opposed to a config directory). */
  function canMint(account: PillAccount): boolean {
    return PROVIDERS[account.provider as ProviderId]?.switch.kind === "token";
  }

  function pressRow(account: PillAccount) {
    if (!account.hasToken) {
      // For a directory switch this means nobody is logged in; that is fixed from the Accounts screen.
      if (canMint(account)) mint.mutate(account.home);
      return;
    }
    if (busy && armed !== account.switchTo) {
      setArmed(account.switchTo);
      return;
    }
    setArmed(null);
    move.mutate(account.switchTo);
  }

  const notice = switchNotice(move, strings);
  const now = Date.now();
  const loadFailedBanner = (
    <Banner
      theme={theme}
      tone="bad"
      text={`${strings.pillLoadFailed} ${rawErrorText(error)}`}
      action={{ label: strings.retry, onPress: () => void refetch() }}
    />
  );

  const mintNotice = (): { text: string; tone: NoticeTone } | null => {
    if (mint.variables === undefined) return null;
    if (mint.isPending) return { text: strings.mintOpened, tone: "info" };
    if (mint.isError) return { text: `${strings.mintFailed} ${rawErrorText(mint.error)}`, tone: "bad" };
    if (mint.data === undefined) return null;
    if (mint.data.code === "no-workspace") return { text: strings.noWorkspace, tone: "bad" };
    if (mint.data.code === "unknown-account") return { text: strings.usageUnknownAccount, tone: "bad" };
    if (mint.data.error !== "") return { text: `${strings.mintFailed} ${mint.data.error}`, tone: "bad" };
    return { text: strings.mintOpened, tone: "info" };
  };
  const minted = mintNotice();

  const rows = data === undefined ? [] : data.accounts.filter((account) => account.loggedIn);
  const ordered = [...rows.filter((row) => row.current), ...rows.filter((row) => !row.current)];
  // The current account's usage could not be read: offer a manual reveal under the list.
  const unread = rows.find((row) => row.current && (row.usage === "unauthorised" || row.usage === "error")) ?? null;

  return (
    <View style={{ padding: layout.compact ? 10 : 12, gap: 8, minWidth: layout.compact ? 280 : 340, maxWidth: 420 }}>
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
            <ScrollView style={{ maxHeight: 420 }}>
              <View style={{ gap: 6 }}>
                {ordered.map((account) => {
                  const tightest = tightestOf(account.fiveHour, account.sevenDay);
                  const title = loginTitle(account, strings);
                  const pressable = !account.current && !move.isPending && !mint.isPending;
                  const tone =
                    tightest !== null && tightest >= 70 ? theme.colors[meterTone(tightest)] : theme.colors.foregroundMuted;
                  return (
                    <View key={account.key} style={{ gap: 6 }}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={title}
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
                        <AccountRing theme={theme} size={30} provider={account.provider} tightest={tightest} dim={!account.hasToken && !account.current} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ ...typeScale.body, fontWeight: "600", color: theme.colors.foreground }} numberOfLines={1}>
                            {title}
                          </Text>
                          <Text style={{ ...typeScale.meta, color: tone }} numberOfLines={1}>
                            {usageLine(account, now, strings)}
                          </Text>
                          {!account.current && !account.hasToken && (
                            <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }} numberOfLines={1}>
                              {canMint(account) ? strings.noTokenTap : strings.pillNotLoggedIn}
                            </Text>
                          )}
                          {account.usage === "expired" && (
                            <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }} numberOfLines={2}>
                              {strings.usageExpired}
                            </Text>
                          )}
                        </View>
                        {account.current ? (
                          <Icon name="Check" size={16} color={theme.colors.accent} />
                        ) : pressable ? (
                          <Icon
                            name={account.hasToken ? "ChevronRight" : canMint(account) ? "KeyRound" : "LogIn"}
                            size={16}
                            color={theme.colors.foregroundMuted}
                          />
                        ) : null}
                      </Pressable>
                      {armed === account.switchTo && <Banner theme={theme} tone="warn" text={strings.switchBusy} />}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          )}
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
      {minted !== null && <Banner theme={theme} tone={minted.tone} text={minted.text} />}
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

  return trackClaudeAgents(client.paseo.agents, registry);
}
