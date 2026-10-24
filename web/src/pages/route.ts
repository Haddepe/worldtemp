/** Routage pur des pages d'entrée (lot G, spec §5) : aucun accès au DOM. */
import { withView, withoutView } from "../geo/params";
import { PAGES, type PageDef, type PageView } from "./registry";

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
  // Vent : allumé sur les pages qui le forcent, éteint sur les autres pages d'entrée (il couvrait la
  // couche) ; l'accueil garde le défaut du site (tier, reduced-motion).
  if (!params.has("wind")) {
    if (page.windForced) { if (!reducedMotion) params.set("wind", "1"); }
    else if (page.kind !== "home") params.set("wind", "0");
  }
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

/** Query string à garder en changeant de page : retire layer et wind ; la vue est l'affaire de
 * `searchWithShownView`. "" si vide. */
export function searchForPageChange(search: string): string {
  const params = new URLSearchParams(search);
  for (const k of ["layer", "wind"]) params.delete(k);
  const s = params.toString();
  return s ? "?" + s : "";
}

/**
 * Query string fidèle à l'état après une bascule de page sans rechargement (une adresse par
 * combinaison couche/vent) : `layer` n'y figure que s'il diffère de la couche de `next` ; `wind`
 * est gardé s'il était explicite (lien portable d'un appareil à l'autre), ajouté s'il diffère du
 * défaut de `next` sur cet appareil, retiré si le chemin l'exprime déjà (page à vent forcé, vent
 * allumé). La vue et les autres paramètres sont gardés. "" si vide.
 */
export function searchForPageState(search: string, next: PageDef, layer: string | null, windOn: boolean, windDefault: boolean): string {
  const params = new URLSearchParams(search);
  if (layer === next.layer) params.delete("layer");
  else params.set("layer", layer ?? "none");
  if (next.windForced && windOn === windDefault) params.delete("wind");
  else if (params.has("wind") || windOn !== windDefault) params.set("wind", windOn ? "1" : "0");
  const s = params.toString();
  return s ? "?" + s : "";
}

/**
 * Vue de l'adresse en passant de `current` à `next` sans recharger (revue finale I1). Une page à vue
 * (région) la retire : son vol l'écrira à l'arrivée. Sur une page sans vue la caméra ne bouge pas,
 * l'adresse doit donc décrire l'écran : la vue de `search` est gardée (déjà écrite sous la garde
 * « ma position ») ; sans vue dans `search`, la caméra est sur la vue par défaut, sauf si `current`
 * a une vue (région non touchée) — on écrit alors `shown()`, la vue affichée, ou rien si elle
 * renvoie null (garde « ma position », vol en cours). Les autres paramètres sont gardés. "" si vide.
 */
export function searchWithShownView(search: string, current: PageDef, next: PageDef, shown: () => PageView | null): string {
  let s = search;
  if (next.view !== null) s = withoutView(search);
  else if (!new URLSearchParams(search).has("lon") && current.view !== null) {
    const v = shown();
    if (v) s = withView(search, v.lon, v.lat, v.d);
  }
  return s === "?" ? "" : s;
}
