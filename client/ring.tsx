import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { meterTone } from "./ui.tsx";

/**
 * A circular meter drawn with Views only, since the host ships no SVG for plugins.
 *
 * A circle with only its top and right borders coloured shows a 180° arc; rotated 45° it
 * runs from twelve to six o'clock. Two half-width clipping boxes each show up to 180° of
 * the sweep (right half first, then left), with the arc rotated to expose the wanted span.
 */
export function Ring({
  size,
  thickness,
  percent,
  color,
  track,
  children,
}: {
  size: number;
  thickness: number;
  /** 0–100, or null when unknown, which draws only the track. */
  percent: number | null;
  color: string;
  track: string;
  children?: ReactNode;
}) {
  const sweep = percent === null ? 0 : (Math.max(0, Math.min(100, percent)) / 100) * 360;
  const right = Math.min(sweep, 180);
  const left = Math.max(sweep - 180, 0);
  const arc = (rotation: number) => (
    <View
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: thickness,
        borderTopColor: color,
        borderRightColor: color,
        borderBottomColor: "transparent",
        borderLeftColor: "transparent",
        transform: [{ rotate: `${rotation}deg` }],
      }}
    />
  );
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: thickness,
          borderColor: track,
        }}
      />
      {right > 0 && (
        <View style={{ position: "absolute", left: size / 2, top: 0, width: size / 2, height: size, overflow: "hidden" }}>
          <View style={{ position: "absolute", left: -size / 2, top: 0, width: size, height: size }}>
            {arc(45 + right - 180)}
          </View>
        </View>
      )}
      {left > 0 && (
        <View style={{ position: "absolute", left: 0, top: 0, width: size / 2, height: size, overflow: "hidden" }}>
          <View style={{ position: "absolute", left: 0, top: 0, width: size, height: size }}>{arc(45 + left)}</View>
        </View>
      )}
      <View style={{ position: "absolute", left: 0, top: 0, width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        {children}
      </View>
    </View>
  );
}

/** Lucide has no vendor marks, so Claude is an asterisk and Codex a diamond. */
export function ProviderGlyph({ provider, size, color }: { provider: string; size: number; color: string }) {
  return <Icon name={provider === "codex" ? "Diamond" : "Asterisk"} size={size} color={color} />;
}

/**
 * One account's ring: the provider glyph inside a meter of its tightest window, tinted with
 * the bar thresholds. Muted when usage is unknown, so it never reads as "plenty left".
 */
export function AccountRing({
  theme,
  size,
  provider,
  tightest,
  dim = false,
}: {
  theme: PluginTheme;
  size: number;
  provider: string;
  tightest: number | null;
  /** A row that cannot be pressed: not logged in, or no token. */
  dim?: boolean;
}) {
  const tone = tightest === null ? theme.colors.foregroundMuted : theme.colors[meterTone(tightest)];
  const thickness = size >= 30 ? 3 : size >= 20 ? 2 : 1.5;
  return (
    <View style={{ opacity: dim ? 0.45 : 1 }}>
      <Ring size={size} thickness={thickness} percent={tightest} color={tone} track={theme.colors.border}>
        <ProviderGlyph provider={provider} size={Math.round(size * 0.5)} color={theme.colors.foreground} />
      </Ring>
    </View>
  );
}
