import { describe, expect, it } from "vitest";
import {
  TILE_SIZE, children, parent, pixelsPerDegree, subRect, tileAt, tileBounds, tileKey, tileSpan, tilesPerLevel,
} from "../src/tiles/grid";

describe("grid (mêmes nombres que tiler/grid.py)", () => {
  it("niveaux", () => {
    expect(TILE_SIZE).toBe(512);
    expect(tilesPerLevel(0)).toEqual([2, 1]);
    expect(tilesPerLevel(8)).toEqual([512, 256]);
    expect(tileSpan(0)).toBe(180);
    expect(tileSpan(8)).toBeCloseTo(0.703125, 9);
    expect(pixelsPerDegree(8)).toBeCloseTo(728.1777, 3);
  });

  it("nombres de contrôle partagés", () => {
    expect(tileBounds({ z: 0, x: 1, y: 0 })).toEqual({ lonMin: 0, lonMax: 180, latMin: -90, latMax: 90 });
    const b = tileBounds({ z: 8, x: 254, y: 57 });
    expect(b.lonMin).toBeCloseTo(-1.40625, 9);
    expect(b.lonMax).toBeCloseTo(-0.703125, 9);
    expect(b.latMin).toBeCloseTo(49.21875, 9);
    expect(b.latMax).toBeCloseTo(49.921875, 9);
    expect(tileAt(8, -1.62, 49.64)).toEqual({ z: 8, x: 253, y: 57 });
  });

  it("bords bornés", () => {
    expect(tileAt(0, -180, 90)).toEqual({ z: 0, x: 0, y: 0 });
    expect(tileAt(0, 180, -90)).toEqual({ z: 0, x: 1, y: 0 });
    expect(tileAt(3, 180, -90)).toEqual({ z: 3, x: 15, y: 7 });
  });

  it("parent, enfants, clé", () => {
    expect(parent({ z: 0, x: 1, y: 0 })).toBeNull();
    expect(parent({ z: 8, x: 253, y: 57 })).toEqual({ z: 7, x: 126, y: 28 });
    expect(children({ z: 0, x: 1, y: 0 })).toEqual([
      { z: 1, x: 2, y: 0 }, { z: 1, x: 3, y: 0 }, { z: 1, x: 2, y: 1 }, { z: 1, x: 3, y: 1 },
    ]);
    expect(tileKey({ z: 8, x: 253, y: 57 })).toBe("8/253/57");
  });

  it("sous-rectangle UV d'une feuille dans un ancêtre (v = 0 au sud)", () => {
    expect(subRect({ z: 0, x: 0, y: 0 }, { z: 0, x: 0, y: 0 })).toEqual({ offsetX: 0, offsetY: 0, scale: 1 });
    expect(subRect({ z: 1, x: 1, y: 1 }, { z: 0, x: 0, y: 0 })).toEqual({ offsetX: 0.5, offsetY: 0, scale: 0.5 });
    expect(subRect({ z: 1, x: 0, y: 0 }, { z: 0, x: 0, y: 0 })).toEqual({ offsetX: 0, offsetY: 0.5, scale: 0.5 });
    expect(subRect({ z: 2, x: 3, y: 1 }, { z: 0, x: 0, y: 0 })).toEqual({ offsetX: 0.75, offsetY: 0.5, scale: 0.25 });
    expect(() => subRect({ z: 1, x: 2, y: 0 }, { z: 0, x: 0, y: 0 })).toThrow();
  });
});
