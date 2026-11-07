import { describe, expect, it } from "vitest";
import { FOREST_MIN_DISTANCE, MIN_DISTANCE, initialMinDistance, rotateSpeedFor } from "../src/render/scene";

describe("caméra profonde sous Forest (lot R5c)", () => {
  it("FOREST_MIN_DISTANCE : altitude minimale divisée par 4 (≈ 1,0105)", () => {
    expect(FOREST_MIN_DISTANCE).toBeCloseTo(1.0105, 10);
    expect(FOREST_MIN_DISTANCE - 1).toBeCloseTo((MIN_DISTANCE - 1) / 4, 12);
  });
  it("initialMinDistance : Forest → limite basse, autre couche ou aucune → limite normale (Review Focus 4)", () => {
    expect(initialMinDistance("forest")).toBe(FOREST_MIN_DISTANCE);
    expect(initialMinDistance("temperature")).toBe(MIN_DISTANCE);
    expect(initialMinDistance(null)).toBe(MIN_DISTANCE);
  });
  it("rotateSpeedFor : 0,25·(d−1) borné à [0,25·(FOREST_MIN_DISTANCE−1), 0,5] — vitesse écran constante jusqu'en bas de Forest", () => {
    expect(rotateSpeedFor(4)).toBe(0.5);
    expect(rotateSpeedFor(1.3)).toBeCloseTo(0.075, 12);
    expect(rotateSpeedFor(1.04)).toBeCloseTo(0.01, 12); // inchangé au-dessus de l'altitude 0,04
    expect(rotateSpeedFor(1.02)).toBeCloseTo(0.005, 12); // ancien plancher 0,01 : 2× trop rapide
    expect(rotateSpeedFor(FOREST_MIN_DISTANCE)).toBeCloseTo(0.25 * (FOREST_MIN_DISTANCE - 1), 12);
    expect(rotateSpeedFor(1.001)).toBeCloseTo(0.25 * (FOREST_MIN_DISTANCE - 1), 12);
  });
});
