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

/** Réécrit `lon`, `lat`, `d` (vue partageable après un vol, spec lot F §5.3). Résultat préfixé par `?`. */
export function withView(search: string, lon: number, lat: number, d: number): string {
  const p = new URLSearchParams(search);
  p.set("lon", lon.toFixed(2));
  p.set("lat", lat.toFixed(2));
  p.set("d", d.toFixed(3));
  return `?${p.toString()}`;
}

/** Retire `lon`, `lat`, `d` (après « ma position », spec capture §4.3). Toujours préfixé par `?` :
 * `history.replaceState(…, "")` garderait l'URL courante au lieu de la vider. */
export function withoutView(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("lon");
  p.delete("lat");
  p.delete("d");
  return `?${p.toString()}`;
}
