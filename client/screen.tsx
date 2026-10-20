import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  connectAccount,
  fetchUsage,
  listAccounts,
  loginAccount,
  removeAccount,
  unhideAccount,
  type AccountView,
  type HiddenView,
} from "../shared/accounts.ts";
import { loginLabel } from "../shared/identity.ts";
import { switchAllRpc } from "../shared/switch.ts";
import type { Strings } from "../shared/i18n.ts";
import { useStrings } from "./locale.ts";
import { PROVIDERS, type ProviderId, providerForHome } from "../shared/providers.ts";
import { formatWait, providerName, tightestOf } from "./format.ts";
import { revealNotice } from "./reveal-notice.ts";
import { AccountRing } from "./ring.tsx";
import { typeScale } from "./typography.ts";
import { Banner, Button, Card, Chip, EmptyState, Meter, RADIUS, Screen, ScreenHeader, SectionLabel, Skeleton } from "./ui.tsx";

/** A row is named by its login, falling back to the directory name. */
function loginTitle(row: AccountView, strings: Strings): string {
  return loginLabel(
    { email: row.email, orgName: row.orgName, plan: "" },
    row.name !== "" ? row.name : strings.notLoggedIn,
  );
}

function shortenPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** e.g. "Claude · max · 18%": provider, plan, and the tightest window when known. */
function detailLine(row: AccountView, strings: Strings): string {
  const parts = [providerName(row.provider)];
  if (!row.loggedIn) {
    parts.push(strings.notLoggedIn);
    return parts.join(" · ");
  }
  if (row.subscriptionType !== "") parts.push(row.subscriptionType);
  const tightest = tightestOf(row.fiveHour, row.sevenDay);
  if (tightest !== null) parts.push(`${Math.round(tightest)}%`);
  return parts.join(" · ");
}

interface RowMutation<D> {
  isPending: boolean;
  variables: string | undefined;
  isError: boolean;
  error: unknown;
  isSuccess: boolean;
  data: D | undefined;
}

/**
 * A row's two-step Delete. Inline rather than a native Alert so it behaves the same on
 * desktop, web and mobile. The confirmation text spells out that Delete neither logs out
 * nor wipes the directory.
 */
