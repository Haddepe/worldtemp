/**
 * Recherche de ville hors ligne (spec lot F §5.2) : index `geo/search/{pp}.json` découpé par les
 * deux premiers caractères normalisés ; chaque fichier est téléchargé une fois par session.
 */
import { GEO_VERSION } from "../geo/loader";
import { GeoDataError } from "../labels/data";
import { normalizeName, prefixOf } from "./normalize";

export const MIN_CHARS = 2;
export const MAX_RESULTS = 8;

export interface SearchResult {
  name: string;
  region: string;
  country: string;
  lon: number;
  lat: number;
  pop: number;
}

interface Entry {
  result: SearchResult;
  keys: string[];
}

export function parseSearchFile(json: unknown): Entry[] {
  if (typeof json !== "object" || json === null) throw new GeoDataError("search: expected an object");
  const doc = json as Record<string, unknown>;
  if (doc.version !== 1) throw new GeoDataError(`search: unknown version ${String(doc.version)}`);
  if (!Array.isArray(doc.entries)) throw new GeoDataError("search: expected an array");
  return doc.entries.map((e: unknown) => {
    if (!Array.isArray(e) || e.length !== 7) throw new GeoDataError("search: expected rows of 7 fields");
    const [name, region, country, lon, lat, pop, keys] = e as unknown[];
    if (typeof name !== "string" || typeof region !== "string" || typeof country !== "string") throw new GeoDataError("search: invalid text field");
    if (typeof lon !== "number" || typeof lat !== "number" || typeof pop !== "number") throw new GeoDataError("search: invalid number field");
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string")) throw new GeoDataError("search: invalid keys");
    return { result: { name, region, country, lon, lat, pop }, keys: keys as string[] };
  });
}

/** Épinal — Grand Est, France ; région ou pays vides omis. */
export function resultLabel(r: SearchResult): string {
  const where = [r.region, r.country].filter(Boolean).join(", ");
  return where ? `${r.name} — ${where}` : r.name;
}

export class CitySearch {
  private readonly files = new Map<string, Promise<Entry[]>>();

  /** `fetchJson` : `null` si 404 (aucune ville pour ce préfixe) ; rejette sur tout autre échec. */
  constructor(
    private readonly base: string,
    private readonly fetchJson: (url: string) => Promise<unknown | null>,
  ) {}

  async query(text: string): Promise<SearchResult[]> {
    const q = normalizeName(text);
    if (q.length < MIN_CHARS) return [];
    const out: SearchResult[] = [];
    for (const e of await this.file(prefixOf(q))) {
      if (!e.keys.some((k) => k.startsWith(q))) continue;
      out.push(e.result);
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }

  private file(prefix: string): Promise<Entry[]> {
    let p = this.files.get(prefix);
    if (!p) {
      p = this.fetchJson(`${this.base}/search/${prefix}.json?v=${GEO_VERSION}`).then((j) => (j === null ? [] : parseSearchFile(j)));
      this.files.set(prefix, p);
      // Un échec réseau n'est pas mémorisé : la frappe suivante retente.
      p.catch(() => {
        if (this.files.get(prefix) === p) this.files.delete(prefix);
      });
    }
    return p;
  }
}
