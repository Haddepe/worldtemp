import { describe, expect, it } from "vitest";
import { heatmapUv } from "../src/data/sampling";

const grid = { width: 1440, height: 721 };
const EPS = 1e-12;

describe("heatmapUv — spec pipeline §4", () => {
  it("coin haut-gauche : lon -180, lat +90 → centre du pixel (0, 0)", () => {
    const { u, v } = heatmapUv(-180, 90, grid);
    expect(u).toBeCloseTo(1 / 2880, 12);
    expect(v).toBeCloseTo(1 - 0.5 / 721, 12);
  });

  it("origine : lon 0, lat 0 → colonne 720, ligne 360", () => {
    const { u, v } = heatmapUv(0, 0, grid);
    expect(Math.abs(u - (0.5 + 1 / 2880))).toBeLessThan(EPS);
    expect(Math.abs(v - (1 - 360.5 / 721))).toBeLessThan(EPS);
  });

  it("dernière colonne : lon 179,75, lat -90 → u = 1 - 1/2880, v = 0,5/721", () => {
    const { u, v } = heatmapUv(179.75, -90, grid);
    expect(u).toBeCloseTo(1 - 1 / 2880, 12);
    expect(v).toBeCloseTo(0.5 / 721, 12);
  });

  it("lon +180 retombe au-delà de 1 : c'est RepeatWrapping qui boucle", () => {
    const { u } = heatmapUv(180, 0, grid);
    expect(u).toBeCloseTo(1 + 1 / 2880, 12);
  });
});
