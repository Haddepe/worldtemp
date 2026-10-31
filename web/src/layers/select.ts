/** Logique pure du menu et de l'URL (spec couches §12) ; le DOM est dans ui/layers-menu.ts. */
import type { Forecast } from "../data/manifest";
import { type LayerDef, layerKind } from "./registry";

export const DEFAULT_LAYER = "temp";
const PARAM = "layer";
const NONE = "none";

/** Couches affichables, ordre du registre : les grilles présentes dans le manifeste, les couches
 * tuiles dont le jeu est chargé (`tiles`, ex. `["forest"]` une fois le manifeste forêt lu) —
 * indépendamment de `layers/forecast.json`. */
export function orderedLayers(defs: readonly LayerDef[], manifest: Pick<Forecast, "layers">, tiles: readonly string[] = []): LayerDef[] {
  return defs.filter((d) => (layerKind(d) === "tiles" ? tiles.includes(d.id) : d.id in manifest.layers));
}

/** `?layer=` → id de couche, `null` pour « Aucune ». Inconnu ou absent : `temp`, sinon la première disponible. */
export function parseLayerParam(search: string, available: readonly string[]): string | null {
  const raw = new URLSearchParams(search).get(PARAM);
  if (raw === NONE) return null;
  if (raw !== null && available.includes(raw)) return raw;
  if (available.includes(DEFAULT_LAYER)) return DEFAULT_LAYER;
  return available[0] ?? null;
}

/** Réécrit seulement `layer` dans la query string ; `null` → `none`. Résultat préfixé par `?`. */
export function withLayerParam(search: string, id: string | null): string {
  const p = new URLSearchParams(search);
  p.set(PARAM, id ?? NONE);
  return `?${p.toString()}`;
}

/** Entrées du menu : les couches de base, sans leurs modes (neige : « Snow » seule, l'épaisseur est un mode). */
export function menuLayers(defs: readonly LayerDef[]): LayerDef[] {
  return defs.filter((d) => d.modeOf === undefined);
}

/** Entrée du menu qui porte la couche affichée : la base d'un mode, sinon elle-même ; `null` si aucune. */
export function menuKey(id: string | null, defs: readonly LayerDef[]): string | null {
  if (id === null) return null;
  return defs.find((d) => d.id === id)?.modeOf ?? id;
}

/** La base puis ses modes, dans l'ordre du registre ; `[]` pour une couche sans mode. */
export function layerModes(id: string, defs: readonly LayerDef[]): LayerDef[] {
  const base = defs.find((d) => d.id === id)?.modeOf ?? id;
  const modes = defs.filter((d) => d.modeOf === base);
  if (modes.length === 0) return [];
  const root = defs.find((d) => d.id === base);
  return root ? [root, ...modes] : [];
}

/** Couche à afficher quand on choisit une entrée du menu : la base si disponible, sinon le premier mode disponible. */
export function menuTarget(baseId: string, available: readonly string[], defs: readonly LayerDef[]): string | null {
  if (available.includes(baseId)) return baseId;
  return defs.find((d) => d.modeOf === baseId && available.includes(d.id))?.id ?? null;
}

/** Modes proposés par le sélecteur pour la couche affichée : ceux de `layerModes` qui sont
 * disponibles ; moins de deux → `[]` (rien à choisir, sélecteur masqué). */
export function availableModes(id: string | null, available: readonly string[], defs: readonly LayerDef[]): LayerDef[] {
  if (id === null) return [];
  const modes = layerModes(id, defs).filter((d) => available.includes(d.id));
  return modes.length >= 2 ? modes : [];
}

/** Entrées du menu (ordre du registre) : chaque base dont la base ou un mode est au manifeste —
 * « Snow » reste joignable quand seul `snow_depth` est publié. */
export function menuEntries(defs: readonly LayerDef[], manifest: Pick<Forecast, "layers">, tiles: readonly string[] = []): LayerDef[] {
  const ids = orderedLayers(defs, manifest, tiles).map((d) => d.id);
  return menuLayers(defs).filter((d) => menuTarget(d.id, ids, defs) !== null);
}

/** Couche de repli après l'échec de `id` (`available` exclut déjà les couches en échec) : le mode
 * voisin disponible (Snowfall en échec → Depth), sinon la couche précédente si disponible, sinon aucune. */
export function failureFallback(id: string, previous: string | null, available: readonly string[], defs: readonly LayerDef[]): string | null {
  const sibling = menuTarget(menuKey(id, defs)!, available, defs);
  if (sibling !== null && sibling !== id) return sibling;
  return previous !== null && previous !== id && available.includes(previous) ? previous : null;
}
