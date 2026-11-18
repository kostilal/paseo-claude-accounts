import { type Forecast, onTrack } from "../shared/forecast.ts";
import type { Strings } from "../shared/i18n.ts";
import { shortWait } from "./format.ts";

/** What the sidebar row says about the forecast: one word, a figure, and a sentence for a
 *  screen reader. */
export interface Signal {
  kind: "push" | "ease-off" | "empty" | "on-pace";
  word: string;
  /** "23%", "−15%", "2ч"; empty when the word says it all. */
  figure: string;
  label: string;
}

const percent = (value: number) => `${Math.round(value)}%`;

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, () => value), template);
}

/**
 * The forecast as the sidebar shows it: the first hint, since the forecast puts the urgent one
 * first, or that all is well. Null when there is nothing to say yet: no forecast, or too little
 * history to call the pace even, which the screen does not call on track either.
 */
export function sidebarSignal(data: Forecast | undefined, now: number, strings: Strings): Signal | null {
  if (data === undefined) return null;
  const hint = data.hints[0];
  if (hint === undefined) {
    if (!onTrack(data) || data.accuracy.level === "insufficient") return null;
    return { kind: "on-pace", word: strings.sidebarOnPace, figure: "", label: strings.forecastOnTrackTitle };
  }
  if (hint.kind === "idle-now") {
    const wait = shortWait(Math.max(0, hint.until - now), strings);
    return { kind: "empty", word: strings.sidebarEmpty, figure: wait, label: fill(strings.sidebarEmptyLabel, { wait }) };
  }
  if (hint.kind === "slow-down") {
    const cut = percent(hint.cutPercent);
    const idle = shortWait(hint.idleTo - hint.idleFrom, strings);
    return { kind: "ease-off", word: strings.sidebarEaseOff, figure: `−${cut}`, label: fill(strings.sidebarEaseOffLabel, { cut, idle }) };
  }
  const lost = percent(hint.lostPercent);
  return { kind: "push", word: strings.sidebarPush, figure: lost, label: fill(strings.sidebarPushLabel, { lost, account: hint.title }) };
}
