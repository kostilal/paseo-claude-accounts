import type { PluginButtonContentProps, PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type Strings, t } from "../shared/i18n.ts";
import type { PillAccount } from "../shared/switch.ts";
import { setDefaultRpc } from "../shared/defaults.ts";
import { AUTO } from "../shared/registry.ts";
import { type WorkspaceState, setWorkspaceRpc, workspaceStateRpc } from "../shared/workspace.ts";
import { tightestOf, usageLine, weekLine } from "./format.ts";
import { detectAppLocale, useStrings } from "./locale.ts";
import { loginTitle } from "./pill.tsx";
import { AccountRing } from "./ring.tsx";
import { typeScale } from "./typography.ts";
import { Banner, EmptyState, Skeleton } from "./ui.tsx";
import { trackWorkspaces } from "./workspace-registry.ts";

const workspaceKey = (workspaceId: string) => ["accounts", "workspace", workspaceId];

/** The first row's title: where a new chat goes when the workspace has no account of its own. */
function nextTitle(state: WorkspaceState, strings: Strings): string {
  const named = state.accounts.find((row) => row.accountIds.includes(state.next.account));
  const label = named === undefined ? state.next.account : loginTitle(named, strings);
  switch (state.next.source) {
    case "auto":
      return label === "" ? strings.workspaceAutoNone : strings.workspaceAuto.replace("{label}", label);
    case "default":
      return strings.workspaceDefault.replace("{label}", label);
    case "folder":
      return strings.workspaceFolder;
  }
}

/**
 * The workspace header button's popover: which account new chats here open on. The first row
 * gives the choice back to the default (an automatic pick, when that is the default); the
 * others pin the workspace to one login. Chats already open are not moved.
 */
function WorkspacePopover(props: PluginButtonContentProps) {
  const { theme, layout, workspaceId, close } = props;
  const strings = useStrings();
  const askState = useRpc(workspaceStateRpc);
  const setAccount = useRpc(setWorkspaceRpc);
  const setEverywhere = useRpc(setDefaultRpc);
  const queries = useQueryClient();
  const [failed, setFailed] = useState(false);
  const [failedDefault, setFailedDefault] = useState(false);

  const key = workspaceKey(workspaceId);
  const { data, isError } = useQuery({
    queryKey: key,
    queryFn: () => askState({ workspaceId, provider: "claude", manual: false }),
    refetchInterval: 5_000,
  });

  function choose(account: string) {
    setFailed(false);
    void setAccount({ workspaceId, provider: "claude", account })
      .then((result) => {
        if (result.code !== "") return setFailed(true);
        close();
      }, () => setFailed(true))
      .finally(() => void queries.invalidateQueries({ queryKey: key }));
  }

  /** The default for every new chat. The popover stays open, so the change is seen in both
   *  sections: workspaces an automatic pick placed (this one too, maybe) follow it. */
  function chooseEverywhere(account: string) {
    setFailedDefault(false);
    void setEverywhere({ provider: "claude", account })
      .then((result) => {
        if (result.code !== "") setFailedDefault(true);
      }, () => setFailedDefault(true))
      .finally(() => void queries.invalidateQueries({ queryKey: ["accounts"] }));
  }

  const now = Date.now();
  const rows = data === undefined ? [] : data.accounts.filter((row) => row.loggedIn);

  return (
    <View style={{ padding: layout.compact ? 10 : 12, gap: 8, minWidth: layout.compact ? 280 : 340, maxWidth: 420 }}>
      <Text style={{ ...typeScale.body, fontWeight: "600", color: theme.colors.foreground }}>{strings.workspaceTitle}</Text>
      <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>{strings.workspaceHint}</Text>
      {data !== undefined ? (
        rows.length === 0 ? (
          <EmptyState theme={theme} icon="Users" title={strings.pillEmptyTitle} detail={strings.pillEmptyDetail} />
        ) : (
          <View style={{ gap: 6 }}>
            <Row theme={theme} title={nextTitle(data, strings)} selected={data.account === ""} onPress={() => choose("")} />
            {rows.map((row) => (
              <Row
                key={row.key}
                theme={theme}
                title={loginTitle(row, strings)}
                account={row}
                now={now}
                strings={strings}
                selected={row.current}
                onPress={() => choose(row.switchTo)}
              />
            ))}
            <Text style={{ ...typeScale.body, fontWeight: "600", color: theme.colors.foreground, marginTop: 8 }}>
              {strings.workspaceEverywhere}
            </Text>
            <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>{strings.workspaceEverywhereHint}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Choice theme={theme} label={strings.workspaceAutoNone} selected={data.default === AUTO} onPress={() => chooseEverywhere(AUTO)} />
              {rows.map((row) => (
                <Choice
                  key={row.key}
                  theme={theme}
                  label={row.email || row.label}
                  selected={row.accountIds.includes(data.default)}
                  onPress={() => chooseEverywhere(row.switchTo)}
                />
              ))}
            </View>
          </View>
        )
      ) : isError ? (
        <Banner theme={theme} tone="bad" text={strings.pillLoadFailed} />
      ) : (
        <View style={{ gap: 6 }}>
          <Skeleton theme={theme} height={56} />
          <Skeleton theme={theme} height={56} />
        </View>
      )}
      {failed && <Banner theme={theme} tone="bad" text={strings.workspaceFailed} />}
      {failedDefault && <Banner theme={theme} tone="bad" text={strings.defaultSettingFailed} />}
    </View>
  );
}

