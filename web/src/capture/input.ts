/**
 * Ce que capture la vue courante (spec capture §4.1, spec forêt §7) : couche météo affichée (légende,
 * run, instant du curseur), ou Forest (deux barres et crédit, instant présent), ou rien. Fonction
 * pure, testée hors navigateur (revue T6, Important 1) ; `main.ts` y ajoute étiquettes et épingle.
 */
import type { Forecast } from "../data/manifest";
import { STRINGS } from "../i18n";
import { layerDef, layerKind, type LayerDef } from "../layers/registry";
import { legendNote } from "../ui/format";
import type { CaptureLayer } from "./compose";
import { captureFileName, captureWhen } from "./naming";

export interface CaptureRequest {
  layer: CaptureLayer | null;
  forest: LayerDef | null;
  tMs: number;
  /** Texte de partage. */
  text: string;
  /** Nom du fichier PNG. */
  name: string;
}

export function captureRequest(o: {
  activeId: string | null;
  shownId: string | null;
  manifest: Forecast | null;
  cursorMs: number;
  nowMs: number;
}): CaptureRequest {
  const entry = o.shownId && o.manifest ? o.manifest.layers[o.shownId] : undefined;
  const def = o.shownId ? layerDef(o.shownId) : undefined;
  const layer = def && entry ? { def, enc: entry.encoding, model: entry.model, run: entry.run, note: legendNote(def, entry.run) } : null;
  // Forest (tuiles) : ses deux barres et son crédit, sans échéance ni run.
  const active = o.activeId ? layerDef(o.activeId) : undefined;
  const forest = !layer && active && layerKind(active) === "tiles" ? active : null;
  const tMs = layer ? o.cursorMs : o.nowMs;
  const text = layer
    ? `${layer.def.label} · ${captureWhen(tMs)} — ${STRINGS.capture.site}`
    : forest
      ? `${forest.label} — ${STRINGS.capture.site}`
      : `${STRINGS.capture.shareTitle} — ${STRINGS.capture.site}`;
  const name = captureFileName(layer ? layer.def.id : forest ? forest.id : null, tMs);
  return { layer, forest, tMs, text, name };
}
