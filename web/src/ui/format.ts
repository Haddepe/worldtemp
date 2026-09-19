import { encode, type Encoding } from "../data/encoding";
import type { LayerEntry } from "../data/manifest";
import type { LayerDef } from "../layers/registry";
import { STRINGS } from "../i18n";

function hhmm(isoUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(
    new Date(isoUtc),
  );
}

export function formatAgo(isoUtc: string, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(isoUtc)) / 60_000));
  if (minutes < 1) return STRINGS.banner.justNow;
  if (minutes < 60) return STRINGS.banner.minutesAgo(minutes);
  return STRINGS.banner.hoursAgo(Math.floor(minutes / 60), minutes % 60);
}

/** Libellés des modèles du manifeste (champ `model`) ; repli sur l'id. */
export const SOURCE_LABELS: Record<string, string> = STRINGS.sources;

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
  const local = validLocal === validUtc ? "" : ` (${validLocal} ${STRINGS.banner.local})`;
  return `${sourceLabel(entry.model)} · run ${run} UTC · ${STRINGS.banner.valid} ${validUtc} UTC${local} · ${formatAgo(entry.generated_at, nowMs)}`;
}

/** Libellé court d'une graduation : entier si entier, sinon une décimale. */
function tickLabel(v: number): string {
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace("-", "−");
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

/** Direction météo (d'où vient le vent), degrés dans [0, 360[ : (270 − atan2(v, u)) mod 360. */
export function windDirection(u: number, v: number): number {
  const d = 270 - (Math.atan2(v, u) * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

/** Point de rose le plus proche (16 points, 22,5° chacun, N centré sur 0°). */
export function compassPoint(deg: number): string {
  return STRINGS.wind.compass[Math.round(deg / 22.5) % 16]!;
}

/** Ligne vent du tooltip (spec vent §10) : « Wind 23 km/h NW », « Calm » sous 1 km/h. */
export function formatWind(u: number, v: number): string {
  const kmh = Math.round(3.6 * Math.hypot(u, v));
  if (kmh < 1) return STRINGS.wind.calm;
  return `${STRINGS.wind.label} ${kmh} km/h ${compassPoint(windDirection(u, v))}`;
}
