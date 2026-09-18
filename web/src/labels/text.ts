/** Valeur affichée sous le nom d'une ville (spec repères §4) : même lecture que le tooltip, sur les pixels bruts. */
import { sampleValue } from "../data/sampling";
import type { TooltipData } from "../ui/tooltip";

/** `null` = nom seul : aucune couche lisible, valeur non finie, ou sous `tooltipMin` (« pas de pluie »). */
export function labelValue(data: TooltipData | null, lon: number, lat: number): string | null {
  if (!data) return null;
  const v = sampleValue(data.pixels, data.grid, data.encoding, lon, lat);
  if (!Number.isFinite(v)) return null;
  if (data.def.tooltipMin !== null && v < data.def.tooltipMin) return null;
  return data.def.format(v);
}
