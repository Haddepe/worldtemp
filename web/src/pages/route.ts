/** Routage pur des pages d'entrée (lot G, spec §5) : aucun accès au DOM. */
import { PAGES, type PageDef } from "./registry";

const HOME = PAGES[0]!; // l'accueil est toujours la première entrée

/** "/wind-map/" et "/wind-map" → page vent ; inconnu → accueil (sensible à la casse). */
export function pageForPath(pathname: string): PageDef {
  const slug = pathname.replace(/^\/+|\/+$/g, "");
  return PAGES.find((p) => p.slug === slug) ?? HOME;
}

/** Complète `search` avec les paramètres de la page absents ; ne remplace jamais un paramètre présent. */
export function pageDefaultsSearch(search: string, page: PageDef, reducedMotion: boolean): string {
  const params = new URLSearchParams(search);
  if (!params.has("layer")) params.set("layer", page.layer ?? "none");
  if (page.windForced && !reducedMotion && !params.has("wind")) params.set("wind", "1");
  // Une vue explicite est un tout : lon ou lat présent écarte toute la vue de la page.
  if (page.view && !params.has("lon") && !params.has("lat")) {
    params.set("lon", String(page.view.lon));
    params.set("lat", String(page.view.lat));
    params.set("d", String(page.view.d));
  }
  return "?" + params.toString();
}

/** Page cible après un changement de couche par l'utilisateur ; la page courante si elle ne change pas. */
export function pageAfterLayerChange(current: PageDef, layer: string | null, windOn: boolean): PageDef {
  if (layer === null) {
    const slug = windOn ? "wind-map" : "";
    return current.slug === slug ? current : PAGES.find((p) => p.slug === slug) ?? HOME;
  }
  if (current.layer === layer && current.kind !== "region") return current;
  return PAGES.find((p) => p.kind === "layer" && p.layer === layer) ?? current;
}

/** Query string à garder en changeant de page : retire layer, wind, lon, lat, d. "" si vide. */
export function searchForPageChange(search: string): string {
  const params = new URLSearchParams(search);
  for (const k of ["layer", "wind", "lon", "lat", "d"]) params.delete(k);
  const s = params.toString();
  return s ? "?" + s : "";
}
