import { describe, expect, it } from "vitest";
import { decode, type Encoding } from "../src/data/encoding";
import { heatmapUv, sampleValue } from "../src/data/sampling";

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
const LIN: Encoding = { bits: 8, min: -90, max: 60, scale: "linear" };
const SQRT: Encoding = { bits: 8, min: 0, max: 50, scale: "sqrt" };
const px = pixels4x3([
  [0, 51, 102, 153],
  [204, 255, 0, 51],
  [102, 153, 204, 255],
]);
const lin = (t: number) => decode(t, LIN);

describe("sampleValue — spec navigation §5 généralisée (spec couches §11)", () => {
  it("centre de cellule exact", () => {
    expect(sampleValue(px, G, LIN, -180, 90)).toBeCloseTo(lin(0), 9);
    expect(sampleValue(px, G, LIN, -90, 0)).toBeCloseTo(lin(255), 9);
  });
  it("ligne 0 = nord, dernière ligne = sud", () => {
    expect(sampleValue(px, G, LIN, 0, 90)).toBeCloseTo(lin(102), 9);
    expect(sampleValue(px, G, LIN, 0, -90)).toBeCloseTo(lin(204), 9);
  });
  it("milieu de deux cellules = moyenne des octets, puis décodage", () => {
    expect(sampleValue(px, G, LIN, -135, 90)).toBeCloseTo(lin(25.5), 9);
    expect(sampleValue(px, G, LIN, -180, 45)).toBeCloseTo(lin(102), 9);
  });
  it("bouclage en longitude", () => {
    expect(sampleValue(px, G, LIN, 135, 90)).toBeCloseTo(lin(76.5), 9);
    expect(sampleValue(px, G, LIN, 180, 90)).toBeCloseTo(lin(0), 9);
    expect(sampleValue(px, G, LIN, -270, 90)).toBeCloseTo(lin(153), 9);
  });
  it("latitudes hors bornes bornées aux pôles", () => {
    expect(sampleValue(px, G, LIN, -180, 95)).toBeCloseTo(lin(0), 9);
    expect(sampleValue(px, G, LIN, -180, -95)).toBeCloseTo(lin(102), 9);
  });
  it("racine : l'interpolation se fait sur l'octet, le décodage ensuite", () => {
    // milieu de 0 et 51 → octet 25,5 → 50·(25,5/255)² = 0,5 mm/h
    expect(sampleValue(px, G, SQRT, -135, 90)).toBeCloseTo(50 * (25.5 / 255) ** 2, 9);
    expect(sampleValue(px, G, SQRT, -90, 0)).toBeCloseTo(50, 9);
  });
});
