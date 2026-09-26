/**
 * Normalisation des noms de ville (spec lot F §3.5). MIROIR PYTHON : tools/geonames.py
 * (`normalize`, `prefix_of`) ; cas partagés : tests/fixtures/geo_normalize_cases.json.
 */

/** Lettres que la décomposition NFD ne ramène pas à l'ASCII : ß ø ł æ œ đ ı þ ð. */
const FOLD: Record<string, string> = {
  "\u00df": "ss", "\u00f8": "o", "\u0142": "l", "\u00e6": "ae", "\u0153": "oe",
  "\u0111": "d", "\u0131": "i", "\u00fe": "th", "\u00f0": "d",
};

export function normalizeName(s: string): string {
  const base = s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
  let out = "";
  for (const c of base) out += FOLD[c] ?? c;
  return out.replace(/[^a-z0-9]+/g, " ").trim();
}

/** Nom du fichier d'index : 2 premiers caractères de la clé normalisée, hors [a-z0-9] → `_`. */
export function prefixOf(key: string): string {
  let p = "";
  for (const c of key.slice(0, 2)) p += /[a-z0-9]/.test(c) ? c : "_";
  return p.padEnd(2, "_");
}
