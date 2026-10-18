import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { type DefaultProblem, defaultProblem, getDefaultRpc, refusalText, setDefaultRpc } from "../shared/defaults.ts";
import { type Strings, t } from "../shared/i18n.ts";
import { detectAppLocale } from "./locale.ts";
import { type Preferences, defaultPreferences, preferences } from "../shared/settings.ts";
import { setPillsVisible } from "./pill.tsx";
import { typeScale } from "./typography.ts";
import { Banner } from "./ui.tsx";

/** The select's value for "no default"; account ids are slugs, never this. */
const NONE = "";

/** Settings → Plugins → Accounts: the language, whether the pill shows, and the account new
 *  chats open on. */
export function AccountsSettings({ theme }: PluginSurfaceProps) {
  const state = useSettings(preferences);
  const values: Preferences = state.status === "ready" ? state.values : defaultPreferences;
  const strings: Strings = t(values.language === "auto" ? detectAppLocale() : values.language);
  const busy = state.status !== "ready" || state.saving;
  const ready = state.status === "ready";

  useEffect(() => {
    if (ready) setPillsVisible(values.showPill);
  }, [ready, values.showPill]);

  const askDefault = useRpc(getDefaultRpc);
  const saveDefault = useRpc(setDefaultRpc);
  // Plain state rather than a query: a settings screen is not promised the host's query client.
  const [current, setCurrent] = useState<Awaited<ReturnType<typeof askDefault>> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<{ code: string; label: string }>({ code: "", label: "" });
  const reload = useCallback(
    () =>
      askDefault({ provider: "claude" }).then(
        (answer) => {
          setCurrent(answer);
          setLoadFailed(false);
        },
        () => setLoadFailed(true),
      ),
    [askDefault],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  const chosen = current?.account ?? NONE;
  const options = current?.options ?? [];
  const labelOf = (id: string) => options.find((option) => option.id === id)?.label ?? id;
  const defaultChoices = [
    { label: strings.defaultSettingNone, value: NONE },
    ...options.map((option) => ({
      label: option.login === "" || option.login === option.label ? option.label : `${option.label} · ${option.login}`,
      value: option.id,
    })),
    // A default that is no longer offered (removed, key gone) still shows as what is set.
    ...(chosen !== NONE && !options.some((option) => option.id === chosen)
      ? [{ label: current?.label || chosen, value: chosen }]
      : []),
  ];
  const problem = current?.problem ?? "";

  const choose = (account: string) => {
    setSaving(true);
    void saveDefault({ provider: "claude", account })
      .then(
        (result) => setRefused({ code: result.code, label: labelOf(account) }),
        () => setRefused({ code: "failed", label: "" }),
      )
      .finally(() => {
        setSaving(false);
        void reload();
      });
  };

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
          <SettingsSelect
            label={strings.defaultSetting}
            hint={strings.defaultSettingHint}
            value={chosen}
            options={defaultChoices}
            disabled={current === null || saving}
            onValueChange={choose}
          />
        </SettingsCard>
      </SettingsSection>
      {current !== null && options.length === 0 && chosen === NONE ? (
        <Banner theme={theme} tone="warn" text={strings.defaultSettingEmpty} />
      ) : null}
      {problem !== "" ? (
        <Banner theme={theme} tone="bad" text={refusalText(strings, problem, { label: current?.label })} />
      ) : null}
      {loadFailed || refused.code === "failed" || refused.code === "registry-unreadable" || refused.code === "unsupported-provider" ? (
        <Banner theme={theme} tone="bad" text={strings.defaultSettingFailed} />
      ) : isProblem(refused.code) ? (
        <Banner theme={theme} tone="bad" text={refusalText(strings, refused.code, { label: refused.label })} />
      ) : null}
      {state.status === "error" || state.status === "invalid" ? (
        <Banner theme={theme} tone="bad" text={state.error} />
      ) : null}
      {state.saveError !== null && <Banner theme={theme} tone="bad" text={state.saveError} />}
      <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>{strings.settingsHint}</Text>
    </View>
  );
}

function isProblem(code: string): code is Exclude<DefaultProblem, ""> {
  return code !== "" && defaultProblem.safeParse(code).success;
}
