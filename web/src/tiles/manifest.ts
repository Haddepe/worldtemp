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
    super(`manifest.json : ${message}`);
    this.name = "ManifestError";
  }
}

type Rec = Record<string, unknown>;

function rec(v: unknown, what: string): Rec {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ManifestError(`${what} : objet attendu`);
  return v as Rec;
}

function uint(o: Rec, field: string, what: string): number {
  const v = o[field];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new ManifestError(`${what}.${field} : entier ≥ 0 attendu`);
  return v;
}

function str(o: Rec, field: string, what: string): string {
  const v = o[field];
  if (typeof v !== "string" || v === "") throw new ManifestError(`${what}.${field} : chaîne attendue`);
  return v;
}

export function parseManifest(value: unknown): TilesManifest {
  const m = rec(value, "racine");
  if (m.schema_version !== 1) throw new ManifestError("schema_version 1 attendu");
  const sets = rec(m.sets, "sets");
  const sat = rec(sets.sat, "sets.sat");
  const map = rec(sets.map, "sets.map");
  return {
    schemaVersion: 1,
    tileSize: uint(m, "tile_size", "racine"),
    sat: { ext: str(sat, "ext", "sets.sat"), maxLevel: uint(sat, "max_level", "sets.sat") },
    map: { ext: str(map, "ext", "sets.map"), maxLevel: uint(map, "max_level", "sets.map"), index: str(map, "index", "sets.map") },
  };
}
