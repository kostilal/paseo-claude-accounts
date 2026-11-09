import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import type { AccountView } from "../shared/accounts.ts";
import {
  type AccountForecast,
  type Forecast,
  type ForecastAssumption,
  type ForecastExclusion,
  type ForecastHint,
  forecastRpc,
  onTrack,
  retitle,
} from "../shared/forecast.ts";
import type { Strings } from "../shared/i18n.ts";
import { loginName } from "../shared/identity.ts";
import { defaultPreferences, preferences } from "../shared/settings.ts";
import { dayTimeText, formatWait, shortLogins } from "./format.ts";
import { typeScale } from "./typography.ts";
import { Banner, Button, Card, Chip, SectionLabel, Skeleton } from "./ui.tsx";

type Layout = PluginSurfaceProps["layout"];

/** Fits three weekly resets with room to tell 5-hour spells apart, on a phone too. */
const COLUMNS_WIDE = 56;
const COLUMNS_COMPACT = 32;

const PLOT_HEIGHT = 150;
/** A wash under the line, so the reserve stays the loudest thing on the chart. */
const USABLE_OPACITY = 0.16;
const AXIS_WIDTH = 30;

/** The capacities offered by hand: Pro and the two multiples Anthropic names. */
const CAPACITY_CHOICES = [1, 5, 20];

const percent = (value: number) => `${Math.round(value)}%`;
const bounded = (value: number) => Math.max(0, Math.min(100, value));

/** Puts values into a catalogue string; each placeholder occurs once. */
function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, () => value), template);
}

function assumptionText(code: ForecastAssumption, strings: Strings): string {
  switch (code) {
    case "percent-only":
      return strings.forecastAssumePercentOnly;
    case "steady-pace":
      return strings.forecastAssumeSteadyPace;
    case "earliest-reset-first":
      return strings.forecastAssumeEarliestFirst;
    case "spend-ceiling":
      return strings.forecastAssumeSpendCeiling;
    case "short-window-restarts":
      return strings.forecastAssumeWindowRestarts;
    case "model-limits-ignored":
      return strings.forecastAssumeModelLimits;
    case "same-plan-capacity":
      return strings.forecastAssumeSamePlan;
    case "plan-multiple-capacity":
      return strings.forecastAssumePlanMultiple;
    case "manual-capacity":
      return strings.forecastAssumeManual;
    case "short-window-assumed":
      return strings.forecastAssumeWindowCost;
    case "thin-history":
      return strings.forecastAssumeThinHistory;
    case "no-history":
      return strings.forecastAssumeNoHistory;
    case "old-readings":
      return strings.forecastAssumeOldReadings;
  }
}

function exclusionText(reason: ForecastExclusion, strings: Strings): string {
  switch (reason) {
    case "no-meter":
      return strings.forecastOutNoMeter;
    case "no-reading":
      return strings.forecastOutNoReading;
    case "no-week":
      return strings.forecastOutNoWeek;
    case "no-reset":
      return strings.forecastOutNoReset;
    case "no-capacity":
      return strings.forecastOutNoCapacity;
  }
}

function levelText(level: Forecast["accuracy"]["level"], strings: Strings): string {
  return {
    high: strings.forecastLevelHigh,
    medium: strings.forecastLevelMedium,
    low: strings.forecastLevelLow,
    insufficient: strings.forecastLevelNone,
  }[level];
}

function hoursText(hours: number, strings: Strings): string {
  return hours < 1 ? strings.forecastHistoryUnderHour : formatWait(hours * 3_600_000, strings);
}

function historyText(accuracy: Forecast["accuracy"], strings: Strings): string {
  const { historyHoursMin: from, historyHoursMax: to } = accuracy;
  if (to <= 0) return strings.forecastHistoryNone;
  const low = hoursText(from, strings);
  const high = hoursText(to, strings);
  return low === high ? fill(strings.forecastHistory, { hours: high }) : fill(strings.forecastHistoryRange, { from: low, to: high });
}

