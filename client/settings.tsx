import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { type Strings, t } from "../shared/i18n.ts";
import { detectAppLocale } from "./locale.ts";
import { type Preferences, defaultPreferences, preferences } from "../shared/settings.ts";
import { setPillsVisible } from "./pill.tsx";
import { typeScale } from "./typography.ts";
import { Banner } from "./ui.tsx";

/** Settings → Plugins → Accounts. Two rows: the language, and whether the pill shows. */
export function AccountsSettings({ theme }: PluginSurfaceProps) {
  const state = useSettings(preferences);
  const values: Preferences = state.status === "ready" ? state.values : defaultPreferences;
  const strings: Strings = t(values.language === "auto" ? detectAppLocale() : values.language);
  const busy = state.status !== "ready" || state.saving;
  const ready = state.status === "ready";

  useEffect(() => {
    if (ready) setPillsVisible(values.showPill);
  }, [ready, values.showPill]);

  const save = (patch: Partial<Preferences>) => {
    if (state.status !== "ready") return;
    void state.save({ ...state.values, ...patch }, state.revision);
  };

  return (
    <View style={{ gap: 12 }}>
      <SettingsSection title={strings.settingsTitle}>
        <SettingsCard>
          <SettingsSelect
            label={strings.languageLabel}
            value={values.language}
            options={[
              { label: strings.languageAuto, value: "auto" },
              { label: "English", value: "en" },
              { label: "Русский", value: "ru" },
              { label: "Українська", value: "uk" },
            ]}
            disabled={busy}
            onValueChange={(language) => save({ language })}
          />
          <SettingsSwitch
            label={strings.showPill}
            hint={strings.showPillHint}
            value={values.showPill}
            disabled={busy}
            onValueChange={(showPill) => save({ showPill })}
          />
        </SettingsCard>
      </SettingsSection>
      {state.status === "error" || state.status === "invalid" ? (
        <Banner theme={theme} tone="bad" text={state.error} />
      ) : null}
      {state.saveError !== null && <Banner theme={theme} tone="bad" text={state.saveError} />}
      <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>{strings.settingsHint}</Text>
    </View>
  );
}
