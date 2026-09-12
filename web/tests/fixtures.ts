/** Exemple de la spec couches §7, étendu aux 7 couches. */
const GRID = {
  width: 1440, height: 721,
  lon_min: -180, lon_max: 179.75, lat_min: -90, lat_max: 90,
  lon_step: 0.25, lat_step: 0.25,
};

function gfs(id: string, variable: string, unit: string, enc: { min: number; max: number; scale: "linear" | "sqrt" }, stats: { min: number; max: number }) {
  return {
    model: "gfs_0p25", variable, unit,
    run: "2026-09-12T06:00:00Z", forecast_hour: 8,
    valid_time_utc: "2026-09-12T14:00:00Z", generated_at: "2026-09-12T14:12:40Z",
    texture: `${id}.png`, encoding: { bits: 8, ...enc }, stats,
  };
}

function chem(id: string, variable: string, max: number, stats: { min: number; max: number }) {
  return {
    model: "gefs_chem_0p25", variable, unit: "µg/m³",
    run: "2026-09-12T06:00:00Z", forecast_hour: 6,
    valid_time_utc: "2026-09-12T12:00:00Z", generated_at: "2026-09-12T12:12:07Z",
    texture: `${id}.png`, encoding: { bits: 8, min: 0, max, scale: "sqrt" as const }, stats,
  };
}

export const MANIFEST = {
  schema_version: 2,
  generated_at: "2026-09-12T14:12:40Z",
  grid: GRID,
  layers: {
    temp: gfs("temp", "TMP_2m", "°C", { min: -90, max: 60, scale: "linear" }, { min: -61.3, max: 47.8 }),
    clouds: gfs("clouds", "TCDC_entire_atmosphere", "%", { min: 0, max: 100, scale: "linear" }, { min: 0, max: 100 }),
    rain: gfs("rain", "PRATE_surface", "mm/h", { min: 0, max: 50, scale: "sqrt" }, { min: 0, max: 38.2 }),
    pressure: gfs("pressure", "PRMSL", "hPa", { min: 940, max: 1060, scale: "linear" }, { min: 962.1, max: 1041.7 }),
    humidity: gfs("humidity", "RH_2m", "%", { min: 0, max: 100, scale: "linear" }, { min: 2, max: 100 }),
    pm25: chem("pm25", "PMTF_surface_total", 500, { min: 0, max: 312.4 }),
    dust: chem("dust", "PMTC_surface_dust", 2000, { min: 0, max: 1650.2 }),
  },
};

/** Entrée `temp` seule, pratique pour les tests de chargement. */
export const TEMP_ENTRY = MANIFEST.layers.temp;
export { GRID };
