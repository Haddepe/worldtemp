/** Exemple de la spec pipeline §4, tel quel. */
export const SAMPLE = {
  schema_version: 1,
  model: "gfs_0p25",
  variable: "TMP_2m",
  run: "2026-08-30T06:00:00Z",
  forecast_hour: 8,
  valid_time_utc: "2026-08-30T14:00:00Z",
  generated_at: "2026-08-30T14:07:42Z",
  encoding: { bits: 8, min_c: -90, max_c: 60 },
  grid: {
    width: 1440, height: 721,
    lon_min: -180, lon_max: 179.75, lat_min: -90, lat_max: 90,
    lon_step: 0.25, lat_step: 0.25,
  },
  texture: "latest.png",
  stats: { min_c: -71.3, max_c: 48.9 },
};
