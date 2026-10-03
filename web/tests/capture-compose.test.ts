import { describe, expect, it } from "vitest";
import { FONT_STACK, bandHeight, composeCapture, type CaptureInput, type DrawOp } from "../src/capture/compose";
import { layerDef } from "../src/layers/registry";

const T = Date.UTC(2026, 9, 3, 13, 24); // sam. 3 oct. 2026, 13:24 UTC, entre f003 et f006 du run 06Z
const measure = (text: string) => text.length * 10;
const temp = { def: layerDef("temp")!, enc: { bits: 8, min: -90, max: 60, scale: "linear" as const }, model: "gfs_0p25", run: "2026-10-03T06:00:00Z" };
const dust = { def: layerDef("dust")!, enc: { bits: 8, min: 0, max: 2000, scale: "sqrt" as const }, model: "gefs_chem_0p25", run: "2026-10-03T00:00:00Z" };
const base: CaptureInput = { width: 1920, height: 1080, dpr: 1, layer: temp, tMs: T, labels: { views: [], dark: false }, pin: null };

const texts = (ops: DrawOp[]) => ops.filter((o): o is Extract<DrawOp, { kind: "text" }> => o.kind === "text");
const band = (ops: DrawOp[]) => ops.find((o) => o.kind === "rect" && o.fill === "rgba(10, 12, 18, 0.82)") as Extract<DrawOp, { kind: "rect" }>;
const textOf = (ops: DrawOp[], s: string) => texts(ops).find((o) => o.text === s)!;

describe("bandHeight — clamp(64, 0.12 × min, 120) px CSS × DPR", () => {
  it("paysage 1920×1080 @1 → 120 ; portrait 390×844 @3 → 64 × 3 ; 800×600 @2 → 72 × 2", () => {
    expect(bandHeight(1920, 1080, 1)).toBe(120);
    expect(bandHeight(1170, 2532, 3)).toBe(192);
    expect(bandHeight(1600, 1200, 2)).toBe(144);
  });
});

describe("composeCapture — bandeau", () => {
  it("paysage : une rangée, couche à gauche, date/run/site à droite", () => {
    const ops = composeCapture(base, measure);
    expect(band(ops)).toMatchObject({ x: 0, y: 960, w: 1920, h: 120 });
    const title = textOf(ops, "Temperature · °C");
    expect(title).toMatchObject({ align: "left", font: `${24}px ${FONT_STACK}` });
    expect(title.x).toBeCloseTo(21.6, 6);
    expect(title.y).toBeCloseTo(993.6, 6);
    const bar = ops.find((o) => o.kind === "gradient")!;
    expect(bar).toMatchObject({ kind: "gradient" });
    if (bar.kind === "gradient") {
      expect(bar.x).toBeCloseTo(21.6, 6);
      expect(bar.y).toBeCloseTo(1015.2, 6);
      expect(bar.w).toBeCloseTo(729.6, 6);
      expect(bar.h).toBeCloseTo(16.8, 6);
      expect(bar.stops).toHaveLength(temp.def.stops.length);
    }
    const ticks = texts(ops).filter((o) => o.align === "center" && o.fill === "#9aa3b2");
    expect(ticks.map((o) => o.text)).toEqual(["−40", "−30", "−20", "−10", "0", "10", "20", "30", "40"]);
    const when = textOf(ops, "Forecast for Sat 3 Oct 2026, 13:24 UTC");
    expect(when).toMatchObject({ align: "right" });
    expect(when.x).toBeCloseTo(1898.4, 6);
    expect(when.y).toBeCloseTo(993.6, 6);
    expect(textOf(ops, "NOAA GFS run 3 Oct 06Z").y).toBeCloseTo(1022.4, 6);
    const site = textOf(ops, "globelayers.com");
    expect(site.font).toBe(`bold 24px ${FONT_STACK}`);
    expect(site.y).toBeCloseTo(1051.2, 6);
  });
  it("portrait 390×844 @3 : blocs empilés, bandeau doublé, légende pleine largeur", () => {
    const ops = composeCapture({ ...base, width: 1170, height: 2532, dpr: 3, layer: dust }, measure);
    expect(band(ops)).toMatchObject({ x: 0, y: 2148, w: 1170, h: 384 });
    const bar = ops.find((o) => o.kind === "gradient")!;
    if (bar.kind === "gradient") expect(bar.w).toBeCloseTo(1170 - 2 * 34.56, 6);
    expect(textOf(ops, "Dust · µg/m³").y).toBeCloseTo(2148 + 34.56 + 19.2, 6);
    expect(textOf(ops, "Forecast for Sat 3 Oct 2026, 13:24 UTC").y).toBeCloseTo(2148 + 192 + 34.56 + 19.2, 6);
    expect(textOf(ops, "NOAA GEFS-Aerosols run 3 Oct 00Z")).toBeDefined();
  });
  it("sans couche : ni légende ni run, « Captured … » et le site, une seule rangée", () => {
    const ops = composeCapture({ ...base, layer: null }, measure);
    expect(band(ops)).toMatchObject({ y: 960, h: 120 });
    expect(ops.some((o) => o.kind === "gradient")).toBe(false);
    expect(textOf(ops, "Captured Sat 3 Oct 2026, 13:24 UTC").y).toBeCloseTo(993.6, 6);
    expect(textOf(ops, "globelayers.com").y).toBeCloseTo(1022.4, 6);
    expect(texts(ops).some((o) => o.text.includes(" run "))).toBe(false);
  });
});

