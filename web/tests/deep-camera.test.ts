import { describe, expect, it } from "vitest";
import { FOREST_MIN_DISTANCE, MIN_DISTANCE, initialMinDistance } from "../src/render/scene";

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
});
