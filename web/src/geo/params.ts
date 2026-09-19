/** Paramètres d'URL booléens des repères (`?labels=0|1`, `?rivers=0|1`, spec repères §6). */
export function parseFlag(search: string, name: string, fallback = true): boolean {
  const raw = new URLSearchParams(search).get(name);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

/** Réécrit seulement `name` dans la query string. Résultat préfixé par `?`. */
export function withFlag(search: string, name: string, on: boolean): string {
  const p = new URLSearchParams(search);
  p.set(name, on ? "1" : "0");
  return `?${p.toString()}`;
}
