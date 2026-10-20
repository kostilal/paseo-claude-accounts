import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { detectAppLocale } from "./client/locale.ts";
import { contributeClient } from "./client/pill.tsx";
import { AccountsSurface } from "./client/screen.tsx";
import { AccountsSettings } from "./client/settings.tsx";
import { contributeWorkspaceButtons } from "./client/workspace.tsx";
import { accountSearchRpc } from "./shared/attach.ts";
import { t } from "./shared/i18n.ts";

function AccountsSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow icon="Users" active={currentScreen?.screenId === "main"} onPress={() => openScreen({ screenId: "main" })} />
  );
}

export default function contribute(client: PluginClientContext) {
  // Titles are fixed at registration, before the plugin's own language preference can be
  // read, so they follow Paseo's language; the surfaces follow the preference.
  const strings = t(detectAppLocale());
  const removers = [
    client.addScreen({ id: "main", title: strings.sidebarTitle, Component: AccountsSurface }),
    client.addSidebarHeaderItem({ id: "main", title: strings.sidebarTitle, Component: AccountsSidebarItem }),
    client.addSettingsScreen({ id: "preferences", title: strings.sidebarTitle, icon: "Users", Component: AccountsSettings }),
    contributeClient(client),
    contributeWorkspaceButtons(client),
    // Where a chat started from the new-workspace screen chooses its account: that screen has
    // no workspace yet, so no header button.
    client.addAttachmentSource({
      id: "account",
      title: strings.attachTitle,
      icon: "Users",
      pickerTitle: strings.attachPickerTitle,
      searchPlaceholder: strings.attachSearch,
      search: accountSearchRpc,
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
