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
  /** Clés primaires (nom affiché, asciiname, nom du socle) de ce préfixe. */
  keys: string[];
  /** Clés alternatives (alternatenames) de ce préfixe : classées après toutes les primaires. */
  altKeys: string[];
}

const isStrings = (a: unknown): a is string[] => Array.isArray(a) && a.every((k) => typeof k === "string");

export function parseSearchFile(json: unknown): Entry[] {
  if (typeof json !== "object" || json === null) throw new GeoDataError("search: expected an object");
  const doc = json as Record<string, unknown>;
  if (doc.version !== 2) throw new GeoDataError(`search: unknown version ${String(doc.version)}`);
  if (!Array.isArray(doc.entries)) throw new GeoDataError("search: expected an array");
  return doc.entries.map((e: unknown) => {
    if (!Array.isArray(e) || e.length !== 8) throw new GeoDataError("search: expected rows of 8 fields");
    const [name, region, country, lon, lat, pop, keys, altKeys] = e as unknown[];
    if (typeof name !== "string" || typeof region !== "string" || typeof country !== "string") throw new GeoDataError("search: invalid text field");
    if (typeof lon !== "number" || typeof lat !== "number" || typeof pop !== "number") throw new GeoDataError("search: invalid number field");
    if (!isStrings(keys) || !isStrings(altKeys)) throw new GeoDataError("search: invalid keys");
    return { result: { name, region, country, lon, lat, pop }, keys, altKeys };
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
    // Primaires d'abord (ordre du fichier = population décroissante), puis les entrées trouvées
    // seulement par une clé alternative : « paris of the north » ne passe pas devant Paris (Texas).
    const out: SearchResult[] = [];
    const alt: SearchResult[] = [];
    for (const e of await this.file(prefixOf(q))) {
      if (e.keys.some((k) => k.startsWith(q))) {
        out.push(e.result);
        if (out.length >= MAX_RESULTS) return out;
      } else if (alt.length < MAX_RESULTS && e.altKeys.some((k) => k.startsWith(q))) alt.push(e.result);
    }
    return out.concat(alt).slice(0, MAX_RESULTS);
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
