import { describe, expect, it } from "vitest";
import {
  HORIZON_MS, HOUR_MS, clampTime, fallbackFrames, framePair, loadOrder, nearestFrame, resolvePair, snapToHour, timelineRange,
} from "../src/time/timeline";
import { sliderValue } from "../src/ui/timeline";

const T0 = Date.parse("2026-09-12T09:00:00Z");
/** 20 échéances au pas de 3 h, comme la frise publiée. */
const FRAMES = Array.from({ length: 20 }, (_, i) => ({ valid_ms: T0 + i * 3 * HOUR_MS }));

describe("framePair — spec lot E §5.1", () => {
  it("entre deux échéances : a, b et f", () => {
    expect(framePair(FRAMES, T0 + 4 * HOUR_MS)).toEqual({ a: 1, b: 2, f: 1 / 3, clamped: false });
  });
  it("sur une échéance exacte : a = b, f = 0", () => {
    expect(framePair(FRAMES, T0 + 6 * HOUR_MS)).toEqual({ a: 2, b: 2, f: 0, clamped: false });
    expect(framePair(FRAMES, T0)).toEqual({ a: 0, b: 0, f: 0, clamped: false });
    expect(framePair(FRAMES, FRAMES[19]!.valid_ms)).toEqual({ a: 19, b: 19, f: 0, clamped: false });
  });
  it("hors de la frise : première ou dernière échéance, clamped", () => {
    expect(framePair(FRAMES, T0 - 1)).toEqual({ a: 0, b: 0, f: 0, clamped: true });
    expect(framePair(FRAMES, FRAMES[19]!.valid_ms + 1)).toEqual({ a: 19, b: 19, f: 0, clamped: true });
  });
  it("une seule échéance", () => {
    expect(framePair([{ valid_ms: T0 }], T0 + HOUR_MS)).toEqual({ a: 0, b: 0, f: 0, clamped: true });
  });
  it("frise vide : erreur", () => {
    expect(() => framePair([], T0)).toThrowError(/frame/);
  });
});

describe("timelineRange", () => {
  const now = Date.parse("2026-09-12T10:40:00Z");
  it("de l'heure courante arrondie à l'heure inférieure à la dernière échéance, bornée à +48 h", () => {
    const r = timelineRange([Date.parse("2026-09-14T18:00:00Z"), Date.parse("2026-09-14T12:00:00Z")], now);
    expect(r.start).toBe(Date.parse("2026-09-12T10:00:00Z"));
    expect(r.end).toBe(r.start + HORIZON_MS);
  });
  it("dernière échéance avant +48 h : fin sur l'heure de cette échéance", () => {
    expect(timelineRange([Date.parse("2026-09-13T21:30:00Z")], now).end).toBe(Date.parse("2026-09-13T21:00:00Z"));
  });
  it("aucune échéance, ou toutes passées : plage vide", () => {
    expect(timelineRange([], now)).toEqual({ start: Date.parse("2026-09-12T10:00:00Z"), end: Date.parse("2026-09-12T10:00:00Z") });
    expect(timelineRange([Date.parse("2026-09-12T06:00:00Z")], now).end).toBe(Date.parse("2026-09-12T10:00:00Z"));
  });
});

describe("clampTime / snapToHour", () => {
  it("borne et arrondit", () => {
    expect(clampTime(5, { start: 10, end: 20 })).toBe(10);
    expect(clampTime(25, { start: 10, end: 20 })).toBe(20);
    expect(clampTime(15, { start: 10, end: 20 })).toBe(15);
    expect(snapToHour(T0 + 29 * 60_000)).toBe(T0);
    expect(snapToHour(T0 + 31 * 60_000)).toBe(T0 + HOUR_MS);
  });
});