function Tick({
  theme,
  label,
  ticked,
  disabled,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  ticked: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: ticked, disabled }}
      // React Native for web reads only the aria props for this.
      aria-checked={ticked}
      aria-disabled={disabled}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: disabled ? 0.5 : 1 }}
    >
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: ticked ? theme.colors.accent : theme.colors.border,
          backgroundColor: ticked ? theme.colors.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {ticked && <Icon name="Check" size={13} color={theme.colors.accentForeground} />}
      </View>
      <Text numberOfLines={1} style={{ ...typeScale.body, color: theme.colors.foreground, flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Stat({ theme, label, value }: { theme: PluginTheme; label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 96, gap: 2 }}>
      <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>{label}</Text>
      <Text style={{ color: theme.colors.foreground, fontSize: 20, fontWeight: "600" }}>{value}</Text>
    </View>
  );
}

function Swatch({ theme, colour, opacity = 1, height = 8, label }: { theme: PluginTheme; colour: string; opacity?: number; height?: number; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 12, height, borderRadius: 2, backgroundColor: colour, opacity }} />
      <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>{label}</Text>
    </View>
  );
}

/** Drawn with Views, since the host ships no SVG for plugins: one thin column per slice of time. */
function ReserveChart({ theme, strings, locale, data }: { theme: PluginTheme; strings: Strings; locale: string; data: Forecast }) {
  const [focus, setFocus] = useState<number | null>(null);
  const span = data.until - data.at;
  const left = (at: number): `${number}%` => `${bounded(((at - data.at) / span) * 100)}%`;
  const shown = focus === null ? null : data.columns[focus];
  const readout =
    shown === null || shown === undefined
      ? fill(strings.forecastReadoutNow, { reserve: percent(data.pool.reserve), usable: percent(data.pool.available) })
      : fill(strings.forecastReadoutAt, {
          at: dayTimeText(shown.at, locale),
          reserve: percent(shown.reserve),
          low: percent(shown.low),
          high: percent(shown.high),
          usable: percent(shown.available),
        });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => data.at + span * share);
  const weekResets = data.resets.filter((reset) => reset.kind === "week" && reset.at < data.until);

  return (
    <View style={{ gap: 6 }} accessibilityLabel={readout}>
      <Text style={{ ...typeScale.meta, color: theme.colors.foreground }}>{readout}</Text>
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: AXIS_WIDTH, height: PLOT_HEIGHT, justifyContent: "space-between" }}>
          {["100", "50", "0"].map((tick) => (
            <Text key={tick} style={{ ...typeScale.meta, fontSize: 10, color: theme.colors.foregroundMuted }}>
              {tick}
            </Text>
          ))}
        </View>
        <View style={{ flex: 1, height: PLOT_HEIGHT }}>
          {[0, 50, 100].map((line) => (
            <View key={line} style={{ position: "absolute", left: 0, right: 0, bottom: `${line}%`, height: 1, backgroundColor: theme.colors.border }} />
          ))}
          <View style={{ flexDirection: "row", height: PLOT_HEIGHT }}>
            {data.columns.map((column, index) => (
              <Pressable
                key={column.at}
                accessibilityLabel={dayTimeText(column.at, locale)}
                onHoverIn={() => setFocus(index)}
                onHoverOut={() => setFocus(null)}
                onPressIn={() => setFocus(index)}
                onPressOut={() => setFocus(null)}
                style={{ flex: 1, height: PLOT_HEIGHT }}
              >
                <View
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: `${bounded(column.low)}%`,
                    height: `${Math.max(0, bounded(column.high) - bounded(column.low))}%`,
                    backgroundColor: theme.colors.accent,
                    opacity: 0.16,
                  }}
                />
                <View
                  style={{
                    position: "absolute",
                    left: 1,
                    right: 1,
                    bottom: 0,
                    height: `${bounded(column.available)}%`,
                    backgroundColor: theme.colors.foregroundMuted,
                    opacity: USABLE_OPACITY,
                    borderTopLeftRadius: 2,
                    borderTopRightRadius: 2,
                  }}
                />
                <View style={{ position: "absolute", left: 0, right: 0, bottom: `${bounded(column.reserve)}%`, height: 2, backgroundColor: theme.colors.accent }} />
                {column.idle && <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, backgroundColor: theme.colors.statusDanger }} />}
                {focus === index && <View style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, backgroundColor: theme.colors.foreground }} />}
              </Pressable>
            ))}
          </View>
          {weekResets.map((reset) => (
            <View
              key={`${reset.key}-${reset.at}`}
              pointerEvents="none"
              style={{ position: "absolute", top: 0, bottom: 0, left: left(reset.at), width: 1, backgroundColor: theme.colors.foregroundMuted }}
            />
          ))}
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginLeft: AXIS_WIDTH }}>
        {ticks.map((at) => (
          <Text key={at} style={{ ...typeScale.meta, fontSize: 10, color: theme.colors.foregroundMuted }}>
            {dayTimeText(at, locale)}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginLeft: AXIS_WIDTH }}>
        <Swatch theme={theme} colour={theme.colors.accent} height={2} label={strings.forecastLegendReserve} />
        <Swatch theme={theme} colour={theme.colors.accent} opacity={0.16} label={strings.forecastLegendBand} />
        <Swatch theme={theme} colour={theme.colors.foregroundMuted} opacity={USABLE_OPACITY} label={strings.forecastLegendUsable} />
        <Swatch theme={theme} colour={theme.colors.statusDanger} height={4} label={strings.forecastLegendIdle} />
        <Swatch theme={theme} colour={theme.colors.foregroundMuted} height={8} label={strings.forecastLegendReset} />
      </View>
      {data.accounts.map((account) => (
        <AvailabilityStrip key={account.key} theme={theme} account={account} left={left} />
      ))}
    </View>
  );
}

