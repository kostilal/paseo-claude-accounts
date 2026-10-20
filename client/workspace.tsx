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
import { type WorkspaceState, workspaceStateRpc } from "../shared/workspace.ts";
import { tightestOf, usageLine, weekLine } from "./format.ts";
import { detectAppLocale, useStrings } from "./locale.ts";
import { loginTitle } from "./pill.tsx";
import { AccountRing } from "./ring.tsx";
import { typeScale } from "./typography.ts";
import { Banner, EmptyState, Skeleton } from "./ui.tsx";
import { trackWorkspaces } from "./workspace-registry.ts";


/** The Auto row's title: what Auto would pick for a new chat now. */
function autoTitle(state: WorkspaceState, strings: Strings): string {
  const named = state.accounts.find((row) => row.accountIds.includes(state.next.account));
  if (state.default !== AUTO || named === undefined) return strings.workspaceAutoNone;
  return strings.workspaceAuto.replace("{label}", loginTitle(named, strings));
}

/**
 * The header button's popover: the account every new chat opens on. Auto picks one by its
 * allowance as each chat opens; an account pins it. Open chats keep theirs: the pill above a
 * chat's composer switches that one chat.
 */
function DefaultPopover(props: PluginButtonContentProps) {
  const { theme, layout, workspaceId, close } = props;
  const strings = useStrings();
  const askState = useRpc(workspaceStateRpc);
  const setDefault = useRpc(setDefaultRpc);
  const queries = useQueryClient();
  const [failed, setFailed] = useState(false);

  const { data, isError } = useQuery({
    queryKey: ["accounts", "default", workspaceId],
    queryFn: () => askState({ workspaceId, provider: "claude", manual: false }),
    refetchInterval: 5_000,
  });

  function choose(account: string) {
    setFailed(false);
    void setDefault({ provider: "claude", account })
      .then((result) => {
        if (result.code !== "") return setFailed(true);
        close();
      }, () => setFailed(true))
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
            <Row theme={theme} title={autoTitle(data, strings)} selected={data.default === AUTO} onPress={() => choose(AUTO)} />
            {rows.map((row) => (
              <Row
                key={row.key}
                theme={theme}
                title={loginTitle(row, strings)}
                account={row}
                now={now}
                strings={strings}
                selected={data.default !== AUTO && row.accountIds.includes(data.default)}
                onPress={() => choose(row.switchTo)}
              />
            ))}
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
      {failed && <Banner theme={theme} tone="bad" text={strings.defaultSettingFailed} />}
    </View>
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
        behavior: { kind: "popover", Content: DefaultPopover },
      },
    });
  });
}