describe("loadOrder — spec lot E §5.4", () => {
  it("de t vers l'avant, puis vers l'arrière jusqu'au début de la plage", () => {
    // fin de plage au-delà de la dernière échéance : toute la suite est chargée
    const order = loadOrder(FRAMES, T0 + 10 * HOUR_MS, T0 + 4 * HOUR_MS, T0 + 100 * HOUR_MS); // a = 3, début de plage dans [1, 2]
    expect(order.slice(0, 3)).toEqual([3, 4, 5]);
    expect(order.at(-1)).toBe(1);
    expect(order).toHaveLength(17 + 2);
    expect(new Set(order).size).toBe(order.length);
  });
  it("vers l'avant, s'arrête à l'échéance qui encadre la fin de plage (revue finale F5)", () => {
    // fin de plage entre les échéances 6 (T0+18 h) et 7 (T0+21 h) : la 7 sert encore au mélange, pas la 8
    const order = loadOrder(FRAMES, T0 + 10 * HOUR_MS, T0 + 4 * HOUR_MS, T0 + 20 * HOUR_MS);
    expect(order).toEqual([3, 4, 5, 6, 7, 2, 1]);
    // fin de plage sur une échéance exacte : rien après elle
    expect(loadOrder(FRAMES, T0 + 10 * HOUR_MS, T0 + 4 * HOUR_MS, T0 + 18 * HOUR_MS)).toEqual([3, 4, 5, 6, 2, 1]);
  });
  it("frise vide : rien", () => {
    expect(loadOrder([], T0, T0, T0)).toEqual([]);
  });
});

describe("resolvePair — repli spec lot E §5.4", () => {
  const want = { a: 4, b: 5, f: 0.25, clamped: false };
  it("paire prête : inchangée", () => {
    expect(resolvePair(want, () => true, 20)).toBe(want);
  });
  it("b manquante : a seule, sans mélange", () => {
    expect(resolvePair(want, (i) => i === 4, 20)).toEqual({ a: 4, b: 4, f: 0, clamped: false });
  });
  it("a manquante : l'échéance prête la plus proche de la cible", () => {
    expect(resolvePair({ a: 4, b: 5, f: 0.75, clamped: false }, (i) => i === 5, 20)).toEqual({ a: 5, b: 5, f: 0, clamped: false });
    expect(resolvePair(want, (i) => i === 7 || i === 2, 20)).toEqual({ a: 2, b: 2, f: 0, clamped: false });
  });
  it("rien de prêt : null", () => {
    expect(resolvePair(want, () => false, 20)).toBeNull();
  });
});

describe("nearestFrame", () => {
  it("a sous 0,5, b au-delà", () => {
    expect(nearestFrame({ a: 3, b: 4, f: 0.4, clamped: false })).toBe(3);
    expect(nearestFrame({ a: 3, b: 4, f: 0.6, clamped: false })).toBe(4);
  });
});

describe("sliderValue — curseur de la frise (revue finale F8)", () => {
  const start = T0;
  it("live : heure entamée, jamais en avance sur l'instant", () => {
    expect(sliderValue(start + 90 * 60_000, start, true)).toBe(1); // 1 h 30 → cran 1, pas 2
    expect(sliderValue(start + 59 * 60_000, start, true)).toBe(0);
  });
  it("fixe : arrondi à l'heure la plus proche (lecture)", () => {
    expect(sliderValue(start + 90 * 60_000, start, false)).toBe(2);
    expect(sliderValue(start + 29 * 60_000, start, false)).toBe(0);
  });
});

describe("fallbackFrames — repli à l'activation (revue finale F1)", () => {
  it("les plus proches de la cible d'abord, hors échéances exclues, au plus `max`", () => {
    const want = { a: 4, b: 5, f: 0.25, clamped: false }; // cible 4
    expect(fallbackFrames(want, 20, (i) => i !== 4, 2)).toEqual([3, 5]);
    expect(fallbackFrames(want, 20, (i) => i !== 4 && i !== 5, 3)).toEqual([3, 2, 6]); // à égalité, le plus tôt d'abord
  });
  it("bornée à la frise", () => {
    expect(fallbackFrames({ a: 0, b: 0, f: 0, clamped: false }, 3, (i) => i !== 0, 2)).toEqual([1, 2]);
    expect(fallbackFrames({ a: 0, b: 0, f: 0, clamped: false }, 1, (i) => i !== 0, 2)).toEqual([]);
  });
});