describe("composeCapture — étiquettes (mêmes règles que .label du CSS)", () => {
  const views = [
    { id: 1, kind: "city" as const, name: "Paris", value: "18.0 °C", x: 100, y: 50 },
    { id: 2, kind: "city" as const, name: "Lyon", value: null, x: 120, y: 80 },
    { id: 3, kind: "country" as const, name: "France", value: null, x: 500, y: 300 },
  ];
  it("@3, clair : point, nom à +8 px, valeur en gras 15 px plus bas, pays en majuscules centré", () => {
    const ops = composeCapture({ ...base, width: 1170, height: 2532, dpr: 3, labels: { views, dark: false } }, measure);
    expect(ops).toContainEqual({ kind: "dot", x: 300, y: 150, r: 9, fill: "#fff", stroke: "#000", strokeWidth: 3 });
    expect(ops).toContainEqual({ kind: "text", x: 324, y: 150, text: "Paris", font: `30.24px ${FONT_STACK}`, fill: "#fff", align: "left", halo: "#000", haloWidth: 6 });
    expect(ops).toContainEqual({ kind: "text", x: 324, y: 195, text: "18.0 °C", font: `bold 30.24px ${FONT_STACK}`, fill: "#fff", align: "left", halo: "#000", haloWidth: 6 });
    expect(texts(ops).filter((o) => o.text === "Lyon")).toHaveLength(1);
    expect(ops).toContainEqual({ kind: "text", x: 1500, y: 900, text: "FRANCE", font: `33.6px ${FONT_STACK}`, fill: "#f4f4f4", align: "center", halo: "#000", haloWidth: 6, letterSpacing: 4.03 });
  });
  it("variante sombre : texte foncé, halo clair", () => {
    const ops = composeCapture({ ...base, labels: { views: views.slice(0, 1), dark: true } }, measure);
    expect(ops).toContainEqual({ kind: "dot", x: 100, y: 50, r: 3, fill: "#1b1f24", stroke: "#fff", strokeWidth: 1 });
    expect(textOf(ops, "Paris")).toMatchObject({ fill: "#1b1f24", halo: "#fff" });
  });
  it("étiquettes dessinées avant le bandeau (le bandeau recouvre)", () => {
    const ops = composeCapture({ ...base, labels: { views, dark: false } }, measure);
    expect(ops.indexOf(textOf(ops, "Paris"))).toBeLessThan(ops.indexOf(band(ops)));
  });
});

describe("composeCapture — point épinglé", () => {
  it("marqueur jaune et cartouche placé comme le tooltip (au-dessus du point)", () => {
    const ops = composeCapture({ ...base, width: 400, height: 400, layer: null, pin: { x: 200, y: 100, text: "Paris\n18.0 °C" } }, measure);
    expect(ops).toContainEqual({ kind: "dot", x: 200, y: 100, r: 5, fill: "#ffd166", stroke: "#fff", strokeWidth: 2 });
    const card = ops.find((o) => o.kind === "rect" && o.fill === "rgba(10, 12, 18, 0.72)") as Extract<DrawOp, { kind: "rect" }>;
    expect(card.x).toBeCloseTo(156.6, 6);
    expect(card.y).toBeCloseTo(44, 6);
    expect(card.w).toBeCloseTo(86.8, 6);
    expect(card.h).toBeCloseTo(42, 6);
    expect(textOf(ops, "Paris").x).toBeCloseTo(165, 6);
    expect(textOf(ops, "Paris").y).toBeCloseTo(56.25, 6);
    expect(textOf(ops, "18.0 °C").y).toBeCloseTo(73.75, 6);
  });
  it("épingle sans texte : marqueur seul", () => {
    const ops = composeCapture({ ...base, layer: null, pin: { x: 10, y: 10, text: null } }, measure);
    expect(ops.some((o) => o.kind === "dot" && o.fill === "#ffd166")).toBe(true);
    expect(ops.some((o) => o.kind === "rect" && o.fill === "rgba(10, 12, 18, 0.72)")).toBe(false);
  });
});
