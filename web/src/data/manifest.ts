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
    super(`${field}: ${message}`);
    this.name = "MetadataError";
    this.field = field;
  }
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

type Rec = Record<string, unknown>;

function record(value: unknown, field: string): Rec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MetadataError(field, "expected an object");
  }
  return value as Rec;
}

function num(o: Rec, key: string, field: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new MetadataError(field, "expected a number");
  return v;
}

function posInt(o: Rec, key: string, field: string): number {
  const v = num(o, key, field);
  if (!Number.isInteger(v) || v <= 0) throw new MetadataError(field, "expected a strictly positive integer");
  return v;
}

function str(o: Rec, key: string, field: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) throw new MetadataError(field, "expected a non-empty string");
  return v;
}

function isoUtc(o: Rec, key: string, field: string): string {
  const v = str(o, key, field);
  if (!ISO_UTC.test(v) || Number.isNaN(Date.parse(v))) {
    throw new MetadataError(field, "expected an ISO 8601 UTC date (YYYY-MM-DDTHH:MM:SSZ)");
  }
  return v;
}

function parseGrid(raw: unknown): Grid {
  const g = record(raw, "grid");
  return {
    width: posInt(g, "width", "grid.width"),
    height: posInt(g, "height", "grid.height"),
    lon_min: num(g, "lon_min", "grid.lon_min"),
    lon_max: num(g, "lon_max", "grid.lon_max"),
    lat_min: num(g, "lat_min", "grid.lat_min"),
    lat_max: num(g, "lat_max", "grid.lat_max"),
    lon_step: num(g, "lon_step", "grid.lon_step"),
    lat_step: num(g, "lat_step", "grid.lat_step"),
  };
}

function parseEncoding(raw: unknown, field: string): Encoding {
  const e = record(raw, field);
  const bits = num(e, "bits", `${field}.bits`);
  if (bits !== 8) throw new MetadataError(`${field}.bits`, `expected 8, got ${bits}`);
  const min = num(e, "min", `${field}.min`);
  const max = num(e, "max", `${field}.max`);
  if (!(min < max)) throw new MetadataError(`${field}.min`, "must be < max");
  const scale = e.scale;
  if (scale !== "linear" && scale !== "sqrt") throw new MetadataError(`${field}.scale`, 'expected "linear" or "sqrt"');
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
    throw new MetadataError("schema_version", `unknown version (${String(o.schema_version)}), expected 2`);
  }
  const grid = parseGrid(o.grid);
  const rawLayers = record(o.layers, "layers");
  const layers: Record<string, LayerEntry> = {};
  for (const id of Object.keys(rawLayers)) layers[id] = parseEntry(rawLayers[id], `layers.${id}`);
  if (Object.keys(layers).length === 0) throw new MetadataError("layers", "no layer");
  return { schema_version: 2, generated_at: isoUtc(o, "generated_at", "generated_at"), grid, layers };
}

/** Une échéance de la frise (spec lot E §4.2). */
export interface Frame {
  forecast_hour: number;
  valid_time_utc: string;
  /** `Date.parse(valid_time_utc)`, calculé une fois au parsing : lu à chaque image pendant la lecture. */
  valid_ms: number;
  /** Chemin relatif à `layers/` : `<run>/<couche>_f<fh>.png`, immuable. */
  texture: string;
  stats: { min: number; max: number };
}

/** Couche du manifeste v3 : l'encodage est fixe pour toute la frise (condition du fondu). */
export interface ForecastEntry {
  model: string;
  variable: string;
  unit: string;
  run: string;
  generated_at: string;
  encoding: Encoding;
  /** Triées par échéance croissante, pas constant. */
  frames: Frame[];
}

/** Contrat `layers/forecast.json` — spec lot E §4.2, schema_version 3. */
export interface Forecast {
  schema_version: 3;
  generated_at: string;
  grid: Grid;
  layers: Record<string, ForecastEntry>;
}

const HOUR_MS = 3_600_000;
/** `<run>/<nom>.png`, sans `..`, sans schéma ni chemin absolu : l'URL est construite sous `layers/`. */
const TEXTURE_PATH = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.png$/;

function parseFrame(raw: unknown, field: string, runMs: number): Frame {
  const o = record(raw, field);
  const fh = posInt(o, "forecast_hour", `${field}.forecast_hour`);
  const valid = isoUtc(o, "valid_time_utc", `${field}.valid_time_utc`);
  const validMs = Date.parse(valid);
  if (validMs !== runMs + fh * HOUR_MS) throw new MetadataError(`${field}.valid_time_utc`, "expected run + forecast_hour");
  const texture = str(o, "texture", `${field}.texture`);
  if (!TEXTURE_PATH.test(texture)) throw new MetadataError(`${field}.texture`, "expected a relative path <run>/<name>.png");
  const st = record(o.stats, `${field}.stats`);
  return {
    forecast_hour: fh,
    valid_time_utc: valid,
    valid_ms: validMs,
    texture,
    stats: { min: num(st, "min", `${field}.stats.min`), max: num(st, "max", `${field}.stats.max`) },
  };
}

function parseForecastEntry(raw: unknown, field: string): ForecastEntry {
  const o = record(raw, field);
  const run = isoUtc(o, "run", `${field}.run`);
  const runMs = Date.parse(run);
  if (!Array.isArray(o.frames) || o.frames.length === 0) throw new MetadataError(`${field}.frames`, "expected a non-empty array");
  const frames = o.frames.map((f: unknown, i: number) => parseFrame(f, `${field}.frames[${i}]`, runMs));
  const step = frames.length > 1 ? frames[1]!.forecast_hour - frames[0]!.forecast_hour : 1;
  for (let i = 1; i < frames.length; i++) {
    if (step <= 0 || frames[i]!.forecast_hour - frames[i - 1]!.forecast_hour !== step) {
      throw new MetadataError(`${field}.frames`, "expected increasing forecast hours at a constant step");
    }
  }
  return {
    model: str(o, "model", `${field}.model`),
    variable: str(o, "variable", `${field}.variable`),
    unit: str(o, "unit", `${field}.unit`),
    run,
    generated_at: isoUtc(o, "generated_at", `${field}.generated_at`),
    encoding: parseEncoding(o.encoding, `${field}.encoding`),
    frames,
  };
}

export function parseForecast(raw: unknown): Forecast {
  const o = record(raw, "forecast.json");
  if (o.schema_version !== 3) {
    throw new MetadataError("schema_version", `unknown version (${String(o.schema_version)}), expected 3`);
  }
  const grid = parseGrid(o.grid);
  const rawLayers = record(o.layers, "layers");
  const layers: Record<string, ForecastEntry> = {};
  for (const id of Object.keys(rawLayers)) layers[id] = parseForecastEntry(rawLayers[id], `layers.${id}`);
  if (Object.keys(layers).length === 0) throw new MetadataError("layers", "no layer");
  return { schema_version: 3, generated_at: isoUtc(o, "generated_at", "generated_at"), grid, layers };
}
