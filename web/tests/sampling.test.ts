import { describe, expect, it } from "vitest";
import { heatmapUv, sampleTemperature } from "../src/data/sampling";

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

/** Grille 4×3 (lon −180, −90, 0, 90 ; lat 90, 0, −90), canal R = valeur, nord en haut. */
function pixels4x3(values: number[][]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(4 * 3 * 4);
  values.forEach((row, y) => row.forEach((v, x) => { px[(y * 4 + x) * 4] = v; px[(y * 4 + x) * 4 + 3] = 255; }));
  return px;
}
const G = { width: 4, height: 3 };
const E = { min_c: -90, max_c: 60 }; // pas de 150 °C sur 255 niveaux
const px = pixels4x3([
  [0, 51, 102, 153],
  [204, 255, 0, 51],
  [102, 153, 204, 255],
]);
const toC = (v: number) => E.min_c + (v / 255) * (E.max_c - E.min_c);

describe("sampleTemperature — spec navigation §5", () => {
  it("centre de cellule exact : lon -180, lat 90 → pixel (0,0) ; lon -90, lat 0 → (1,1)", () => {
    expect(sampleTemperature(px, G, E, -180, 90)).toBeCloseTo(toC(0), 9);
    expect(sampleTemperature(px, G, E, -90, 0)).toBeCloseTo(toC(255), 9);
  });
  it("ligne 0 = nord (lat 90), dernière ligne = sud", () => {
    expect(sampleTemperature(px, G, E, 0, 90)).toBeCloseTo(toC(102), 9);
    expect(sampleTemperature(px, G, E, 0, -90)).toBeCloseTo(toC(204), 9);
  });
  it("milieu de deux cellules = moyenne", () => {
    expect(sampleTemperature(px, G, E, -135, 90)).toBeCloseTo(toC(25.5), 9);
    expect(sampleTemperature(px, G, E, -180, 45)).toBeCloseTo(toC(102), 9);
  });
  it("bouclage : lon 135 interpole la dernière colonne avec la première", () => {
    expect(sampleTemperature(px, G, E, 135, 90)).toBeCloseTo(toC((153 + 0) / 2), 9);
    expect(sampleTemperature(px, G, E, 180, 90)).toBeCloseTo(toC(0), 9);
    expect(sampleTemperature(px, G, E, -270, 90)).toBeCloseTo(toC(153), 9); // −270 ≡ 90 → colonne 3
  });
  it("latitudes hors bornes sont bornées aux pôles", () => {
    expect(sampleTemperature(px, G, E, -180, 95)).toBeCloseTo(toC(0), 9);
    expect(sampleTemperature(px, G, E, -180, -95)).toBeCloseTo(toC(102), 9);
  });
  it("encodage : 0 → min_c, 255 → max_c", () => {
    expect(sampleTemperature(px, G, E, -180, 90)).toBeCloseTo(-90, 9);
    expect(sampleTemperature(px, G, E, -90, 0)).toBeCloseTo(60, 9);
  });
});