/** One account's line under the chart: when it can take work, and where its week resets. */
function AvailabilityStrip({
  theme,
  account,
  left,
}: {
  theme: PluginTheme;
  account: AccountForecast;
  left: (at: number) => `${number}%`;
}) {
  return (
    <View style={{ marginLeft: AXIS_WIDTH, gap: 3 }}>
      <Text numberOfLines={1} style={{ ...typeScale.meta, fontSize: 11, color: theme.colors.foregroundMuted }}>
        {account.title}
      </Text>
      <View>
        <View style={{ flexDirection: "row", height: 6, gap: 1 }}>
          {account.up.map((up, index) => (
            <View key={index} style={{ flex: 1, height: 6, backgroundColor: up ? theme.colors.accent : theme.colors.surface2, opacity: up ? 0.75 : 1 }} />
          ))}
        </View>
        {account.week.resetsAt !== null && (
          <View style={{ position: "absolute", top: -2, left: left(account.week.resetsAt), width: 2, height: 10, backgroundColor: theme.colors.foreground }} />
        )}
        {account.five?.resetsAt != null && (
          <View style={{ position: "absolute", top: -1, left: left(account.five.resetsAt), width: 1, height: 8, backgroundColor: theme.colors.foregroundMuted }} />
        )}
      </View>
    </View>
  );
}

/** One headline at the top of the card: what to do, and the few figures it rests on. */
interface Headline {
  tone: "accent" | "warn" | "bad" | "muted";
  icon: string;
  title: string;
  lead: string;
  figures: { value: string; label: string }[];
  note: string;
}

/** Who to work on: the account at risk, or the one being worked on and then that one. */
function speedLead(hint: Extract<ForecastHint, { kind: "speed-up" }>, strings: Strings): string {
  if (hint.servedNow === null) return fill(strings.forecastHeroSpeedLead, { account: hint.title });
  const [now, next] = shortLogins(hint.servedNow, hint.title);
  return fill(strings.forecastHeroSpeedNext, { now, next });
}

