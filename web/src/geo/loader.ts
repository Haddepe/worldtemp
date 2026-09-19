/**
 * Chargement des fichiers statiques `geo/` (spec repères §6, §7) : une fois par session, hors
 * du chemin de démarrage. Les accès réseau sont injectés.
 */
import { buildLabelSet, parseCountries, parsePlaces, type Country, type LabelSet, type Place } from "../labels/data";
import { parseRivers, type RiverSegments } from "../rivers/data";

/**
 * Version des fichiers `geo/`, ajoutée à leurs URL : ils sont servis avec un cache d'un jour, et
 * sans elle un visiteur déjà venu garde l'ancienne copie 24 h après un déploiement (noms restés
 * en français après le passage du site à l'anglais, 2026-09-19). Empreinte FNV-1a des trois
 * fichiers : `geo-loader.test.ts` échoue, en donnant la bonne valeur, dès que les données changent.
 */
export const GEO_VERSION = "6977d45f";

/** Mémorise la promesse, succès comme échec : pas de second téléchargement dans la session. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => (promise ??= load());
}

/** Villes et pays ; un seul des deux en échec n'empêche pas l'autre (spec §7). Rejette si les deux échouent. */
export async function loadLabelSet(base: string, fetchJson: (url: string) => Promise<unknown>): Promise<LabelSet> {
  const [places, countries] = await Promise.allSettled([
    fetchJson(`${base}/places.json?v=${GEO_VERSION}`).then(parsePlaces),
    fetchJson(`${base}/countries.json?v=${GEO_VERSION}`).then(parseCountries),
  ]);
  if (places.status === "rejected") console.warn("[worldtemp] cities unavailable:", places.reason);
  if (countries.status === "rejected") console.warn("[worldtemp] countries unavailable:", countries.reason);
  if (places.status === "rejected" && countries.status === "rejected") throw new Error("labels unavailable");
  const p: Place[] = places.status === "fulfilled" ? places.value : [];
  const c: Country[] = countries.status === "fulfilled" ? countries.value : [];
  return buildLabelSet(p, c);
}

export async function loadRivers(base: string, fetchBuffer: (url: string) => Promise<ArrayBuffer>): Promise<RiverSegments> {
  return parseRivers(await fetchBuffer(`${base}/rivers.bin?v=${GEO_VERSION}`));
}