interface DeleteState {
  confirming: boolean;
  pending: boolean;
  /** A translated failure to show under the row, or null. */
  notice: string | null;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function DeleteButton({ theme, strings, state }: { theme: PluginTheme; strings: Strings; state: DeleteState }) {
  if (state.confirming) return null;
  return <Button theme={theme} label={strings.deleteAccount} variant="danger" disabled={state.pending} onPress={state.onAsk} />;
}

function DeleteConfirm({
  theme,
  strings,
  state,
  question,
}: {
  theme: PluginTheme;
  strings: Strings;
  state: DeleteState;
  question: string;
}) {
  return (
    <>
      {state.confirming && (
        <View style={{ gap: 8 }}>
          <Text style={{ ...typeScale.body, color: theme.colors.foreground }}>{question}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button theme={theme} label={strings.deleteYes} variant="danger" disabled={state.pending} onPress={state.onConfirm} />
            <Button theme={theme} label={strings.cancel} variant="ghost" disabled={state.pending} onPress={state.onCancel} />
          </View>
        </View>
      )}
      {state.notice !== null && <Banner theme={theme} tone="bad" text={state.notice} />}
    </>
  );
}

/** "Move all chats here", confirmed and answered in its own label so the card never shifts:
 *  the first press arms it, a second press within a few seconds moves the chats, and the
 *  outcome stays on the button for a moment before it goes back to rest. Reasons for a
 *  refusal or a failed restart go to the plugin log. */
interface MoveAllState {
  /** Whether the row can be switched to at all; the server refuses the rest anyway. */
  available: boolean;
  label: string;
  armed: boolean;
  pending: boolean;
  onPress: () => void;
}

function MoveAllButton({ theme, state }: { theme: PluginTheme; state: MoveAllState }) {
  if (!state.available) return null;
  return (
    <Button
      theme={theme}
      label={state.label}
      icon="Users"
      variant={state.armed ? "primary" : "ghost"}
      disabled={state.pending}
      onPress={state.onPress}
    />
  );
}

function moveAllSummary(
  result: { code: string; moved: number; failed: number; skipped: number },
  strings: Strings,
): string {
  if (result.code !== "") return strings.moveAllError;
  const parts = [strings.moveAllDone.replace("{moved}", String(result.moved))];
  if (result.skipped > 0) parts.push(strings.moveAllBusy.replace("{skipped}", String(result.skipped)));
  if (result.failed > 0) parts.push(strings.moveAllFailed.replace("{failed}", String(result.failed)));
  return parts.join(" · ");
}

function LoginCard({
  theme,
  row,
  strings,
  showUsage,
  onShowUsage,
  logIn,
  onLogIn,
  deleting,
  moving,
}: {
  theme: PluginTheme;
  row: AccountView;
  strings: Strings;
  showUsage: RowMutation<{ usageErrorCode: "" | "unknown-account"; usageError: string }>;
  onShowUsage: () => void;
  logIn: RowMutation<{ code: "" | "no-workspace" | "unknown-account"; error: string; terminal: string }>;
  onLogIn: () => void;
  deleting: DeleteState;
  moving: MoveAllState;
}) {
  const title = loginTitle(row, strings);
  const tightest = tightestOf(row.fiveHour, row.sevenDay);
  const revealFailure = row.loggedIn ? revealNotice(showUsage, row.switchTo, strings) : null;
  const now = Date.now();

  // Only failures: an opened terminal says what to do and when it is done, and a note that it
  // opened would outlive the approval.
  const terminalNotice = (
    m: RowMutation<{ code: "" | "no-workspace" | "unknown-account"; error: string; terminal: string }>,
    id: string,
    failed: string,
  ): { text: string; tone: "info" | "bad" } | null => {
    if (m.variables !== id) return null;
    if (m.isError) return { text: `${failed} ${errorText(m.error)}`, tone: "bad" };
    if (m.data === undefined) return null;
    if (m.data.code === "no-workspace") return { text: strings.noWorkspace, tone: "bad" };
    if (m.data.code === "unknown-account") return { text: strings.usageUnknownAccount, tone: "bad" };
    if (m.data.error !== "") return { text: `${failed} ${m.data.error}`, tone: "bad" };
    return null;
  };
  const loginState = terminalNotice(logIn, row.id, strings.loginFailed);

  const resetSuffix = (bar: { resetsAt: string } | null) =>
    bar !== null && Number.isFinite(Date.parse(bar.resetsAt))
      ? ` · ${strings.resetIn} ${formatWait(Math.max(0, Date.parse(bar.resetsAt) - now), strings)}`
      : "";

  return (
    <Card theme={theme}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <AccountRing theme={theme} size={36} provider={row.provider} tightest={tightest} dim={!row.loggedIn} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...typeScale.title, color: theme.colors.foreground }} numberOfLines={1}>
            {title}
          </Text>
          <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }} numberOfLines={1}>
            {detailLine(row, strings)}
          </Text>
        </View>
        <View style={{ flexShrink: 0, flexDirection: "row", gap: 6 }}>
          {row.isDefault && <Chip theme={theme} label={strings.defaultAccount} />}
          {row.autoNow && <Chip theme={theme} label={strings.autoNowBadge} />}
        </View>
      </View>

      {row.loggedIn && (row.fiveHour !== null || row.sevenDay !== null) && (
        <View style={{ gap: 8 }}>
          <Meter theme={theme} label={`${strings.fiveHourUsage}${resetSuffix(row.fiveHour)}`} bar={row.fiveHour} />
          <Meter theme={theme} label={`${strings.sevenDayUsage}${resetSuffix(row.sevenDay)}`} bar={row.sevenDay} />
        </View>
      )}

      {row.loggedIn && (row.usage === "unauthorised" || row.usage === "error") ? (
        revealFailure !== null ? (
          <Banner
            theme={theme}
            tone="bad"
            text={`${strings.usageReadFailed} ${revealFailure}`}
            action={{ label: strings.showUsage, onPress: onShowUsage }}
          />
        ) : null
      ) : null}
      {revealFailure === null && row.usageErrorCode === "unknown-account" && (
        <Banner theme={theme} tone="bad" text={strings.usageUnknownAccount} />
      )}
      {revealFailure === null && row.usageErrorCode === "" && row.usageError !== "" && (
        <Banner theme={theme} tone="bad" text={row.usageError} />
      )}
      {row.loggedIn && row.usage === "none" && (
        <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>{strings.noUsageAllowance}</Text>
      )}
      {row.loggedIn && row.usage === "expired" && (
        <Text style={{ ...typeScale.meta, color: theme.colors.statusDanger }}>{strings.usageExpired}</Text>
      )}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {row.loggedIn && (row.usage === "unauthorised" || row.usage === "error") && revealFailure === null && (
          <Button theme={theme} label={strings.showUsage} variant="ghost" disabled={showUsage.isPending} onPress={onShowUsage} />
        )}
        {(!row.loggedIn || row.usage === "expired") && (
          <Button theme={theme} label={strings.logIn} variant="ghost" disabled={logIn.isPending} onPress={onLogIn} />
        )}
        <MoveAllButton theme={theme} state={moving} />
        <DeleteButton theme={theme} strings={strings} state={deleting} />
      </View>
      <DeleteConfirm theme={theme} strings={strings} state={deleting} question={strings.deleteConfirm} />
      {loginState !== null && <Banner theme={theme} tone={loginState.tone} text={loginState.text} />}
    </Card>
  );
}

