/** Base des couches publiées par le pipeline (spec lot E §4 : `layers/forecast.json`, `layers/<run>/<couche>_f<fh>.png`). */
export const DATA_BASE_URL: string =
  import.meta.env.VITE_DATA_BASE_URL ??
  "https://data.globelayers.com/layers";

/** Racine des tuiles (spec tuiles §2 : `manifest.json`, `index.bin`, `sat/`, `map/`). */
export const TILES_BASE_URL: string =
  import.meta.env.VITE_TILES_BASE_URL ??
  "https://data.globelayers.com/tiles/v1";

/** Période de relecture de `forecast.json`. */
export const REFRESH_MS = 15 * 60 * 1000;

/** Au-delà, statut « Données anciennes » : âge du run GFS (spec lot E §6.4 ; en service normal ≤ ~10 h). */
export const STALE_RUN_AFTER_MS = 12 * 3600 * 1000;

/** Pendant la lecture, valeurs des étiquettes rafraîchies au plus toutes les 250 ms (spec lot E §6.2). */
export const LABELS_REFRESH_MS = 250;
