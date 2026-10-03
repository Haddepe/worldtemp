/**
 * Textes et nom de fichier de la capture (spec capture §3) : tout en UTC, l'audience est mondiale.
 * Calculs à la main plutôt qu'`Intl` : sortie identique sur tous les navigateurs, testable telle quelle.
 */
import { STRINGS } from "../i18n";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** « Sat 3 Oct 2026, 13:24 UTC » : minute tronquée, comme l'instant affiché par le curseur. */
export function captureWhen(tMs: number): string {
  const d = new Date(tMs);
  const { days, months } = STRINGS.capture;
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

/** « NOAA GFS run 3 Oct 06Z » ; modèle inconnu → identifiant brut. */
export function captureRun(model: string, runIso: string): string {
  const d = new Date(runIso);
  const source = STRINGS.capture.sources[model] ?? model;
  return STRINGS.capture.run(source, `${d.getUTCDate()} ${STRINGS.capture.months[d.getUTCMonth()]} ${pad2(d.getUTCHours())}Z`);
}

/** `globelayers-<couche>-<AAAA-MM-JJ>-<HH>UTC.png` ; sans couche, le segment disparaît. */
export function captureFileName(layerId: string | null, tMs: number): string {
  const d = new Date(tMs);
  const stamp = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}-${pad2(d.getUTCHours())}UTC`;
  return layerId && layerId !== "none" ? `globelayers-${layerId}-${stamp}.png` : `globelayers-${stamp}.png`;
}
