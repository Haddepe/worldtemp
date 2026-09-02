import { describe, expect, it } from "vitest";
import { STOPS, LUT_SIZE, buildLut, colorAt, legendGradientCss } from "../src/render/colormap";

const MIN = -90;
const MAX = 60;

describe("STOPS", () => {
  it("couvre -90 → +60 en ordre croissant", () => {
    expect(STOPS[0]?.c).toBe(-90);
    expect(STOPS[STOPS.length - 1]?.c).toBe(60);
    for (let i = 1; i < STOPS.length; i++) {
      expect(STOPS[i]!.c).toBeGreaterThan(STOPS[i - 1]!.c);
    }
  });
});

describe("colorAt", () => {
  it("renvoie la couleur exacte d'un arrêt", () => {
    expect(colorAt(STOPS, -45)).toEqual(STOPS[1]!.rgb);
  });
  it("interpole linéairement entre deux arrêts", () => {
    const a = STOPS[4]!; // 0 °C
    const b = STOPS[5]!; // 10 °C
    const mid = colorAt(STOPS, 5);
    for (let k = 0; k < 3; k++) {
      expect(mid[k]).toBeCloseTo((a.rgb[k]! + b.rgb[k]!) / 2, 6);
    }
  });
  it("borne en dehors de la plage", () => {
    expect(colorAt(STOPS, -200)).toEqual(STOPS[0]!.rgb);
    expect(colorAt(STOPS, 200)).toEqual(STOPS[STOPS.length - 1]!.rgb);
  });
});

describe("buildLut", () => {
  const lut = buildLut(STOPS, MIN, MAX);

  it("fait 256 texels RGBA", () => {
    expect(lut).toBeInstanceOf(Uint8Array);
    expect(lut.length).toBe(LUT_SIZE * 4);
  });

  it("est déterministe", () => {
    expect(buildLut(STOPS, MIN, MAX)).toEqual(lut);
  });

  it("premier texel = couleur de -90, dernier = couleur de +60, alpha 255", () => {
    expect([lut[0], lut[1], lut[2], lut[3]]).toEqual([...STOPS[0]!.rgb, 255]);
    const o = (LUT_SIZE - 1) * 4;
    expect([lut[o], lut[o + 1], lut[o + 2], lut[o + 3]]).toEqual([...STOPS[STOPS.length - 1]!.rgb, 255]);
  });

  it("l'arrêt -45 °C tombe à l'index 77 pour [-90, 60]", () => {
    // (−45 − (−90)) / 150 · 255 = 76,5 → texel 77 ↔ −44,7 °C, à moins de 2 niveaux de l'arrêt
    const i = Math.round(((-45 - MIN) / (MAX - MIN)) * (LUT_SIZE - 1));
    expect(i).toBe(77);
    const target = STOPS[1]!.rgb;
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(lut[i * 4 + k]! - target[k]!)).toBeLessThanOrEqual(2);
    }
  });
});

describe("legendGradientCss", () => {
  it("cite les mêmes arrêts dans le même ordre, en pourcentage de la plage", () => {
    const css = legendGradientCss(STOPS, MIN, MAX);
    expect(css.startsWith("linear-gradient(to right, ")).toBe(true);
    expect(css).toContain("rgb(30, 0, 50) 0%");
    expect(css).toContain("rgb(10, 20, 110) 30%");
    expect(css).toContain("rgb(90, 0, 70) 100%");
    const order = STOPS.map((s) => css.indexOf(`rgb(${s.rgb.join(", ")})`));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]!);
  });
});
