/** Base des objets publiés par le pipeline (spec pipeline §4 : `gfs/latest.json`, `gfs/latest.png`). */
export const DATA_BASE_URL: string =
  import.meta.env.VITE_DATA_BASE_URL ??
  "https://pub-97483d42990244b3b19ae530da791d26.r2.dev/gfs";

/** Racine des tuiles (spec tuiles §2 : `manifest.json`, `index.bin`, `sat/`, `map/`). */
export const TILES_BASE_URL: string =
  import.meta.env.VITE_TILES_BASE_URL ??
  "https://pub-97483d42990244b3b19ae530da791d26.r2.dev/tiles/v1";

/** Période de relecture de `latest.json` (spec §3). */
export const REFRESH_MS = 15 * 60 * 1000;

/** Au-delà, la heatmap est affichée avec le statut « Données anciennes » (spec §5). */
export const STALE_AFTER_MS = 6 * 3600 * 1000;
