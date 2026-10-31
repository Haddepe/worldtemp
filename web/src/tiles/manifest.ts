/** Contrat `manifest.json` (spec tuiles §2). Le client n'en suppose aucune valeur. */

export interface TileSet {
  ext: string;
  maxLevel: number;
}

export interface TilesManifest {
  schemaVersion: 1;
  tileSize: number;
  sat: TileSet;
  map: TileSet & { index: string };
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(`manifest.json: ${message}`);
    this.name = "ManifestError";
  }
}

type Rec = Record<string, unknown>;

function rec(v: unknown, what: string): Rec {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ManifestError(`${what}: expected an object`);
  return v as Rec;
}

function uint(o: Rec, field: string, what: string): number {
  const v = o[field];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new ManifestError(`${what}.${field}: expected an integer ≥ 0`);
  return v;
}

function str(o: Rec, field: string, what: string): string {
  const v = o[field];
  if (typeof v !== "string" || v === "") throw new ManifestError(`${what}.${field}: expected a string`);
  return v;
}

export function parseManifest(value: unknown): TilesManifest {
  const m = rec(value, "root");
  if (m.schema_version !== 1) throw new ManifestError("expected schema_version 1");
  const sets = rec(m.sets, "sets");
  const sat = rec(sets.sat, "sets.sat");
  const map = rec(sets.map, "sets.map");
  return {
    schemaVersion: 1,
    tileSize: uint(m, "tile_size", "root"),
    sat: { ext: str(sat, "ext", "sets.sat"), maxLevel: uint(sat, "max_level", "sets.sat") },
    map: { ext: str(map, "ext", "sets.map"), maxLevel: uint(map, "max_level", "sets.map"), index: str(map, "index", "sets.map") },
  };
}

/** Bornes en degrés (lon, lat), comme `Bounds` de tiles/grid. */
export interface LonLatBox {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

/** Position des grandeurs dans les canaux R, G, B des tuiles forêt (0, 1, 2). */
export interface ForestChannels {
  cover: number;
  year: number;
  share: number;
}

/**
 * Manifeste du jeu `forest` (spec forêt §6), écrit par tiler/encode.py `write_forest_manifest`.
 * `maxLevel` n'existe que dans `tropics` (bande alignée sur la grille de `maxLevelOutside`) ;
 * ailleurs la pyramide s'arrête à `maxLevelOutside`. `index.bin` fait foi tuile par tuile.
 */
export interface ForestManifest {
  schemaVersion: 1;
  version: string;
  tileSize: number;
  ext: string;
  index: string;
  maxLevel: number;
  maxLevelOutside: number;
  tropics: LonLatBox;
  tropicsRequested: LonLatBox;
  channels: ForestChannels;
  /** Année = yearBase + octet (1..24 → 2001..2024). */
  yearBase: number;
  /** Seuil de canopée (%) déjà appliqué par le tiler. */
  threshold: number;
  source: string;
  license: string;
  generatedAt: string;
  /** Version de repli → dalles dont l'année de perte vient de cette version. */
  lossyearFallback: Record<string, string[]>;
}

function box(o: Rec, field: string): LonLatBox {
  const b = rec(o[field], field);
  const num = (k: string): number => {
    const v = b[k];
    if (typeof v !== "number" || !Number.isFinite(v)) throw new ManifestError(`${field}.${k}: expected a number`);
    return v;
  };
  const r = { lonMin: num("lon_min"), lonMax: num("lon_max"), latMin: num("lat_min"), latMax: num("lat_max") };
  if (!(r.lonMin < r.lonMax && r.latMin < r.latMax)) throw new ManifestError(`${field}: empty box`);
  return r;
}

function channels(o: Rec): ForestChannels {
  const c = rec(o.channels, "channels");
  const ch = { cover: uint(c, "cover", "channels"), year: uint(c, "year", "channels"), share: uint(c, "share", "channels") };
  const all = [ch.cover, ch.year, ch.share];
  if (all.some((v) => v > 2) || new Set(all).size !== 3) throw new ManifestError("channels: expected a permutation of 0, 1, 2");
  return ch;
}

function fallbacks(o: Rec): Record<string, string[]> {
  const f = rec(o.lossyear_fallback, "lossyear_fallback");
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(f)) {
    if (!Array.isArray(v) || v.some((n) => typeof n !== "string")) throw new ManifestError(`lossyear_fallback.${k}: expected strings`);
    out[k] = [...(v as string[])];
  }
  return out;
}

export function parseForestManifest(value: unknown): ForestManifest {
  const m = rec(value, "root");
  if (m.schema_version !== 1) throw new ManifestError("expected schema_version 1");
  const maxLevel = uint(m, "max_level", "root");
  const maxLevelOutside = uint(m, "max_level_outside", "root");
  if (maxLevelOutside < 1 || maxLevelOutside > maxLevel) throw new ManifestError("root.max_level_outside: expected 1 ≤ max_level_outside ≤ max_level");
  const threshold = uint(m, "threshold", "root");
  if (threshold > 100) throw new ManifestError("root.threshold: expected a percentage");
  return {
    schemaVersion: 1,
    version: str(m, "version", "root"),
    tileSize: uint(m, "tile_size", "root"),
    ext: str(m, "ext", "root"),
    index: str(m, "index", "root"),
    maxLevel,
    maxLevelOutside,
    tropics: box(m, "tropics"),
    tropicsRequested: box(m, "tropics_requested"),
    channels: channels(m),
    yearBase: uint(m, "year_base", "root"),
    threshold,
    source: str(m, "source", "root"),
    license: str(m, "license", "root"),
    generatedAt: str(m, "generated_at", "root"),
    lossyearFallback: fallbacks(m),
  };
}
