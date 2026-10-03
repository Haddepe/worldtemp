/**
 * Composition de l'image capturée (spec capture §4.2) : liste d'ordres de dessin en px d'image,
 * sans canvas — testable dans Vitest. `paint.ts` les exécute. Les étiquettes reprennent les
 * règles de `.label` (style.css) ; le point épinglé, celles de `#marker` et `#tooltip`.
 */
import type { Encoding } from "../data/encoding";
import { STRINGS } from "../i18n";
import type { LabelView } from "../labels/layer";
import type { LayerDef } from "../layers/registry";
import { legendStops } from "../render/colormap";
import { legendTicks } from "../ui/format";
import { placeTooltip } from "../ui/tooltip";
import { captureRun, captureWhen } from "./naming";

// Pas de famille générique « sans-serif » : le garde-fou english.test.ts lit « sans » comme un mot
// français dans tout littéral de src/ (dette n° 44) ; Helvetica/Arial couvrent les systèmes restants.
export const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial';

export type DrawOp =
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: string; radius?: number }
  | { kind: "gradient"; x: number; y: number; w: number; h: number; stops: readonly { at: number; color: string }[]; radius?: number }
  | { kind: "text"; x: number; y: number; text: string; font: string; fill: string; align: "left" | "center" | "right"; halo?: string; haloWidth?: number; letterSpacing?: number }
  | { kind: "dot"; x: number; y: number; r: number; fill: string; stroke: string; strokeWidth: number };

export interface CaptureLayer { def: LayerDef; enc: Encoding; model: string; run: string }

export interface CaptureInput {
  /** Taille de l'image (= tampon WebGL), px d'image. */
  width: number;
  height: number;
  /** px d'image par px CSS. */
  dpr: number;
  layer: CaptureLayer | null;
  tMs: number;
  /** Positions en px CSS, telles que passées au DOM. */
  labels: { views: readonly LabelView[]; dark: boolean };
  /** px CSS ; `null` si rien d'épinglé ou « ma position » (filtré en amont). */
  pin: { x: number; y: number; text: string | null } | null;
}

/** Largeur d'un texte, en px d'image, pour une police CSS donnée. */
export type Measure = (text: string, font: string) => number;

const ROOT_PX = 14; // :root { font-size: 14px }
const BAND_FILL = "rgba(10, 12, 18, 0.82)";
const CARD_FILL = "rgba(10, 12, 18, 0.72)"; // --panel-bg #0a0c12b8
const FG = "#e8ecf2";
const MUTED = "#9aa3b2";
const ACCENT = "#ffd166";

const r2 = (v: number): number => Math.round(v * 100) / 100;
const font = (px: number, bold = false): string => `${bold ? "bold " : ""}${r2(px)}px ${FONT_STACK}`;

/** Hauteur d'une rangée de bandeau, px d'image : clamp(64, 0.12 × min, 120) px CSS × DPR. */
export function bandHeight(width: number, height: number, dpr: number): number {
  const css = Math.min(120, Math.max(64, (0.12 * Math.min(width, height)) / dpr));
  return Math.round(css * dpr);
}

function labelOps(views: readonly LabelView[], dark: boolean, d: number): DrawOp[] {
  const ops: DrawOp[] = [];
  const halo = dark ? "#fff" : "#000";
  for (const v of views) {
    if (v.kind === "city") {
      const fill = dark ? "#1b1f24" : "#fff";
      const f = 0.72 * ROOT_PX * d;
      // .label.city : marge (−7.5, 8) px, lignes de 15 px ; le point (6 px) est centré sur l'ancre.
      ops.push({ kind: "dot", x: v.x * d, y: v.y * d, r: 3 * d, fill, stroke: halo, strokeWidth: 1 * d });
      ops.push({ kind: "text", x: (v.x + 8) * d, y: v.y * d, text: v.name, font: font(f), fill, align: "left", halo, haloWidth: 2 * d });
      if (v.value) ops.push({ kind: "text", x: (v.x + 8) * d, y: (v.y + 15) * d, text: v.value, font: font(f, true), fill, align: "left", halo, haloWidth: 2 * d });
    } else {
      const f = 0.8 * ROOT_PX;
      ops.push({
        kind: "text", x: v.x * d, y: v.y * d, text: v.name.toUpperCase(), font: font(f * d),
        fill: dark ? "#2a2f36" : "#f4f4f4", align: "center", halo, haloWidth: 2 * d, letterSpacing: r2(0.12 * f * d),
      });
    }
  }
  return ops;
}

