import type { TextStyle } from "react-native";

/**
 * One type scale for the whole plugin. No `fontFamily` anywhere: Paseo sets its own, and a
 * plugin that names one stops looking like part of the app.
 */
export const typeScale = {
  heading: { fontSize: 22, fontWeight: "700", lineHeight: 28, letterSpacing: -0.4 },
  lane: { fontSize: 15, fontWeight: "700", lineHeight: 20, letterSpacing: -0.1 },
  title: { fontSize: 15, fontWeight: "600", lineHeight: 20, letterSpacing: -0.1 },
  detailTitle: { fontSize: 18, fontWeight: "700", lineHeight: 24, letterSpacing: -0.2 },
  body: { fontSize: 13, lineHeight: 18 },
  quote: { fontSize: 12, lineHeight: 17, fontStyle: "italic" },
  label: { fontSize: 12, fontWeight: "600", letterSpacing: 0.2 },
  meta: { fontSize: 11, lineHeight: 15, letterSpacing: 0.3 },
  /** Tabular digits so a ticking value does not shuffle. */
  timer: { fontSize: 13, fontWeight: "500", fontVariant: ["tabular-nums"] },
  chip: { fontSize: 11, fontWeight: "700", letterSpacing: 0.2 },
  button: { fontSize: 13, fontWeight: "600", letterSpacing: 0.1 },
} satisfies Record<string, TextStyle>;
