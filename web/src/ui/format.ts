import { encode, type Encoding } from "../data/encoding";
import type { LayerEntry } from "../data/manifest";
import type { LayerDef } from "../layers/registry";

function hhmm(isoUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(
    new Date(isoUtc),
  );
}

export function formatAgo(isoUtc: string, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(isoUtc)) / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `il y a ${h} h ${String(m).padStart(2, "0")}`;
}

/** Libellés des modèles du manifeste (champ `model`) ; repli sur l'id. */
export const SOURCE_LABELS: Record<string, string> = {
  gfs_0p25: "NOAA GFS 0,25°",
  gefs_chem_0p25: "NOAA GEFS-Aerosols 0,25°",
};

export function sourceLabel(model: string): string {
  return SOURCE_LABELS[model] ?? model;
}

/** Bandeau (spec couches §11) : source de la couche active, son run, sa validité, sa fraîcheur. */
export function formatBanner(
  entry: LayerEntry,
  nowMs: number,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const run = hhmm(entry.run, "UTC");
  const validUtc = hhmm(entry.valid_time_utc, "UTC");
  const validLocal = hhmm(entry.valid_time_utc, timeZone);
  const local = validLocal === validUtc ? "" : ` (${validLocal} locale)`;
  return `${sourceLabel(entry.model)} · run ${run} UTC · valide ${validUtc} UTC${local} · ${formatAgo(entry.generated_at, nowMs)}`;
}

/** Libellé court d'une graduation : entier si entier, sinon une décimale avec virgule. */
function tickLabel(v: number): string {
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace("-", "−").replace(".", ",");
}

/** Graduations de la légende : valeurs du registre, positions encode(v)/255 (spec couches §11). */
export function legendTicks(def: LayerDef, enc: Encoding): { v: number; label: string; pct: number }[] {
  return def.ticks.map((v) => ({ v, label: tickLabel(v), pct: (encode(v, enc) / 255) * 100 }));
}

/** Texte du tooltip : « — » sous le seuil de la couche, sinon son format. */
export function formatReading(def: LayerDef, v: number): string {
  if (def.tooltipMin !== null && v < def.tooltipMin) return "—";
  return def.format(v);
}
