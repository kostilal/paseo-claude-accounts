import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { forecastRpc } from "../shared/forecast.ts";
import { defaultPreferences, preferences } from "../shared/settings.ts";
import { useStrings } from "./locale.ts";
import { type Signal, sidebarSignal } from "./signal.ts";
import { typeScale } from "./typography.ts";
import { RADIUS } from "./ui.tsx";

/** The fewest chart columns the forecast takes: the row reads only the hints. */
const COLUMNS = 12;
/** A wash of the tone under the capsule, so the word and icon stay the loudest part. */
const WASH_OPACITY = 0.16;

const looks: Record<Signal["kind"], { icon: string; tone: "statusSuccess" | "statusWarning" | "statusDanger" }> = {
  push: { icon: "Rocket", tone: "statusSuccess" },
  "ease-off": { icon: "Hand", tone: "statusDanger" },
  empty: { icon: "Hourglass", tone: "statusWarning" },
  "on-pace": { icon: "ThumbsUp", tone: "statusSuccess" },
};

/**
 * The forecast at the right of the Accounts row: push, ease off, empty, or on pace, as a small
 * capsule in the tone's colour. It asks for the forecast the screen shows, over the same ticked
 * accounts, so the two agree; the screen's fresh readings refresh it too, through the shared
 * query key. Nothing is drawn while there is nothing to say.
 */
export function ForecastSignal({ theme }: { theme: PluginTheme }) {
  const strings = useStrings();
  const state = useSettings(preferences);
  const values = state.status === "ready" ? state.values : defaultPreferences;
  const ask = useRpc(forecastRpc);
  const input = { unchecked: values.forecastUnchecked, capacity: values.forecastCapacity, columns: COLUMNS };
  const { data } = useQuery({
    queryKey: ["accounts", "forecast", input],
    queryFn: () => ask(input),
    enabled: state.status !== "loading",
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const signal = sidebarSignal(data, Date.now(), strings);
  if (signal === null) return null;

  const { icon, tone } = looks[signal.kind];
  const colour = theme.colors[tone];
  return (
    <View
      accessible
      accessibilityLabel={signal.label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 2,
        paddingHorizontal: 7,
        borderRadius: RADIUS.pill,
        overflow: "hidden",
      }}
    >
      <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colour, opacity: WASH_OPACITY }} />
      <Icon name={icon} size={12} color={colour} />
      <Text numberOfLines={1} style={{ ...typeScale.chip, color: colour }}>
        {signal.word}
      </Text>
      {signal.figure === "" ? null : (
        <Text numberOfLines={1} style={{ ...typeScale.chip, color: colour, fontVariant: ["tabular-nums"] }}>
          {signal.figure}
        </Text>
      )}
    </View>
  );
}
