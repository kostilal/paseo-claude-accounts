import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useEffect, useRef } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { typeScale } from "./typography.ts";

/** Shared UI primitives for every surface in this plugin. */

/** `PluginLayout` is not exported by the SDK, so derive it from the surface props. */
type Layout = PluginSurfaceProps["layout"];

/** Content width cap, centred beyond it, so lines stay readable on wide windows. */
export const MAX_WIDTH = 760;

export const RADIUS = { card: 16, control: 10, pill: 999 } as const;

/** Compact is the phone layout, where a 24px gutter is too wide. */
export function gutterFor(layout: Layout): number {
  return layout.compact ? 16 : 24;
}

export function Screen({
  theme,
  layout,
  children,
}: {
  theme: PluginTheme;
  layout: Layout;
  children: ReactNode;
}) {
  const gutter = gutterFor(layout);
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{
        padding: gutter,
        gap: layout.compact ? 12 : 16,
        maxWidth: MAX_WIDTH,
        width: "100%",
        alignSelf: "center",
      }}
    >
      {children}
    </ScrollView>
  );
}

/** A screen's header: icon tile, title, optional subtitle and trailing control. */
export function ScreenHeader({
  theme,
  layout,
  icon,
  title,
  subtitle,
  trailing,
}: {
  theme: PluginTheme;
  layout: Layout;
  icon: string;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.surface2,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <Icon name={icon} size={22} color={theme.colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: layout.compact ? 20 : 24, fontWeight: "700" }}>
          {title}
        </Text>
        {subtitle ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{subtitle}</Text> : null}
      </View>
      {trailing}
    </View>
  );
}

export function Card({
  theme,
  children,
  selected = false,
  style,
}: {
  theme: PluginTheme;
  children: ReactNode;
  /** Draws an accent border. */
  selected?: boolean;
  style?: object;
}) {
  return (
    <View
      style={{
        backgroundColor: selected ? theme.colors.surface2 : theme.colors.surface1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        borderWidth: selected ? 2 : 1,
        borderRadius: RADIUS.card,
        padding: 16,
        gap: 10,
        ...style,
      }}
    >
      {children}
    </View>
  );
}

export function SectionLabel({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  return (
    <Text
      style={{
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 1,
        textTransform: "uppercase",
      }}
    >
      {children}
    </Text>
  );
}

export function StatusDot({ theme, tone }: { theme: PluginTheme; tone: "ok" | "idle" | "warn" | "bad" }) {
  const colour = {
    ok: theme.colors.statusSuccess,
    idle: theme.colors.foregroundMuted,
    warn: theme.colors.statusWarning,
    bad: theme.colors.statusDanger,
  }[tone];
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colour }} />;
}

export function Chip({
  theme,
  label,
  selected = false,
  disabled = false,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <View
      style={{
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: RADIUS.pill,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.accent : "transparent",
        // Disabled only lowers opacity, so it never reads as a different colour scheme.
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: selected ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 13 }}>
        {label}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}>
      {body}
    </Pressable>
  );
}

