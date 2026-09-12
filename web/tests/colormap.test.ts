import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Encoding } from "../src/data/encoding";
import { decode, encode } from "../src/data/encoding";
import { layerDef } from "../src/layers/registry";
import { LUT_SIZE, buildLut, colorAt, createLutTexture, legendGradientCss } from "../src/render/colormap";

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