/** A compact choice for the default, so the two sections do not read alike. */
function Choice(props: { theme: PluginButtonContentProps["theme"]; label: string; selected: boolean; onPress(): void }) {
  const { theme, label, selected, onPress } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.surface2 : theme.colors.surface1,
      }}
    >
      <Text style={{ ...typeScale.meta, color: theme.colors.foreground, fontWeight: selected ? "600" : "400" }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** One choice: a login with its allowance, or (without `account`) the default's row. */
function Row(props: {
  theme: PluginButtonContentProps["theme"];
  title: string;
  selected: boolean;
  onPress(): void;
  account?: PillAccount;
  now?: number;
  strings?: Strings;
}) {
  const { theme, title, selected, onPress, account, now = 0, strings } = props;
  const tightest = account === undefined ? null : tightestOf(account.fiveHour, account.sevenDay);
  const week = account === undefined || strings === undefined ? "" : weekLine(account, now, strings);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      hitSlop={2}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.surface2 : theme.colors.surface1,
      }}
    >
      {account !== undefined ? (
        <AccountRing theme={theme} size={30} provider={account.provider} tightest={tightest} />
      ) : (
        <Icon name="Sparkles" size={18} color={theme.colors.foregroundMuted} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...typeScale.body, fontWeight: "600", color: theme.colors.foreground }} numberOfLines={1}>
          {title}
        </Text>
        {account !== undefined && strings !== undefined && (
          <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }} numberOfLines={1}>
            {usageLine(account, now, strings)}
          </Text>
        )}
        {week !== "" && (
          <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }} numberOfLines={1}>
            {week}
          </Text>
        )}
      </View>
      {selected && <Icon name="Check" size={16} color={theme.colors.accent} />}
    </Pressable>
  );
}

/** A header button on every workspace, for the account its new chats open on. */
export function contributeWorkspaceButtons(client: PluginClientContext) {
  return trackWorkspaces(client.paseo.workspaces, (workspaceId) => {
    const strings = t(detectAppLocale());
    return client.addHeaderButton({
      id: "account",
      workspaceId,
      button: {
        title: strings.workspaceTitle,
        icon: "Users",
        visible: true,
        behavior: { kind: "popover", Content: WorkspacePopover },
      },
    });
  });
}
