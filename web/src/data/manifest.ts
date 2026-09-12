/**
 * Contrat `layers/latest.json` — spec couches §7, schema_version 2.
 * Le front ne recopie aucune constante : `encoding` et `grid` viennent d'ici.
 */
import type { Encoding } from "./encoding";

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

export interface LayerEntry {
  model: string;
  variable: string;
  unit: string;
  run: string;
  forecast_hour: number;
  valid_time_utc: string;
  generated_at: string;
  texture: string;
  encoding: Encoding;
  stats: { min: number; max: number };
}

export interface Manifest {
  schema_version: 2;
  generated_at: string;
  grid: Grid;
  layers: Record<string, LayerEntry>;
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

function num(o: Rec, key: string, field: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new MetadataError(field, "nombre attendu");
  return v;
}

function posInt(o: Rec, key: string, field: string): number {
  const v = num(o, key, field);
  if (!Number.isInteger(v) || v <= 0) throw new MetadataError(field, "entier strictement positif attendu");
  return v;
}

function str(o: Rec, key: string, field: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) throw new MetadataError(field, "chaîne non vide attendue");
  return v;
}

function isoUtc(o: Rec, key: string, field: string): string {
  const v = str(o, key, field);
  if (!ISO_UTC.test(v) || Number.isNaN(Date.parse(v))) {
    throw new MetadataError(field, "date ISO 8601 UTC attendue (YYYY-MM-DDTHH:MM:SSZ)");
  }
  return v;
}

function parseEncoding(raw: unknown, field: string): Encoding {
  const e = record(raw, field);
  const bits = num(e, "bits", `${field}.bits`);
  if (bits !== 8) throw new MetadataError(`${field}.bits`, `8 attendu, reçu ${bits}`);
  const min = num(e, "min", `${field}.min`);
  const max = num(e, "max", `${field}.max`);
  if (!(min < max)) throw new MetadataError(`${field}.min`, "doit être < max");
  const scale = e.scale;
  if (scale !== "linear" && scale !== "sqrt") throw new MetadataError(`${field}.scale`, "« linear » ou « sqrt » attendu");
  return { bits, min, max, scale };
}

function parseEntry(raw: unknown, field: string): LayerEntry {
  const o = record(raw, field);
  const st = record(o.stats, `${field}.stats`);
  return {
    model: str(o, "model", `${field}.model`),
    variable: str(o, "variable", `${field}.variable`),
    unit: str(o, "unit", `${field}.unit`),
    run: isoUtc(o, "run", `${field}.run`),
    forecast_hour: num(o, "forecast_hour", `${field}.forecast_hour`),
    valid_time_utc: isoUtc(o, "valid_time_utc", `${field}.valid_time_utc`),
    generated_at: isoUtc(o, "generated_at", `${field}.generated_at`),
    texture: str(o, "texture", `${field}.texture`),
    encoding: parseEncoding(o.encoding, `${field}.encoding`),
    stats: { min: num(st, "min", `${field}.stats.min`), max: num(st, "max", `${field}.stats.max`) },
  };
}

export function parseManifest(raw: unknown): Manifest {
  const o = record(raw, "latest.json");
  if (o.schema_version !== 2) {
    throw new MetadataError("schema_version", `version inconnue (${String(o.schema_version)}), 2 attendue`);
  }
  const g = record(o.grid, "grid");
  const grid: Grid = {
    width: posInt(g, "width", "grid.width"),
    height: posInt(g, "height", "grid.height"),
    lon_min: num(g, "lon_min", "grid.lon_min"),
    lon_max: num(g, "lon_max", "grid.lon_max"),
    lat_min: num(g, "lat_min", "grid.lat_min"),
    lat_max: num(g, "lat_max", "grid.lat_max"),
    lon_step: num(g, "lon_step", "grid.lon_step"),
    lat_step: num(g, "lat_step", "grid.lat_step"),
  };
  const rawLayers = record(o.layers, "layers");
  const layers: Record<string, LayerEntry> = {};
  for (const id of Object.keys(rawLayers)) layers[id] = parseEntry(rawLayers[id], `layers.${id}`);
  if (Object.keys(layers).length === 0) throw new MetadataError("layers", "aucune couche");
  return { schema_version: 2, generated_at: isoUtc(o, "generated_at", "generated_at"), grid, layers };
}