function headlineOf(hint: ForecastHint, strings: Strings, locale: string): Headline {
  const at = (time: number) => dayTimeText(time, locale);
  if (hint.kind === "idle-now") {
    return {
      tone: "bad",
      icon: "CircleAlert",
      title: strings.forecastIdleNowTitle,
      lead: fill(strings.forecastIdleNowBody, { until: at(hint.until) }),
      figures: [],
      note: "",
    };
  }
  if (hint.kind === "slow-down") {
    const later =
      hint.laterStartAt === null || hint.laterCutPercent === null
        ? ""
        : ` ${fill(strings.forecastSlowLater, { at: at(hint.laterStartAt), cut: percent(hint.laterCutPercent) })}`;
    return {
      tone: "warn",
      icon: "TriangleAlert",
      title: strings.forecastSlowTitle,
      lead: fill(strings.forecastHeroSlowLead, { from: at(hint.idleFrom), to: at(hint.idleTo) }),
      figures: [
        { value: `−${percent(hint.cutPercent)}`, label: strings.forecastHeroCut },
        { value: fill(strings.forecastPaceValue, { pace: hint.targetPerHour.toFixed(2) }), label: strings.forecastHeroTarget },
        { value: formatWait(hint.idleTo - hint.idleFrom, strings), label: strings.forecastHeroIdle },
      ],
      note: `${fill(strings.forecastHeroSlowNote, { until: at(hint.untilAt) })}${later}`,
    };
  }
  return {
    tone: "accent",
    icon: "Zap",
    title: strings.forecastSpeedTitle,
    lead: speedLead(hint, strings),
    figures: [
      { value: percent(hint.lostPercent), label: strings.forecastHeroLost },
      { value: at(hint.untilAt), label: strings.forecastHeroReset },
      ...(hint.boostPercent === null ? [] : [{ value: `+${percent(hint.boostPercent)}`, label: strings.forecastHeroBoost }]),
    ],
    note: `${fill(strings.forecastHeroSpeedNote, { from: at(hint.startAt), extra: percent(hint.extraPercent), account: hint.title })}${hint.shortWindowLimited ? ` ${strings.forecastSpeedLimited}` : ""}`,
  };
}

/** What the card leads with: every hint, or that all is well, or at least where the reserve stands. */
function headlinesOf(data: Forecast, strings: Strings, locale: string): Headline[] {
  if (data.hints.length > 0) return data.hints.map((hint) => headlineOf(hint, strings, locale));
  if (onTrack(data) && data.accuracy.level !== "insufficient") {
    return [{ tone: "accent", icon: "Check", title: strings.forecastOnTrackTitle, lead: strings.forecastOnTrackBody, figures: [], note: "" }];
  }
  return [
    {
      tone: "muted",
      icon: "Gauge",
      title: strings.forecastTitle,
      lead: fill(strings.forecastReadoutNow, { reserve: percent(data.pool.reserve), usable: percent(data.pool.available) }),
      figures: [],
      note: data.accuracy.level === "insufficient" ? strings.forecastTooLittle : "",
    },
  ];
}

/** Two lines on a wide screen, three on a phone: what to do, then who and the figures. */
function HeadlineBlock({
  theme,
  headline,
  compact,
  trailing,
}: {
  theme: PluginTheme;
  headline: Headline;
  compact: boolean;
  trailing?: ReactNode;
}) {
  const colour = {
    accent: theme.colors.accent,
    warn: theme.colors.statusWarning,
    bad: theme.colors.statusDanger,
    muted: theme.colors.foregroundMuted,
  }[headline.tone];
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={headline.icon} size={13} color={colour} />
        <Text numberOfLines={1} style={{ ...typeScale.label, color: colour, flexShrink: 1 }}>
          {headline.title}
        </Text>
        <View style={{ flex: 1 }} />
        {trailing}
      </View>
      <View style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "baseline", justifyContent: "space-between", columnGap: 16, rowGap: 3 }}>
        <Text numberOfLines={compact ? 2 : 1} style={{ ...typeScale.body, fontWeight: "600", color: theme.colors.foreground, flexShrink: 1 }}>
          {headline.lead}
        </Text>
        {headline.figures.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 12, flexShrink: 0 }}>
            {headline.figures.map((figure, index) => (
              <Text key={figure.label} numberOfLines={1}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: index === 0 ? colour : theme.colors.foreground }}>{figure.value}</Text>
                <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>{` ${figure.label}`}</Text>
              </Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

/** Slides its content in and out. Mounted only while it can be seen, so a closed spoiler neither
 *  draws the chart nor leaves its controls reachable by keyboard. */
function Spoiler({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [height, setHeight] = useState(0);
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(progress, { toValue: open ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
  }, [open, progress]);
  if (!mounted) return null;
  return (
    <Animated.View style={{ overflow: "hidden", height: progress.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) }}>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0 }} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
        {children}
      </View>
    </Animated.View>
  );
}

