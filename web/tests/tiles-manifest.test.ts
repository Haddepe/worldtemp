import { describe, expect, it } from "vitest";
import { ManifestError, parseManifest } from "../src/tiles/manifest";

const SAMPLE = {
  schema_version: 1,
  version: "v1",
  tile_size: 512,
  sets: { sat: { ext: "jpg", max_level: 5 }, map: { ext: "png", max_level: 8, index: "index.bin" } },
  generated_at: "2026-09-06T14:00:00Z",
  sources: ["NASA BMNG"],
};

describe("parseManifest", () => {
  it("accepte l'exemple de la spec", () => {
    expect(parseManifest(SAMPLE)).toEqual({
      schemaVersion: 1,
      tileSize: 512,
      sat: { ext: "jpg", maxLevel: 5 },
      map: { ext: "png", maxLevel: 8, index: "index.bin" },
    });
  });

  it("rejette schema_version inconnu, tile_size non entier, jeu manquant", () => {
    expect(() => parseManifest({ ...SAMPLE, schema_version: 2 })).toThrow(ManifestError);
    expect(() => parseManifest({ ...SAMPLE, tile_size: "512" })).toThrow(ManifestError);
    expect(() => parseManifest({ ...SAMPLE, sets: { sat: SAMPLE.sets.sat } })).toThrow(/map/);
    expect(() => parseManifest(null)).toThrow(ManifestError);
    expect(() => parseManifest({ ...SAMPLE, sets: { ...SAMPLE.sets, map: { ext: "png", max_level: -1, index: "i" } } })).toThrow(/max_level/);
  });
});
