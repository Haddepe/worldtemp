import { describe, expect, it } from "vitest";
import { ManifestError, parseForestManifest, parseManifest } from "../src/tiles/manifest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

/** Champs écrits par tiler/encode.py `write_forest_manifest` (chiffres du jeu publié). */
const FOREST = {
  schema_version: 1,
  version: "v1.12",
  tile_size: 512,
  ext: "png",
  index: "index.bin",
  max_level: 8,
  max_level_outside: 7,
  tropics: { lon_min: -180, lon_max: 180, lat_min: -30.9375, lat_max: 30.9375 },
  tropics_requested: { lon_min: -180, lon_max: 180, lat_min: -30, lat_max: 30 },
  channels: { cover: 0, year: 1, share: 2 },
  year_base: 2000,
  threshold: 30,
  source: "Hansen/UMD/Google/USGS/NASA — Global Forest Change 2000–2024 (v1.12)",
  license: "CC BY 4.0",
  generated_at: "2026-10-31T20:00:00Z",
  lossyear_fallback: { "v1.11": ["00N_070E", "10S_180W"] },
};

/** Manifeste forêt publié sur R2 (copie de tests/tiler/fixtures/r2-forest-manifest.json). */
const R2_FOREST: unknown = JSON.parse(readFileSync(join(__dirname, "fixtures", "r2-forest-manifest.json"), "utf8"));

const DEEP = { base_url: "https://huggingface.co/datasets/o/r/resolve/0123abc/v1.12", max_level: 9, catalog: "catalog.json", format: "wtpk1" };

describe("parseForestManifest", () => {
  it("accepte le manifeste écrit par le tiler", () => {
    expect(parseForestManifest(FOREST)).toEqual({
      schemaVersion: 1,
      version: "v1.12",
      tileSize: 512,
      ext: "png",
      index: "index.bin",
      maxLevel: 8,
      maxLevelOutside: 7,
      tropics: { lonMin: -180, lonMax: 180, latMin: -30.9375, latMax: 30.9375 },
      tropicsRequested: { lonMin: -180, lonMax: 180, latMin: -30, latMax: 30 },
      channels: { cover: 0, year: 1, share: 2 },
      yearBase: 2000,
      threshold: 30,
      source: "Hansen/UMD/Google/USGS/NASA — Global Forest Change 2000–2024 (v1.12)",
      license: "CC BY 4.0",
      generatedAt: "2026-10-31T20:00:00Z",
      lossyearFallback: { "v1.11": ["00N_070E", "10S_180W"] },
      deep: null,
    });
    expect(parseForestManifest({ ...FOREST, lossyear_fallback: {} }).lossyearFallback).toEqual({});
  });

  it("manifeste R2 publié (sans `deep`) → deep nul", () => {
    expect(parseForestManifest(R2_FOREST).deep).toBeNull();
  });

  it("champ `deep` valide → champs (lot R5c)", () => {
    expect(parseForestManifest({ ...FOREST, deep: DEEP }).deep).toEqual({
      baseUrl: "https://huggingface.co/datasets/o/r/resolve/0123abc/v1.12", maxLevel: 9, catalog: "catalog.json", format: "wtpk1",
    });
  });

  it("champ `deep` incohérent → ManifestError", () => {
    const bad: Record<string, unknown>[] = [
      { ...DEEP, max_level: 8 }, // ≤ max_level R2
      { ...DEEP, max_level: 7 },
      { ...DEEP, format: "wtpk2" },
      { ...DEEP, base_url: "" },
      { ...DEEP, catalog: undefined },
    ];
    for (const d of bad) expect(() => parseForestManifest({ ...FOREST, deep: d }), JSON.stringify(d)).toThrow(ManifestError);
    expect(() => parseForestManifest({ ...FOREST, deep: "x" })).toThrow(ManifestError);
  });

  it("rejette un manifeste incohérent", () => {
    const bad: Record<string, unknown>[] = [
      { ...FOREST, schema_version: 2 },
      { ...FOREST, max_level_outside: 9 },                                   // > max_level
      { ...FOREST, max_level_outside: 0 },                                   // le tiler impose ≥ 1
      { ...FOREST, tropics: { ...FOREST.tropics, lat_min: 40 } },            // lat_min > lat_max
      { ...FOREST, tropics: { lon_min: -180, lon_max: 180, lat_min: -30 } }, // borne manquante
      { ...FOREST, channels: { cover: 0, year: 0, share: 2 } },              // canal en double
      { ...FOREST, channels: { cover: 0, year: 1, share: 3 } },              // hors RGB
      { ...FOREST, channels: { cover: 0, year: 1 } },
      { ...FOREST, threshold: 101 },
      { ...FOREST, source: "" },
      { ...FOREST, ext: undefined },
      { ...FOREST, lossyear_fallback: { "v1.11": [1] } },
    ];
    for (const b of bad) expect(() => parseForestManifest(b), JSON.stringify(b)).toThrow(ManifestError);
    expect(() => parseForestManifest([])).toThrow(ManifestError);
  });
});
