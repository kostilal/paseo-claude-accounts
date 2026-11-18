import { test } from "node:test";
import assert from "node:assert/strict";
import type { Forecast, ForecastHint } from "../shared/forecast.ts";
import { t } from "../shared/i18n.ts";
import { sidebarSignal } from "./signal.ts";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 18, 12);
const ru = t("ru");

function forecastWith(hints: ForecastHint[], overrides: Partial<Forecast> = {}): Forecast {
  return {
    at: NOW,
    until: NOW + 72 * HOUR,
    accounts: [],
    excluded: [],
    columns: [],
    resets: [],
    idle: [],
    pool: { reserve: 60, available: 40, pacePerHour: 1, reserveAtEnd: 10 },
    hints,
    accuracy: { level: "high", errorPercent: 5, basis: "backtest", historyHoursMin: 48, historyHoursMax: 96, samples: 300, oldestReadingMs: null },
    assumptions: [],
    ...overrides,
  };
}

const speedUp: ForecastHint = {
  kind: "speed-up",
  key: "a",
  title: "devxypro",
  servedNow: null,
  servedNowKey: null,
  startAt: NOW,
  untilAt: NOW + 30 * HOUR,
  lostPercent: 22.6,
  extraPercent: 20,
  boostPercent: 40,
  shortWindowLimited: false,
};

const slowDown: ForecastHint = {
  kind: "slow-down",
  idleFrom: NOW + 20 * HOUR,
  idleTo: NOW + 26 * HOUR,
  startAt: NOW,
  untilAt: NOW + 26 * HOUR,
  cutPercent: 14.7,
  pacePerHour: 2,
  targetPerHour: 1.7,
  laterStartAt: null,
  laterCutPercent: null,
};

test("nothing is shown before the forecast arrives", () => {
  assert.equal(sidebarSignal(undefined, NOW, ru), null);
});

test("a hint to speed up shows what would be lost at the reset", () => {
  const signal = sidebarSignal(forecastWith([speedUp]), NOW, ru);
  assert.deepEqual(signal && { kind: signal.kind, word: signal.word, figure: signal.figure }, { kind: "push", word: "Жми", figure: "23%" });
  assert.match(signal!.label, /devxypro/);
});

test("a hint to slow down shows the cut, and wins over a later hint", () => {
  const signal = sidebarSignal(forecastWith([slowDown, speedUp]), NOW, ru);
  assert.deepEqual(signal && { kind: signal.kind, figure: signal.figure }, { kind: "ease-off", figure: "−15%" });
  assert.match(signal!.label, /6ч/);
});

test("no room now shows the wait until there is", () => {
  const signal = sidebarSignal(forecastWith([{ kind: "idle-now", until: NOW + 2 * HOUR }]), NOW, ru);
  assert.deepEqual(signal && { kind: signal.kind, word: signal.word, figure: signal.figure }, { kind: "empty", word: "Пусто", figure: "2ч" });
});

test("no hint and nothing lost reads as on pace", () => {
  const signal = sidebarSignal(forecastWith([]), NOW, ru);
  assert.deepEqual(signal && { kind: signal.kind, figure: signal.figure }, { kind: "on-pace", figure: "" });
});

test("too little history is not called on pace", () => {
  const thin = forecastWith([], { accuracy: { ...forecastWith([]).accuracy, level: "insufficient" } });
  assert.equal(sidebarSignal(thin, NOW, ru), null);
});

test("an idle spell with no hint is not called on pace", () => {
  const idle = forecastWith([], { idle: [{ from: NOW + HOUR, to: NOW + 2 * HOUR, cause: "short" }] });
  assert.equal(sidebarSignal(idle, NOW, ru), null);
});
