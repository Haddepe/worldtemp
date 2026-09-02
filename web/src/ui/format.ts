import type { LatestMetadata } from "../data/metadata";

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

/** Bandeau (spec §5). `locale`/`timeZone` injectables pour les tests. */
export function formatBanner(
  meta: LatestMetadata,
  nowMs: number,
  _locale: string = navigator.language,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const run = hhmm(meta.run, "UTC");
  const validUtc = hhmm(meta.valid_time_utc, "UTC");
  const validLocal = hhmm(meta.valid_time_utc, timeZone);
  const local = validLocal === validUtc ? "" : ` (${validLocal} locale)`;
  return `NOAA GFS 0,25° · run ${run} UTC · valide ${validUtc} UTC${local} · ${formatAgo(meta.generated_at, nowMs)}`;
}

/** Graduations de la légende : tous les `step` °C dans [-40, 40], en % de [minC, maxC]. */
export function legendTicks(minC: number, maxC: number, step = 10): { c: number; pct: number }[] {
  const out: { c: number; pct: number }[] = [];
  for (let c = -40; c <= 40; c += step) {
    out.push({ c, pct: ((c - minC) / (maxC - minC)) * 100 });
  }
  return out;
}
