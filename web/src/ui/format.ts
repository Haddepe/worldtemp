import { encode, type Encoding } from "../data/encoding";
import type { LayerDef } from "../layers/registry";
import { STRINGS } from "../i18n";
import { HOUR_MS } from "../time/timeline";

/** Formateurs mis en cache par fuseau (revue T12 round 1, finding 4) : `formatBanner`/`formatWhen`
 * sont appelés à chaque image pendant la lecture, et construire un `Intl.DateTimeFormat` par appel
 * est coûteux. Un `Map` par format (leurs options diffèrent) suffit, le nombre de fuseaux vus est
 * minuscule (celui du navigateur, éventuellement « UTC » pour le run). */
const hhmmFormatters = new Map<string, Intl.DateTimeFormat>();

function hhmmFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = hhmmFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
    hhmmFormatters.set(timeZone, f);
  }
  return f;
}

function hhmm(isoUtc: string, timeZone: string): string {
  return hhmmFormatter(timeZone).format(new Date(isoUtc));
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

/** Bandeau (spec lot E §7.1) : source de la couche affichée, son run et la fraîcheur de sa frise ; l'instant choisi est dans la frise. */
export function formatBanner(entry: { model: string; run: string; generated_at: string }, nowMs: number): string {
  return `${sourceLabel(entry.model)} · run ${hhmm(entry.run, "UTC")} UTC · ${STRINGS.banner.updated} ${formatAgo(entry.generated_at, nowMs)}`;
}

const whenFormatters = new Map<string, Intl.DateTimeFormat>();

function whenFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = whenFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone,
    });
    whenFormatters.set(timeZone, f);
  }
  return f;
}

/** Instant de la frise, heure locale du navigateur : « Sat 12 17:00 ». */
export function formatWhen(t: number, timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const parts = whenFormatter(timeZone).formatToParts(new Date(t));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("hour")}:${get("minute")}`;
}

/** Écart à maintenant en heures arrondies : « +3 h », « −2 h », « now » à moins d'une demi-heure. */
export function formatOffset(t: number, nowMs: number): string {
  const h = Math.round((t - nowMs) / HOUR_MS);
  if (h === 0) return STRINGS.timeline.nowShort;
  return h > 0 ? `+${h} h` : `−${-h} h`;
}

/** Libellé de la frise : « Now · Sat 12 16:40 » en live, « Sat 12 18:00 (+3 h) » sinon. */
export function timelineLabel(t: number, nowMs: number, live: boolean, timeZone?: string): string {
  return live ? `${STRINGS.timeline.now} · ${formatWhen(t, timeZone)}` : `${formatWhen(t, timeZone)} (${formatOffset(t, nowMs)})`;
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