export function Button({
  theme,
  label,
  onPress,
  variant = "primary",
  disabled = false,
  icon,
  fill = false,
}: {
  theme: PluginTheme;
  label: string;
  onPress: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  icon?: string;
  /** Stretch to the row's width. */
  fill?: boolean;
}) {
  const surface = {
    primary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    ghost: { backgroundColor: "transparent", borderColor: theme.colors.border },
    danger: { backgroundColor: "transparent", borderColor: theme.colors.statusDanger },
  }[variant];
  const tint = {
    primary: theme.colors.accentForeground,
    ghost: theme.colors.foreground,
    danger: theme.colors.statusDanger,
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        ...surface,
        borderWidth: 1,
        borderRadius: RADIUS.control,
        paddingVertical: 10,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        alignSelf: fill ? "stretch" : "flex-start",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon ? <Icon name={icon} size={15} color={tint} /> : null}
      <Text style={{ color: tint, fontWeight: "600", fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

/** An info, warning or error message with an optional action, so a failure can say what to do next. */
export function Banner({
  theme,
  tone,
  text,
  action,
}: {
  theme: PluginTheme;
  tone: "info" | "warn" | "bad";
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  const { colour, icon } = {
    info: { colour: theme.colors.foregroundMuted, icon: "Info" },
    warn: { colour: theme.colors.statusWarning, icon: "TriangleAlert" },
    bad: { colour: theme.colors.statusDanger, icon: "CircleAlert" },
  }[tone];
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        padding: 12,
        borderRadius: RADIUS.control,
        borderWidth: 1,
        borderColor: colour,
        // The theme exposes no alpha for a tinted fill, so the border and icon carry the tone.
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View style={{ paddingTop: 1 }}>
        <Icon name={icon} size={15} color={colour} />
      </View>
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={{ color: tone === "info" ? theme.colors.foreground : colour, fontSize: 13, lineHeight: 18 }}>
          {text}
        </Text>
        {action ? (
          <Button theme={theme} label={action.label} onPress={action.onPress} variant="ghost" />
        ) : null}
      </View>
    </View>
  );
}

export type MeterTone = "statusSuccess" | "statusWarning" | "statusDanger";

/** Utilization thresholds (0–100) for the warning and danger colours, shared by bars and rings. */
export const METER_WARNING_AT = 70;
export const METER_DANGER_AT = 90;

export function meterTone(utilization: number): MeterTone {
  if (utilization >= METER_DANGER_AT) return "statusDanger";
  if (utilization >= METER_WARNING_AT) return "statusWarning";
  return "statusSuccess";
}

/**
 * A labelled allowance bar. `utilization` is 0–100 as the usage endpoint reports it, not 0–1.
 * A null bar (usage unknown) renders nothing rather than an empty track, which would read
 * as "plenty left".
 */
export function Meter({
  theme,
  label,
  bar,
}: {
  theme: PluginTheme;
  label: string;
  bar: { utilization: number; resetsAt: string } | null;
}) {
  if (bar === null) return null;
  const percent = Math.max(0, Math.min(100, bar.utilization));
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ ...typeScale.label, color: theme.colors.foregroundMuted }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={{
            flex: 1,
            height: 6,
            borderRadius: RADIUS.pill,
            backgroundColor: theme.colors.surface2,
          }}
        >
          <View
            style={{
              width: `${percent}%`,
              height: 6,
              borderRadius: RADIUS.pill,
              backgroundColor: theme.colors[meterTone(percent)],
            }}
          />
        </View>
        <Text style={{ ...typeScale.meta, color: theme.colors.foregroundMuted }}>
          {`${Math.round(percent)}%`}
        </Text>
      </View>
    </View>
  );
}

/**
 * A pulsing placeholder that holds the layout while content loads. Animates opacity only,
 * which the native driver supports on every platform, keeping it off the JS thread.
 */
export function Skeleton({
  theme,
  height = 14,
  width = "100%",
  radius = 6,
}: {
  theme: PluginTheme;
  height?: number;
  width?: number | `${number}%`;
  radius?: number;
}) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    animation.start();
    // A loop left running keeps its frame callback alive after unmount.
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityRole="progressbar"
      style={{ height, width, borderRadius: radius, backgroundColor: theme.colors.surface2, opacity: pulse }}
    />
  );
}

/** Shown when a fetch succeeded but returned nothing, distinct from loading and failure. */
export function EmptyState({
  theme,
  icon,
  title,
  detail,
}: {
  theme: PluginTheme;
  icon: string;
  title: string;
  detail?: string;
}) {
  return (
    <View style={{ alignItems: "center", gap: 8, paddingVertical: 32 }}>
      <Icon name={icon} size={28} color={theme.colors.foregroundMuted} />
      <Text style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "600" }}>{title}</Text>
      {detail ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, textAlign: "center" }}>{detail}</Text>
      ) : null}
    </View>
  );
}
