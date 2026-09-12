/** Base des couches publiées par le pipeline (spec couches §7 : `layers/latest.json`, `layers/<id>.png`). */
export const DATA_BASE_URL: string =
  import.meta.env.VITE_DATA_BASE_URL ??
  "https://data.globelayers.com/layers";

/** Racine des tuiles (spec tuiles §2 : `manifest.json`, `index.bin`, `sat/`, `map/`). */
export const TILES_BASE_URL: string =
  import.meta.env.VITE_TILES_BASE_URL ??
  "https://data.globelayers.com/tiles/v1";

/** Période de relecture de `latest.json` (spec §3). */
export const REFRESH_MS = 15 * 60 * 1000;

/** Au-delà, la couche est affichée avec le statut « Données anciennes » (spec §5). */
export const STALE_AFTER_MS = 6 * 3600 * 1000;