function AccountRow({ theme, strings, locale, account }: { theme: PluginTheme; strings: Strings; locale: string; account: AccountForecast }) {
  const at = (time: number) => dayTimeText(time, locale);
  const line = (text: string, colour = theme.colors.foregroundMuted) => (
    <Text style={{ ...typeScale.meta, color: colour }}>{text}</Text>
  );
  const fiveText =
    account.five === null
      ? strings.forecastNoFive
      : account.five.resetsAt === null
        ? strings.forecastFiveIdle
        : fill(strings.forecastFiveReset, { at: at(account.five.resetsAt) });
  const source = {
    history: strings.forecastSourceHistory,
    blend: strings.forecastSourceBlend,
    "window-average": strings.forecastSourceAverage,
    none: strings.forecastSourceNone,
  }[account.paceSource];
  const capacity = {
    "same-plan": strings.forecastCapacitySame,
    plan: fill(strings.forecastCapacityPlan, { n: String(account.capacity) }),
    manual: fill(strings.forecastCapacityManual, { n: String(account.capacity) }),
  }[account.capacitySource];
  const cost =
    account.fiveHourCost === null
      ? ""
      : ` · ${fill(account.fiveHourCostMeasured ? strings.forecastCostMeasured : strings.forecastCostAssumed, { pct: percent(account.fiveHourCost) })}`;
  return (
    <View style={{ gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
      <Text numberOfLines={1} style={{ ...typeScale.body, fontWeight: "600", color: theme.colors.foreground }}>
        {account.title}
      </Text>
      {line(
        `${account.week.resetsAt === null ? strings.forecastWeekIdle : fill(strings.forecastWeekReset, { at: at(account.week.resetsAt) })} · ${fiveText}`,
        theme.colors.foreground,
      )}
      {account.weekEmptyAt !== null
        ? line(fill(strings.forecastEmptyAt, { at: at(account.weekEmptyAt) }), theme.colors.statusWarning)
        : line(fill(strings.forecastLeftAtReset, { pct: percent(account.leftAtReset) }))}
      {line(
        fill(account.shortWindowLimits ? strings.forecastSpendableShort : strings.forecastSpendable, {
          pct: percent(account.spendableBeforeReset),
        }),
      )}
      {line(`${fill(strings.forecastBasisLine, { pace: account.pacePerHour.toFixed(2), source })}${cost} · ${capacity}`)}
    </View>
  );
}

/**
 * The forecast over the accounts ticked here. It leads with what to do; the chart, the ticks and
 * the same figures per account in words wait behind a spoiler, closed by default. Ticks and
 * capacities are saved with the plugin's preferences.
 */
export function ForecastCard({
  theme,
  layout,
  strings,
  locale,
  rows,
}: {
  theme: PluginTheme;
  layout: Layout;
  strings: Strings;
  locale: string;
  rows: readonly AccountView[];
}) {
  const state = useSettings(preferences);
  const values = state.status === "ready" ? state.values : defaultPreferences;
  const ask = useRpc(forecastRpc);
  const queries = useQueryClient();
  const [settingCapacity, setSettingCapacity] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const input = {
    unchecked: values.forecastUnchecked,
    capacity: values.forecastCapacity,
    columns: layout.compact ? COLUMNS_COMPACT : COLUMNS_WIDE,
  };
  const { data: answer, isError, error, refetch, isPlaceholderData } = useQuery({
    queryKey: ["accounts", "forecast", input],
    queryFn: () => ask(input),
    // Settings that cannot be read fall back to the defaults, and the chart still draws.
    enabled: state.status !== "loading",
    // A tick or a new reading keeps the old chart on screen until the new one is ready.
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  // The forecast starts from the readings the screen shows, so it follows them.
  const readings = rows.map((row) => `${row.key}:${row.usageAt}`).join();
  useEffect(() => {
    void queries.invalidateQueries({ queryKey: ["accounts", "forecast"] });
  }, [readings, queries]);

  const busy = state.status !== "ready" || state.saving;
  const save = (patch: Partial<typeof values>) => {
    if (state.status === "ready") void state.save({ ...state.values, ...patch }, state.revision);
  };
  const toggle = (key: string) =>
    save({
      forecastUnchecked: values.forecastUnchecked.includes(key)
        ? values.forecastUnchecked.filter((item) => item !== key)
        : [...values.forecastUnchecked, key],
    });
  const setCapacity = (key: string, capacity: number | null) => {
    const { [key]: _, ...others } = values.forecastCapacity;
    save({ forecastCapacity: capacity === null ? others : { ...others, [key]: capacity } });
  };

  const ticked = rows.filter((row) => !values.forecastUnchecked.includes(row.key));
  const title = (row: AccountView) => loginName(row, strings.personalAccount, row.name);
  // Named here, as the rows above are: the daemon's names are addresses, which two accounts can share.
  const data = answer === undefined ? undefined : retitle(answer, (key) => {
    const row = rows.find((candidate) => candidate.key === key);
    return row === undefined ? undefined : title(row);
  });
  const excluded = (data?.excluded ?? []).filter((item) => item.reason !== "no-meter");
  const needsCapacity = excluded.some((item) => item.reason === "no-capacity");

  const failure = (
    <Banner
      theme={theme}
      tone="bad"
      text={`${strings.forecastLoadFailed} ${error instanceof Error ? error.message : String(error)}`}
      action={{ label: strings.retry, onPress: () => void refetch() }}
    />
  );

  const quiet = (lead: string): Headline => ({ tone: "muted", icon: "Gauge", title: strings.forecastTitle, lead, figures: [], note: "" });
  const headlines =
    ticked.length === 0
      ? [quiet(strings.forecastNothingTicked)]
      : data === undefined
        ? []
        : data.accounts.length === 0
          ? [quiet(excluded.length === 0 ? strings.forecastNoReadings : strings.forecastHeroOpenDetails)]
          : headlinesOf(data, strings, locale);
  const trailing = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {data !== undefined && data.accounts.length > 0 && (
        <Text numberOfLines={1} style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>
          {fill(strings.forecastAccuracy, { level: levelText(data.accuracy.level, strings) })}
        </Text>
      )}
      <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={15} color={theme.colors.foregroundMuted} />
    </View>
  );

  return (
    <Card theme={theme} style={{ padding: layout.compact ? 10 : 12, gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? strings.forecastLess : strings.forecastMore}
        aria-expanded={expanded}
        onPress={() => setExpanded(!expanded)}
        style={{ gap: 8, opacity: isPlaceholderData ? 0.6 : 1 }}
      >
        {headlines.length === 0 ? (
          isError ? (
            <HeadlineBlock theme={theme} compact={layout.compact} headline={quiet(strings.forecastLoadFailed)} trailing={trailing} />
          ) : (
            <Skeleton theme={theme} height={40} />
          )
        ) : (
          headlines.map((headline, index) => (
            <HeadlineBlock key={headline.title} theme={theme} compact={layout.compact} headline={headline} trailing={index === 0 ? trailing : undefined} />
          ))
        )}
      </Pressable>
      {isError && failure}

      <Spoiler open={expanded}>
        <View style={{ gap: 10, paddingTop: 2 }}>
          {headlines
            .filter((headline) => headline.note !== "")
            .map((headline) => (
              <Text key={headline.title} style={{ ...typeScale.body, color: theme.colors.foreground }}>
                {headline.note}
              </Text>
            ))}
          <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>{strings.forecastHint}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {rows.map((row) => (
              <View key={row.key} style={{ width: layout.compact ? "100%" : "48%" }}>
                <Tick
                  theme={theme}
                  label={title(row)}
                  ticked={!values.forecastUnchecked.includes(row.key)}
                  disabled={busy}
                  onPress={() => toggle(row.key)}
                />
              </View>
            ))}
          </View>

          {(settingCapacity || needsCapacity) && (
            <View style={{ gap: 8 }}>
              <SectionLabel theme={theme}>{strings.forecastCapacityHeading}</SectionLabel>
              <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>{strings.forecastCapacityHint}</Text>
              {ticked.map((row) => {
                const set = values.forecastCapacity[row.key];
                return (
                  <View key={row.key} style={{ gap: 6 }}>
                    <Text numberOfLines={1} style={{ ...typeScale.meta, color: theme.colors.foreground }}>
                      {title(row)}
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      <Chip theme={theme} label={strings.forecastCapacityAuto} selected={set === undefined} disabled={busy} onPress={() => setCapacity(row.key, null)} />
                      {CAPACITY_CHOICES.map((choice) => (
                        <Chip key={choice} theme={theme} label={`×${choice}`} selected={set === choice} disabled={busy} onPress={() => setCapacity(row.key, choice)} />
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
          {!needsCapacity && ticked.length > 0 && (
            <View style={{ flexDirection: "row" }}>
              <Button
                theme={theme}
                label={settingCapacity ? strings.forecastCapacityHide : strings.forecastCapacityShow}
                variant="ghost"
                onPress={() => setSettingCapacity(!settingCapacity)}
              />
            </View>
          )}

          {excluded.map((item) => (
            <Banner key={item.key} theme={theme} tone="warn" text={fill(strings.forecastOutLine, { account: item.title, reason: exclusionText(item.reason, strings) })} />
          ))}

          {data !== undefined && data.accounts.length > 0 && (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <Stat theme={theme} label={strings.forecastReserveNow} value={percent(data.pool.reserve)} />
                <Stat theme={theme} label={strings.forecastUsableNow} value={percent(data.pool.available)} />
                <Stat theme={theme} label={strings.forecastPace} value={fill(strings.forecastPaceValue, { pace: data.pool.pacePerHour.toFixed(2) })} />
              </View>
              <Text style={{ ...typeScale.meta, color: theme.colors.foreground }}>
                {`${fill(strings.forecastAccuracy, { level: levelText(data.accuracy.level, strings) })} · ${fill(strings.forecastBand, {
                  pct: String(Math.round(data.accuracy.errorPercent)),
                  basis: data.accuracy.basis === "backtest" ? strings.forecastBasisBacktest : strings.forecastBasisRule,
                })} · ${historyText(data.accuracy, strings)}`}
              </Text>
              <ReserveChart theme={theme} strings={strings} locale={locale} data={data} />
              <View style={{ gap: 2 }}>
                <SectionLabel theme={theme}>{strings.forecastIdleHeading}</SectionLabel>
                {data.idle.length === 0 ? (
                  <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>{strings.forecastNoIdle}</Text>
                ) : (
                  data.idle.map((spell) => (
                    <Text key={spell.from} style={{ ...typeScale.meta, color: theme.colors.foreground }}>
                      {fill(strings.forecastIdleSpell, {
                        from: dayTimeText(spell.from, locale),
                        to: dayTimeText(spell.to, locale),
                        length: formatWait(spell.to - spell.from, strings),
                        cause: spell.cause === "weekly" ? strings.forecastIdleWeekly : strings.forecastIdleShort,
                      })}
                    </Text>
                  ))
                )}
              </View>
              <View style={{ gap: 8 }}>
                {data.accounts.map((account) => (
                  <AccountRow key={account.key} theme={theme} strings={strings} locale={locale} account={account} />
                ))}
              </View>
              <View style={{ gap: 2 }}>
                <SectionLabel theme={theme}>{strings.forecastAssumptionsHeading}</SectionLabel>
                {data.assumptions.map((code) => (
                  <Text key={code} style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>
                    {`· ${assumptionText(code, strings)}`}
                  </Text>
                ))}
              </View>
            </>
          )}
        </View>
      </Spoiler>
    </Card>
  );
}