function pinOps(pin: NonNullable<CaptureInput["pin"]>, input: CaptureInput, measure: Measure): DrawOp[] {
  const d = input.dpr;
  const ops: DrawOp[] = [{ kind: "dot", x: pin.x * d, y: pin.y * d, r: 5 * d, fill: ACCENT, stroke: "#fff", strokeWidth: 2 * d }];
  if (!pin.text) return ops;
  // #tooltip : padding .25rem .6rem, police 14 px, interligne 1.25.
  const lines = pin.text.split("\n");
  const f = font(ROOT_PX * d);
  const padX = 0.6 * ROOT_PX;
  const padY = 0.25 * ROOT_PX;
  const lineH = 1.25 * ROOT_PX;
  const w = Math.max(...lines.map((l) => measure(l, f) / d)) + 2 * padX;
  const h = lines.length * lineH + 2 * padY;
  const { left, top } = placeTooltip({ x: pin.x, y: pin.y }, { w, h }, { w: input.width / d, h: input.height / d });
  ops.push({ kind: "rect", x: left * d, y: top * d, w: w * d, h: h * d, fill: CARD_FILL, radius: 8 * d });
  lines.forEach((text, i) => {
    ops.push({ kind: "text", x: (left + padX) * d, y: (top + padY + lineH * (i + 0.5)) * d, text, font: f, fill: FG, align: "left" });
  });
  return ops;
}

function bandOps(input: CaptureInput): DrawOp[] {
  const { width, height, dpr, layer, tMs } = input;
  const h = bandHeight(width, height, dpr);
  const stacked = layer !== null && width / dpr < 600;
  const total = stacked ? 2 * h : h;
  const y0 = height - total;
  const pad = 0.18 * h;
  const ops: DrawOp[] = [{ kind: "rect", x: 0, y: y0, w: width, h: total, fill: BAND_FILL }];
  const right = width - pad;
  const yR = stacked ? y0 + h : y0;
  if (layer) {
    const { def, enc } = layer;
    const barW = stacked ? width - 2 * pad : r2(0.38 * width);
    ops.push({ kind: "text", x: pad, y: y0 + pad + 0.1 * h, text: `${def.label} · ${def.unit}`, font: font(0.2 * h), fill: FG, align: "left" });
    ops.push({ kind: "gradient", x: pad, y: y0 + pad + 0.28 * h, w: barW, h: 0.14 * h, stops: legendStops(def, enc), radius: 0.04 * h });
    for (const t of legendTicks(def, enc)) {
      ops.push({ kind: "text", x: pad + (t.pct / 100) * barW, y: y0 + pad + 0.54 * h, text: t.label, font: font(0.16 * h), fill: MUTED, align: "center" });
    }
    ops.push({ kind: "text", x: right, y: yR + pad + 0.1 * h, text: STRINGS.capture.forecastFor(captureWhen(tMs)), font: font(0.16 * h), fill: FG, align: "right" });
    ops.push({ kind: "text", x: right, y: yR + pad + 0.34 * h, text: captureRun(layer.model, layer.run), font: font(0.16 * h), fill: MUTED, align: "right" });
    ops.push({ kind: "text", x: right, y: yR + pad + 0.58 * h, text: STRINGS.capture.site, font: font(0.2 * h, true), fill: ACCENT, align: "right" });
  } else {
    ops.push({ kind: "text", x: right, y: yR + pad + 0.1 * h, text: STRINGS.capture.captured(captureWhen(tMs)), font: font(0.16 * h), fill: FG, align: "right" });
    ops.push({ kind: "text", x: right, y: yR + pad + 0.34 * h, text: STRINGS.capture.site, font: font(0.2 * h, true), fill: ACCENT, align: "right" });
  }
  return ops;
}

/** Étiquettes → point épinglé → bandeau : le bandeau recouvre ce qui passe dessous. */
export function composeCapture(input: CaptureInput, measure: Measure): DrawOp[] {
  return [
    ...labelOps(input.labels.views, input.labels.dark, input.dpr),
    ...(input.pin ? pinOps(input.pin, input, measure) : []),
    ...bandOps(input),
  ];
}