export function AccountsSurface({ theme, layout }: PluginSurfaceProps) {
  const strings = useStrings();
  const fetchOverview = useRpc(listAccounts);
  const askUsage = useRpc(fetchUsage);
  const startLogin = useRpc(loginAccount);
  const doConnect = useRpc(connectAccount);
  const doRemove = useRpc(removeAccount);
  const doUnhide = useRpc(unhideAccount);
  const doMoveAll = useRpc(switchAllRpc);
  const queryClient = useQueryClient();
  const overviewKey = ["accounts", "overview"];
  // Logins run in a terminal the screen cannot observe, so for a few minutes after one
  // starts the list is polled faster and bypasses the identity cache.
  const [watchUntil, setWatchUntil] = useState(0);
  const watching = Date.now() < watchUntil;
  const { data, isError, error, refetch } = useQuery({
    queryKey: overviewKey,
    queryFn: () => fetchOverview({ refresh: watching, force: false }),
    refetchInterval: watching ? 8_000 : 30_000,
  });
  const invalidate = () => {
    setWatchUntil(Date.now() + 5 * 60_000);
    void queryClient.invalidateQueries({ queryKey: overviewKey });
    void queryClient.invalidateQueries({ queryKey: ["accounts", "pill"] });
  };

  // The forced read only refreshes the daemon's caches; the screen then shows a fresh
  // ordinary read. Writing the forced result directly would race in-flight polls and deletes.
  // Awaited so the button stays busy until the screen has updated.
  const reload = useMutation({
    mutationFn: () => fetchOverview({ refresh: true, force: true }),
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: ["accounts", "pill"] });
      await queryClient.invalidateQueries({ queryKey: overviewKey });
    },
  });

  const showUsage = useMutation({
    mutationFn: (account: string) => askUsage({ account }),
    onSuccess: (row) =>
      queryClient.setQueryData(overviewKey, (old: typeof data) =>
        old === undefined
          ? old
          : {
              ...old,
              accounts: old.accounts.map((a) =>
                a.id === row.id
                  ? { ...a, usage: row.usage, fiveHour: row.fiveHour, sevenDay: row.sevenDay, usageErrorCode: row.usageErrorCode, usageError: row.usageError }
                  : a,
              ),
            },
      ),
  });

  const logIn = useMutation({
    mutationFn: (account: string) => startLogin({ account }),
    onSuccess: invalidate,
  });

  const add = useMutation({
    // Use the suggestion's own provider, so a discovered `~/.codex-*` is not registered as Claude.
    mutationFn: (home: string) =>
      doConnect({ provider: providerForHome(home) ?? "claude", home, label: "", login: false }),
    onSuccess: invalidate,
  });

  // Keyed by row `id` so only the pressed row asks. A registered row is a login and may span
  // several directories, so it sends all its `accountIds`; a suggestion sends its path, which
  // the server then hides from discovery.
  const [confirming, setConfirming] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (input: { row: string; accounts: string[] }) => doRemove({ accounts: input.accounts }),
    onSuccess: (result) => {
      if (result.code !== "") return;
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: overviewKey });
      void queryClient.invalidateQueries({ queryKey: ["accounts", "pill"] });
    },
  });
  const deleteState = (row: AccountView): DeleteState => {
    const mine = remove.variables?.row === row.id;
    let notice: string | null = null;
    if (mine && remove.isError) notice = `${strings.deleteFailed} ${errorText(remove.error)}`;
    else if (mine && remove.data?.code === "registry-unreadable") notice = strings.deleteRegistryUnreadable;
    else if (mine && remove.data?.code === "unknown-account") notice = strings.usageUnknownAccount;
    const targets = row.registered && row.accountIds.length > 0 ? row.accountIds : [row.id];
    return {
      confirming: confirming === row.id,
      pending: remove.isPending && mine,
      notice,
      onAsk: () => {
        remove.reset();
        setConfirming(row.id);
      },
      onCancel: () => setConfirming(null),
      onConfirm: () => remove.mutate({ row: row.id, accounts: targets }),
    };
  };

  // Keyed by row `id`; the server moves chats to the row's `switchTo`. An armed press and a
  // shown outcome both lapse after a few seconds.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(() => setArmed(null), 5_000);
    return () => clearTimeout(timer);
  }, [armed]);
  const moveAll = useMutation({
    mutationFn: (input: { row: string; account: string }) => doMoveAll({ account: input.account }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["accounts", "pill"] }),
  });
  const moveAllSettled = moveAll.isSuccess || moveAll.isError;
  useEffect(() => {
    if (!moveAllSettled) return;
    const timer = setTimeout(() => moveAll.reset(), 5_000);
    return () => clearTimeout(timer);
  }, [moveAllSettled]);
  const moveAllState = (row: AccountView): MoveAllState => {
    const mine = moveAll.variables?.row === row.id;
    let label = strings.moveAllChats;
    if (mine && moveAll.isPending) label = strings.moveAllRunning;
    else if (mine && moveAll.isError) label = strings.moveAllError;
    else if (mine && moveAll.data !== undefined) label = moveAllSummary(moveAll.data, strings);
    else if (armed === row.id) label = strings.moveAllConfirm;
    return {
      available: row.registered && row.loggedIn && row.switchTo !== "",
      label,
      armed: armed === row.id,
      pending: moveAll.isPending,
      onPress: () => {
        if (armed === row.id) {
          setArmed(null);
          moveAll.mutate({ row: row.id, account: row.switchTo });
        } else {
          moveAll.reset();
          setArmed(row.id);
        }
      },
    };
  };

  // Collapsed by default. Restoring only lets a directory back into discovery, where it
  // reappears as a suggestion.
  const [showingHidden, setShowingHidden] = useState(false);
  const restore = useMutation({
    mutationFn: (home: string) => doUnhide({ homes: [home] }),
    onSuccess: (result) => {
      if (result.code !== "") return;
      void queryClient.invalidateQueries({ queryKey: overviewKey });
    },
  });
  const restoreNotice = (row: HiddenView): string | null => {
    if (restore.variables !== row.home) return null;
    if (restore.isError) return `${strings.restoreFailed} ${errorText(restore.error)}`;
    if (restore.data?.code === "registry-unreadable") return strings.deleteRegistryUnreadable;
    return null;
  };

  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<ProviderId>("claude");
  const connect = useMutation({
    mutationFn: (input: { provider: ProviderId }) => doConnect({ provider: input.provider, home: "", label: "", login: true }),
    onSuccess: invalidate,
  });

  // A registered directory with no login is not an account, so it gets no row; a discovered
  // directory for a login already listed is not a suggestion.
  const registered = (data?.accounts ?? []).filter((account) => account.registered && account.loggedIn);
  const knownKeys = new Set(registered.map((account) => account.key));
  const suggested = (data?.accounts ?? []).filter((account) => !account.registered && !knownKeys.has(account.key));

  const addButton = (
    <Button theme={theme} label={strings.addAccount} icon="Plus" onPress={() => setAdding(true)} />
  );

  return (
    <Screen theme={theme} layout={layout}>
      <ScreenHeader
        theme={theme}
        layout={layout}
        icon="Users"
        title={strings.accounts}
        subtitle={strings.screenSubtitle}
        trailing={
          <Button
            theme={theme}
            label={reload.isPending ? strings.reloading : strings.reload}
            icon="RefreshCw"
            variant="ghost"
            disabled={reload.isPending}
            onPress={() => reload.mutate()}
          />
        }
      />
      {reload.isError && (
        <Banner
          theme={theme}
          tone="bad"
          text={`${strings.reloadFailed} ${errorText(reload.error)}`}
          action={{ label: strings.retry, onPress: () => reload.mutate() }}
        />
      )}

      {data !== undefined ? (
        <>
          {isError && (
            <Banner
              theme={theme}
              tone="bad"
              text={`${strings.pillLoadFailed} ${errorText(error)}`}
              action={{ label: strings.retry, onPress: () => void refetch() }}
            />
          )}
          {data.error === "claude-not-found" && <Banner theme={theme} tone="bad" text={strings.claudeNotFound} />}
          {data.overridingVar !== "" && (
            <Banner theme={theme} tone="bad" text={strings.apiKeyOverride.replace("{var}", data.overridingVar)} />
          )}

          {registered.length === 0 ? (
            <Card theme={theme}>
              <EmptyState theme={theme} icon="Users" title={strings.noAccountsTitle} detail={strings.noAccountsDetail} />
              <View style={{ alignItems: "center" }}>
                <Button theme={theme} label={strings.logIn} icon="LogIn" onPress={() => setAdding(true)} />
              </View>
            </Card>
          ) : (
            <>
              {registered.map((row) => (
                <LoginCard
                  key={row.id}
                  theme={theme}
                  row={row}
                  strings={strings}
                  showUsage={showUsage}
                  onShowUsage={() => showUsage.mutate(row.switchTo)}
                  logIn={logIn}
                  onLogIn={() => logIn.mutate(row.id)}
                  deleting={deleteState(row)}
                  moving={moveAllState(row)}
                />
              ))}
              <View style={{ flexDirection: "row" }}>{addButton}</View>
            </>
          )}

          {suggested.length > 0 && (
            <>
              <SectionLabel theme={theme}>{strings.suggestions}</SectionLabel>
              {suggested.map((account) => (
                <Card key={account.id} theme={theme}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <AccountRing theme={theme} size={28} provider={account.provider} tightest={null} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ ...typeScale.title, color: theme.colors.foreground }} numberOfLines={1}>
                        {loginTitle(account, strings)}
                      </Text>
                      <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }} numberOfLines={1}>
                        {shortenPath(account.home || account.id)}
                      </Text>
                    </View>
                    <Button
                      theme={theme}
                      label={strings.add}
                      variant="ghost"
                      disabled={add.isPending && add.variables === account.id}
                      onPress={() => add.mutate(account.id)}
                    />
                    <DeleteButton theme={theme} strings={strings} state={deleteState(account)} />
                  </View>
                  <DeleteConfirm
                    theme={theme}
                    strings={strings}
                    state={deleteState(account)}
                    question={strings.deleteSuggestionConfirm}
                  />
                  {add.isError && add.variables === account.id && (
                    <Banner theme={theme} tone="bad" text={errorText(add.error)} />
                  )}
                </Card>
              ))}
            </>
          )}

          {data.hidden.length > 0 && (
            <>
              <View style={{ flexDirection: "row" }}>
                <Button
                  theme={theme}
                  label={showingHidden ? strings.collapseHidden : `${strings.showHidden} (${data.hidden.length})`}
                  icon={showingHidden ? undefined : "Eye"}
                  variant="ghost"
                  onPress={() => setShowingHidden(!showingHidden)}
                />
              </View>
              {showingHidden && (
                <>
                  <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>{strings.hiddenHint}</Text>
                  {data.hidden.map((row) => {
                    const notice = restoreNotice(row);
                    return (
                      <Card key={row.home} theme={theme}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={{ ...typeScale.title, color: theme.colors.foreground }} numberOfLines={1}>
                              {row.loggedIn
                                ? loginLabel({ email: row.email, orgName: row.orgName, plan: "" }, row.name)
                                : row.name}
                            </Text>
                            <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }} numberOfLines={1}>
                              {row.loggedIn ? shortenPath(row.home) : `${shortenPath(row.home)} · ${strings.hiddenNoLogin}`}
                            </Text>
                          </View>
                          <Button
                            theme={theme}
                            label={strings.restore}
                            variant="ghost"
                            disabled={restore.isPending && restore.variables === row.home}
                            onPress={() => restore.mutate(row.home)}
                          />
                        </View>
                        {notice !== null && <Banner theme={theme} tone="bad" text={notice} />}
                      </Card>
                    );
                  })}
                </>
              )}
            </>
          )}
        </>
      ) : isError ? (
        <Banner
          theme={theme}
          tone="bad"
          text={`${strings.pillLoadFailed} ${errorText(error)}`}
          action={{ label: strings.retry, onPress: () => void refetch() }}
        />
      ) : (
        <>
          <Skeleton theme={theme} height={150} radius={RADIUS.card} />
          <Skeleton theme={theme} height={150} radius={RADIUS.card} />
        </>
      )}

      <Modal title={strings.addAccount} open={adding} onOpenChange={setAdding}>
        <Modal.Content>
          <View style={{ gap: 14 }}>
            <SectionLabel theme={theme}>{strings.chooseProvider}</SectionLabel>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {Object.values(PROVIDERS).map((spec) => (
                <Chip
                  key={spec.id}
                  theme={theme}
                  label={spec.supported ? providerName(spec.id) : `${providerName(spec.id)} · ${strings.providerNotSupported}`}
                  selected={provider === spec.id}
                  disabled={!spec.supported}
                  onPress={() => setProvider(spec.id)}
                />
              ))}
            </View>
            <Text style={{ ...typeScale.body, color: theme.colors.foregroundMuted }}>{strings.loginHint}</Text>
            {connect.data !== undefined && connect.data.code === "" && (
              <Banner theme={theme} tone="info" text={strings.loginOpened} />
            )}
            {connect.data !== undefined && connect.data.code === "no-workspace" && (
              <Banner theme={theme} tone="bad" text={strings.noWorkspace} />
            )}
            {connect.data !== undefined && connect.data.code !== "" && connect.data.code !== "no-workspace" && (
              <Banner theme={theme} tone="bad" text={connect.data.error !== "" ? connect.data.error : connect.data.code} />
            )}
            {connect.isError && <Banner theme={theme} tone="bad" text={errorText(connect.error)} />}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button theme={theme} label={strings.cancel} variant="ghost" onPress={() => setAdding(false)} />
              <Button
                theme={theme}
                label={`${strings.logIn} · ${providerName(provider)}`}
                icon="LogIn"
                disabled={connect.isPending || !PROVIDERS[provider].supported}
                onPress={() => connect.mutate({ provider })}
              />
            </View>
          </View>
        </Modal.Content>
      </Modal>
    </Screen>
  );
}
