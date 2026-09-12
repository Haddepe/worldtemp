/** Logique pure du menu et de l'URL (spec couches §12) ; le DOM est dans ui/layers-menu.ts. */
import type { Manifest } from "../data/manifest";
import type { LayerDef } from "./registry";

export const DEFAULT_LAYER = "temp";
const PARAM = "layer";
const NONE = "none";

/** Couches affichables : ordre du registre, présentes dans le manifeste. */
export function orderedLayers(defs: readonly LayerDef[], manifest: Manifest): LayerDef[] {
  return defs.filter((d) => d.id in manifest.layers);
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
