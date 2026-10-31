import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Encoding } from "../src/data/encoding";
import { decode, encode } from "../src/data/encoding";
import { layerDef, type LayerDef } from "../src/layers/registry";
import { LUT_SIZE, buildForestLut, buildLut, colorAt, createLutTexture, legendGradientCss, legendStops, legendStopsCss } from "../src/render/colormap";

const temp = layerDef("temp")!;
const rain = layerDef("rain")!;
const LIN: Encoding = { bits: 8, min: -90, max: 60, scale: "linear" };
const SQRT: Encoding = { bits: 8, min: 0, max: 50, scale: "sqrt" };

describe("colorAt", () => {
  it("borne aux arrêts extrêmes et interpole les 4 canaux", () => {
    expect(colorAt(temp.stops, -200)).toEqual(temp.stops[0]!.rgba);
    expect(colorAt(temp.stops, 200)).toEqual(temp.stops[temp.stops.length - 1]!.rgba);
    const mid = colorAt([{ v: 0, rgba: [0, 0, 0, 0] }, { v: 10, rgba: [100, 200, 50, 255] }], 5);
    expect(mid).toEqual([50, 100, 25, 127.5]);
  });
});

describe("buildLut", () => {
  it("256 texels RGBA, texel i = couleur à decode(i)", () => {
    const lut = buildLut(temp, LIN);
    expect(lut.length).toBe(LUT_SIZE * 4);
    const i = encode(0, LIN); // 153 → 0 °C → vert (40, 170, 70)
    expect([lut[i * 4], lut[i * 4 + 1], lut[i * 4 + 2], lut[i * 4 + 3]]).toEqual([40, 170, 70, 255]);
    expect(lut[3]).toBe(255);
  });
  it("racine : la transparence de la pluie suit les valeurs physiques, pas l'octet", () => {
    const lut = buildLut(rain, SQRT);
    expect(lut[3]).toBe(0);                                  // 0 mm/h
    const under = encode(0.05, SQRT);                        // sous 0,1 mm/h : encore transparent
    expect(lut[under * 4 + 3]).toBe(0);
    const rainy = encode(2, SQRT);
    expect(lut[rainy * 4 + 3]).toBeGreaterThan(200);
    expect(decode(rainy, SQRT)).toBeCloseTo(2, 0);
  });
});

describe("legendGradientCss", () => {
  it("rgba() aux positions encode(v)/255 — non uniformes en racine", () => {
    const css = legendGradientCss(rain, SQRT);
    expect(css.startsWith("linear-gradient(to right, rgba(")).toBe(true);
    const pct = (v: number) => ((encode(v, SQRT) / 255) * 100).toFixed(2).replace(/\.?0+$/, "");
    expect(css).toContain(`${pct(2)}%`);
    expect(css).toContain(`${pct(50)}%`);
  });
  it("linéaire : positions proportionnelles", () => {
    expect(legendGradientCss(temp, LIN)).toContain("rgba(40, 170, 70, 1) 60%");
  });
});

describe("createLutTexture", () => {
  it("texture sRGB 256×1 sans mipmaps, filtrage linéaire, clamp", () => {
    const t = createLutTexture(buildLut(temp, LIN));
    expect(t.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(t.image.width).toBe(LUT_SIZE);
    expect(t.generateMipmaps).toBe(false);
    expect(t.wrapS).toBe(THREE.ClampToEdgeWrapping);
  });
});

describe("legendStops", () => {
  it("mêmes arrêts que le gradient CSS, positions 0–1", () => {
    const def = { stops: [{ v: 0, rgba: [0, 0, 0, 255] }, { v: 50, rgba: [255, 0, 0, 128] }] } as unknown as LayerDef;
    const enc = { bits: 8, min: 0, max: 100, scale: "linear" } as const;
    expect(legendStops(def, enc)).toEqual([
      { at: 0, color: "rgba(0, 0, 0, 1)" },
      { at: 128 / 255, color: "rgba(255, 0, 0, 0.502)" },
    ]);
  });
});

describe("legendStopsCss — arrêts seuls, l'orientation est choisie par le CSS (mobile vertical, 2026-10-03)", () => {
  it("le gradient CSS de la légende est exactement linear-gradient(to right, <arrêts>)", () => {
    expect(legendGradientCss(temp, LIN)).toBe(`linear-gradient(to right, ${legendStopsCss(temp, LIN)})`);
  });
  it("arrêts aux positions encode(v)/255", () => {
    const def = { stops: [{ v: 0, rgba: [0, 0, 0, 255] }, { v: 100, rgba: [255, 0, 0, 128] }] } as unknown as LayerDef;
    expect(legendStopsCss(def, { bits: 8, min: 0, max: 100, scale: "linear" })).toBe("rgba(0, 0, 0, 1) 0%, rgba(255, 0, 0, 0.502) 100%");
  });
});

describe("buildForestLut — palette de la couche Forest (spec forêt §7)", () => {
  const forest = layerDef("forest")!;
  const px = (lut: Uint8Array, row: number, i: number) => Array.from(lut.slice((row * LUT_SIZE + i) * 4, (row * LUT_SIZE + i) * 4 + 4));
  it("256 × 2 RGBA : ligne 0 = couvert indexé par l'octet (%), ligne 1 = pertes indexées par l'octet (année − base)", () => {
    const lut = buildForestLut(forest, 2000);
    expect(lut.length).toBe(LUT_SIZE * 2 * 4);
    expect(px(lut, 0, 0)[3]).toBe(0);
    expect(px(lut, 0, 29)[3]).toBe(0);
    expect(px(lut, 0, 30)).toEqual(forest.stops.find((s) => s.v === 30)!.rgba);
    expect(px(lut, 0, 100)).toEqual(forest.stops[forest.stops.length - 1]!.rgba);
    expect(px(lut, 0, 255)).toEqual(forest.stops[forest.stops.length - 1]!.rgba);
    expect(px(lut, 1, 0)[3]).toBe(0);                                   // 0 = pas de perte
    expect(px(lut, 1, 1)).toEqual(forest.lossStops![0]!.rgba);          // 2001
    expect(px(lut, 1, 24)).toEqual(forest.lossStops![forest.lossStops!.length - 1]!.rgba); // 2024
  });
  it("createLutTexture accepte deux lignes", () => {
    const tex = createLutTexture(buildForestLut(forest, 2000), 2);
    expect(tex.image.width).toBe(LUT_SIZE);
    expect(tex.image.height).toBe(2);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
  });
});
