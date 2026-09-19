/**
 * Chaînes d'interface, en anglais (spec site public §3.2). Seule langue du site aujourd'hui :
 * en ajouter une = ajouter un fichier de même forme et le choisir dans `./index.ts`.
 * Les messages de console et d'exception n'ont pas leur place ici (développeur seulement).
 */
export const STRINGS = {
  layers: {
    none: "None",
    temp: "Temperature",
    clouds: "Clouds",
    rain: "Rain",
    pressure: "Pressure",
    humidity: "Humidity",
    pm25: "PM2.5",
    dust: "Dust",
  },
  layersMenuLabel: "Layer",
  unavailable: "Unavailable",
  toggles: {
    windUnavailable: "Wind unavailable",
    labelsUnavailable: "Labels unavailable",
    riversUnavailable: "Rivers unavailable",
  },
  status: {
    noData: "Data unavailable, retrying in 15 min",
    updateFailed: "Update failed, retrying in 15 min",
    outdated: "Data is outdated",
    noMapDetail: "Map detail unavailable",
    layerUnavailable: "Layer unavailable",
    windUnavailable: "Wind unavailable",
  },
  fatal: {
    noWebgl: "This browser does not support WebGL, which the 3D globe requires.",
    contextLost: "3D rendering was interrupted by the browser. Reload the page.",
    bootFailed: "The globe could not start. Reload the page.",
    reload: "Reload",
  },
  banner: {
    valid: "valid",
    local: "local",
    justNow: "just now",
    minutesAgo: (minutes: number) => `${minutes} min ago`,
    hoursAgo: (hours: number, minutes: number) => `${hours} h ${String(minutes).padStart(2, "0")} min ago`,
  },
  wind: {
    label: "Wind",
    calm: "Calm",
    compass: ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"],
  },
  legend: { isolines: "isolines", min: "min", max: "max" },
  sources: {
    gfs_0p25: "NOAA GFS 0.25°",
    gefs_chem_0p25: "NOAA GEFS-Aerosols 0.25°",
  },
} as const;
