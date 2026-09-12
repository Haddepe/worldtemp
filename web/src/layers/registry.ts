/**
 * Registre front des couches (spec couches §10). Le manifeste dit ce qui existe,
 * ce registre dit comment l'afficher : libellé, unité, format, palette RGBA en
 * valeur physique, graduations, seuil du tooltip, isolignes.
 */
export type Rgba = [number, number, number, number];

export interface Stop {
  /** Valeur physique (°C, %, mm/h, hPa, µg/m³). */
  v: number;
  /** sRGB 0–255 + alpha 0–255. */
  rgba: Rgba;
}

export interface LayerDef {
  id: string;
  label: string;
  unit: string;
  format(v: number): string;
  stops: readonly Stop[];
  /** Graduations de la légende, en valeur physique. */
  ticks: readonly number[];
  /** Sous ce seuil le tooltip affiche « — » ; null = toujours une valeur. */
  tooltipMin: number | null;
  /** Pas des isolignes en unité physique (pression : 4 hPa) ; null = aucune. */
  isoStep: number | null;
}

function fixed(v: number, decimals: number): string {
  let s = v.toFixed(decimals);
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  return s.replace("-", "−").replace(".", ",");
}

/** « 23,4 °C » (spec navigation §6) : une décimale, virgule, signe « − » U+2212, jamais « −0,0 ». */
export function formatTemperature(celsius: number): string {
  return `${fixed(celsius, 1)} °C`;
}

const percent = (v: number) => `${fixed(v, 0)} %`;
const ugm3 = (v: number) => `${fixed(v, 0)} µg/m³`;

const s = (v: number, r: number, g: number, b: number, a = 255): Stop => ({ v, rgba: [r, g, b, a] });

export const LAYERS: readonly LayerDef[] = [
  {
    id: "temp", label: "Température", unit: "°C", format: formatTemperature,
    stops: [
      s(-90, 30, 0, 50), s(-45, 10, 20, 110), s(-30, 20, 60, 200), s(-15, 40, 190, 230), s(0, 40, 170, 70),
      s(10, 240, 230, 40), s(20, 250, 150, 20), s(30, 220, 30, 20), s(45, 120, 0, 10), s(60, 90, 0, 70),
    ],
    ticks: [-40, -30, -20, -10, 0, 10, 20, 30, 40], tooltipMin: null, isoStep: null,
  },
  {
    id: "clouds", label: "Nuages", unit: "%", format: percent,
    stops: [s(0, 255, 255, 255, 0), s(100, 255, 255, 255, 230)],
    ticks: [0, 25, 50, 75, 100], tooltipMin: null, isoStep: null,
  },
  {
    id: "rain", label: "Pluie", unit: "mm/h", format: (v) => `${fixed(v, 1)} mm/h`,
    stops: [
      s(0, 60, 120, 255, 0), s(0.1, 60, 120, 255, 0), s(0.5, 60, 120, 255, 200), s(2, 40, 220, 240, 220),
      s(8, 250, 230, 40, 230), s(25, 230, 40, 30, 240), s(50, 200, 0, 200, 255),
    ],
    ticks: [0.5, 2, 8, 25, 50], tooltipMin: 0.1, isoStep: null,
  },
  {
    id: "pressure", label: "Pression", unit: "hPa", format: (v) => `${fixed(v, 0)} hPa`,
    stops: [s(940, 20, 40, 160), s(980, 60, 130, 220), s(1013, 240, 240, 240), s(1035, 250, 170, 60), s(1060, 200, 60, 20)],
    ticks: [940, 960, 980, 1000, 1020, 1040, 1060], tooltipMin: null, isoStep: 4,
  },
  {
    id: "humidity", label: "Humidité", unit: "%", format: percent,
    stops: [s(0, 170, 110, 40), s(50, 235, 235, 225), s(100, 30, 140, 170)],
    ticks: [0, 25, 50, 75, 100], tooltipMin: null, isoStep: null,
  },
  {
    id: "pm25", label: "PM2.5", unit: "µg/m³", format: ugm3,
    stops: [
      s(0, 80, 200, 120, 0), s(5, 80, 200, 120, 0), s(12, 80, 200, 120, 220), s(35, 250, 220, 40, 230),
      s(55, 250, 140, 30, 235), s(150, 220, 40, 40, 240), s(250, 140, 40, 160, 250), s(500, 110, 20, 50, 255),
    ],
    ticks: [12, 35, 55, 150, 250], tooltipMin: 5, isoStep: null,
  },
  {
    id: "dust", label: "Poussière", unit: "µg/m³", format: ugm3,
    stops: [
      s(0, 230, 200, 140, 0), s(20, 230, 200, 140, 0), s(60, 230, 200, 140, 200), s(200, 170, 110, 50, 230),
      s(800, 100, 60, 30, 245), s(2000, 20, 10, 5, 255),
    ],
    ticks: [60, 200, 800, 2000], tooltipMin: 20, isoStep: null,
  },
];

const BY_ID = new Map(LAYERS.map((d) => [d.id, d]));

export function layerDef(id: string): LayerDef | undefined {
  return BY_ID.get(id);
}
