/**
 * Données des étiquettes (spec repères §2, §3) : parseurs stricts des fichiers `geo/` et
 * `LabelSet`, la liste unique parcourue par la sélection. Logique pure.
 */
import * as THREE from "three";
import { lonLatToVec3 } from "../tiles/patch";

export class GeoDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeoDataError";
  }
}

export interface Place { lon: number; lat: number; name: string; pop: number; capital: boolean }
export interface Country { lon: number; lat: number; name: string; rank: number }

export interface LabelItem {
  id: number;
  kind: "city" | "country";
  name: string;
  lon: number;
  lat: number;
  /** Villes seulement ; 0 pour un pays. */
  pop: number;
  capital: boolean;
  /** Pays seulement (LABELRANK Natural Earth, 1 = plus important) ; 0 pour une ville. */
  rank: number;
}

/** `items` : pays d'abord, puis villes, chacun dans l'ordre (de priorité) de son fichier. */
export interface LabelSet {
  items: LabelItem[];
  /** Vecteur unité de l'item `id` en `unit[3·id … 3·id+2]`. */
  unit: Float32Array;
}

function rows(json: unknown, key: string, width: number): unknown[][] {
  if (typeof json !== "object" || json === null) throw new GeoDataError(`${key} : objet attendu`);
  const doc = json as Record<string, unknown>;
  if (doc.version !== 1) throw new GeoDataError(`${key} : version ${String(doc.version)} inconnue`);
  const list = doc[key];
  if (!Array.isArray(list)) throw new GeoDataError(`${key} : tableau attendu`);
  for (const r of list) {
    if (!Array.isArray(r) || r.length !== width) throw new GeoDataError(`${key} : ligne de ${width} champs attendue`);
  }
  return list as unknown[][];
}

function lonLatName(r: unknown[], key: string): { lon: number; lat: number; name: string } {
  const [lon, lat, name] = r;
  if (typeof lon !== "number" || !Number.isFinite(lon) || Math.abs(lon) > 180) throw new GeoDataError(`${key} : longitude invalide`);
  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) throw new GeoDataError(`${key} : latitude invalide`);
  if (typeof name !== "string" || name === "") throw new GeoDataError(`${key} : nom invalide`);
  return { lon, lat, name };
}

export function parsePlaces(json: unknown): Place[] {
  return rows(json, "places", 5).map((r) => {
    const pop = r[3];
    if (typeof pop !== "number" || !Number.isFinite(pop)) throw new GeoDataError("places : population invalide");
    return { ...lonLatName(r, "places"), pop, capital: r[4] === 1 };
  });
}

export function parseCountries(json: unknown): Country[] {
  return rows(json, "countries", 4).map((r) => {
    const rank = r[3];
    if (typeof rank !== "number" || !Number.isFinite(rank)) throw new GeoDataError("countries : rang invalide");
    return { ...lonLatName(r, "countries"), rank };
  });
}

export function buildLabelSet(places: Place[], countries: Country[]): LabelSet {
  const items: LabelItem[] = [];
  for (const c of countries) items.push({ id: items.length, kind: "country", name: c.name, lon: c.lon, lat: c.lat, pop: 0, capital: false, rank: c.rank });
  for (const p of places) items.push({ id: items.length, kind: "city", name: p.name, lon: p.lon, lat: p.lat, pop: p.pop, capital: p.capital, rank: 0 });
  const unit = new Float32Array(items.length * 3);
  const v = new THREE.Vector3();
  for (const it of items) {
    lonLatToVec3(it.lon, it.lat, v);
    unit[it.id * 3] = v.x;
    unit[it.id * 3 + 1] = v.y;
    unit[it.id * 3 + 2] = v.z;
  }
  return { items, unit };
}
