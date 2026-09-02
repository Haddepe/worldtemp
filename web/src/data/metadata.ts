/**
 * Contrat `latest.json` — spec pipeline §4, schema_version 1.
 * Le front ne recopie aucune constante : `encoding` et `grid` viennent d'ici.
 */

export interface Encoding {
  bits: number;
  min_c: number;
  max_c: number;
}

export interface Grid {
  width: number;
  height: number;
  lon_min: number;
  lon_max: number;
  lat_min: number;
  lat_max: number;
  lon_step: number;
  lat_step: number;
}

export interface LatestMetadata {
  schema_version: 1;
  model: string;
  variable: string;
  run: string;
  forecast_hour: number;
  valid_time_utc: string;
  generated_at: string;
  encoding: Encoding;
  grid: Grid;
  texture: string;
  stats: { min_c: number; max_c: number };
}

export class MetadataError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`${field} : ${message}`);
    this.name = "MetadataError";
    this.field = field;
  }
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

type Rec = Record<string, unknown>;

function record(value: unknown, field: string): Rec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MetadataError(field, "objet attendu");
  }
  return value as Rec;
}

function num(o: Rec, field: string): number {
  const v = o[field.split(".").pop() as string];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new MetadataError(field, "nombre attendu");
  }
  return v;
}

function posInt(o: Rec, field: string): number {
  const v = num(o, field);
  if (!Number.isInteger(v) || v <= 0) {
    throw new MetadataError(field, "entier strictement positif attendu");
  }
  return v;
}

function str(o: Rec, field: string): string {
  const v = o[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new MetadataError(field, "chaîne non vide attendue");
  }
  return v;
}

function isoUtc(o: Rec, field: string): string {
  const v = str(o, field);
  if (!ISO_UTC.test(v) || Number.isNaN(Date.parse(v))) {
    throw new MetadataError(field, "date ISO 8601 UTC attendue (YYYY-MM-DDTHH:MM:SSZ)");
  }
  return v;
}

export function parseMetadata(raw: unknown): LatestMetadata {
  const o = record(raw, "latest.json");

  if (o.schema_version !== 1) {
    throw new MetadataError("schema_version", `version inconnue (${String(o.schema_version)}), 1 attendue`);
  }

  const enc = record(o.encoding, "encoding");
  const encoding: Encoding = {
    bits: num(enc, "encoding.bits"),
    min_c: num(enc, "encoding.min_c"),
    max_c: num(enc, "encoding.max_c"),
  };
  if (encoding.bits !== 8) {
    throw new MetadataError("encoding.bits", `8 attendu, reçu ${encoding.bits}`);
  }
  if (!(encoding.min_c < encoding.max_c)) {
    throw new MetadataError("encoding.min_c", "doit être < encoding.max_c");
  }

  const g = record(o.grid, "grid");
  const grid: Grid = {
    width: posInt(g, "grid.width"),
    height: posInt(g, "grid.height"),
    lon_min: num(g, "grid.lon_min"),
    lon_max: num(g, "grid.lon_max"),
    lat_min: num(g, "grid.lat_min"),
    lat_max: num(g, "grid.lat_max"),
    lon_step: num(g, "grid.lon_step"),
    lat_step: num(g, "grid.lat_step"),
  };

  const st = record(o.stats, "stats");

  return {
    schema_version: 1,
    model: str(o, "model"),
    variable: str(o, "variable"),
    run: isoUtc(o, "run"),
    forecast_hour: num(o, "forecast_hour"),
    valid_time_utc: isoUtc(o, "valid_time_utc"),
    generated_at: isoUtc(o, "generated_at"),
    encoding,
    grid,
    texture: str(o, "texture"),
    stats: { min_c: num(st, "stats.min_c"), max_c: num(st, "stats.max_c") },
  };
}
