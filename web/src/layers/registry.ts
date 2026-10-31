/**
 * Registre front des couches (spec couches §10). Le manifeste dit ce qui existe,
 * ce registre dit comment l'afficher : libellé, unité, format, palette RGBA en
 * valeur physique, graduations, seuil du tooltip, isolignes.
 */
import { STRINGS } from "../i18n";

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
  /** σ (en cellules) du flou appliqué à la texture affichée, pour les champs à fronts raides
   * que le bicubique restitue en marches d'escalier ; absent = texture brute. Le tooltip lit
   * toujours la donnée brute. */
  soften?: number;
  /** Id de la couche de base dont celle-ci est un mode (neige : cumul → épaisseur) ; absent = couche de base.
   * Un mode n'a pas d'entrée de menu, il se choisit dans le sélecteur de mode de sa base. */
  modeOf?: string;
  /** Libellé du mode dans le sélecteur de mode. */
  modeLabel?: string;
  /** Libellé des graduations de la légende ; absent = `tickLabel` de ui/format. */
  tickLabel?: (v: number) => string;
}

function fixed(v: number, decimals: number): string {
  let s = v.toFixed(decimals);
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  return s.replace("-", "−");
}

/** « 23.4 °C » (spec navigation §6, spec site public §3.3) : une décimale, point, signe « − » U+2212, jamais « −0.0 ». */
export function formatTemperature(celsius: number): string {
  return `${fixed(celsius, 1)} °C`;
}

const percent = (v: number) => `${fixed(v, 0)}%`;
const ugm3 = (v: number) => `${fixed(v, 0)} µg/m³`;

/** Neige en cm : une décimale sous 10 cm, entier jusqu'à 99 cm, puis mètres (« 1.0 m », « 7.4 m », « 32 m »). */
export function formatSnow(cm: number): string {
  if (cm < 9.95) return `${cm.toFixed(1)} cm`;
  if (Math.round(cm) < 100) return `${Math.round(cm)} cm`;
  const m = cm / 100;
  return m < 9.95 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`;
}

/** Graduation de l'épaisseur : centimètres sous 1 m, mètres au-delà (« 10 cm », « 1 m », « 10 m »). */
function depthTick(cm: number): string {
  return cm < 100 ? `${cm} cm` : `${cm / 100} m`;
}

const s = (v: number, r: number, g: number, b: number, a = 255): Stop => ({ v, rgba: [r, g, b, a] });

export const LAYERS: readonly LayerDef[] = [
  {
    id: "temp", label: STRINGS.layers.temp, unit: "°C", format: formatTemperature,
    stops: [
      s(-90, 30, 0, 50), s(-45, 10, 20, 110), s(-30, 20, 60, 200), s(-15, 40, 190, 230), s(0, 40, 170, 70),
      s(10, 240, 230, 40), s(20, 250, 150, 20), s(30, 220, 30, 20), s(45, 120, 0, 10), s(60, 90, 0, 70),
    ],
    ticks: [-40, -30, -20, -10, 0, 10, 20, 30, 40], tooltipMin: null, isoStep: null,
  },
  {
    id: "clouds", label: STRINGS.layers.clouds, unit: "%", format: percent,
    stops: [s(0, 255, 255, 255, 0), s(100, 255, 255, 255, 230)],
    ticks: [0, 25, 50, 75, 100], tooltipMin: null, isoStep: null, soften: 1.2,
  },
  {
    id: "rain", label: STRINGS.layers.rain, unit: "mm/h", format: (v) => `${fixed(v, 1)} mm/h`,
    stops: [
      s(0, 60, 120, 255, 0), s(0.1, 60, 120, 255, 0), s(0.5, 60, 120, 255, 200), s(2, 40, 220, 240, 220),
      s(8, 250, 230, 40, 230), s(25, 230, 40, 30, 240), s(50, 200, 0, 200, 255),
    ],
    ticks: [0.5, 2, 8, 25, 50], tooltipMin: 0.1, isoStep: null,
  },
  {
    id: "pressure", label: STRINGS.layers.pressure, unit: "hPa", format: (v) => `${fixed(v, 0)} hPa`,
    stops: [s(940, 20, 40, 160), s(980, 60, 130, 220), s(1013, 240, 240, 240), s(1035, 250, 170, 60), s(1060, 200, 60, 20)],
    ticks: [940, 960, 980, 1000, 1020, 1040, 1060], tooltipMin: null, isoStep: 4,
  },
  {
    id: "humidity", label: STRINGS.layers.humidity, unit: "%", format: percent,
    stops: [s(0, 170, 110, 40), s(50, 235, 235, 225), s(100, 30, 140, 170)],
    ticks: [0, 25, 50, 75, 100], tooltipMin: null, isoStep: null,
  },
  {
    id: "pm25", label: STRINGS.layers.pm25, unit: "µg/m³", format: ugm3,
    stops: [
      s(0, 80, 200, 120, 0), s(5, 80, 200, 120, 0), s(12, 80, 200, 120, 220), s(35, 250, 220, 40, 230),
      s(55, 250, 140, 30, 235), s(150, 220, 40, 40, 240), s(250, 140, 40, 160, 250), s(500, 110, 20, 50, 255),
    ],
    ticks: [12, 35, 55, 150, 250], tooltipMin: 5, isoStep: null,
  },
  {
    id: "dust", label: STRINGS.layers.dust, unit: "µg/m³", format: ugm3,
    stops: [
      s(0, 230, 200, 140, 0), s(20, 230, 200, 140, 0), s(60, 230, 200, 140, 200), s(200, 170, 110, 50, 230),
      s(800, 100, 60, 30, 245), s(2000, 20, 10, 5, 255),
    ],
    ticks: [60, 200, 800, 2000], tooltipMin: 20, isoStep: null,
  },
  {
    // Cumul de neige (cm) depuis l'heure du run : bleus clairs → bleus → violets. Bas de gamme assez saturé
    // pour rester visible sur la calotte blanche du Groenland et la carte claire (validé Task 7).
    id: "snowfall", label: STRINGS.layers.snow, modeLabel: STRINGS.snowModes.snowfall, unit: "cm", format: formatSnow,
    stops: [
      s(0, 150, 195, 245, 0), s(0.5, 150, 195, 245, 0), s(1, 150, 195, 245, 190), s(5, 95, 160, 240, 215),
      s(20, 60, 115, 225, 232), s(50, 50, 75, 205, 240), s(100, 110, 60, 200, 245), s(300, 150, 40, 170, 250),
      s(500, 90, 10, 110, 255),
    ],
    ticks: [1, 5, 20, 50, 100, 300], tooltipMin: 0.5, isoStep: null,
  },
  {
    // Épaisseur au sol (cm). Arrêts en valeur physique : dégradé froid dense de 1 à 150 cm (toute la neige
    // saisonnière), puis bande chaude « neige profonde » (teinte distincte) de 150 cm à la borne de l'encodage
    // (1000 cm). Seuil à 1,5 m : GFS plafonne vers 2–3 m même sur les calottes (mesuré sur run réel), donc une
    // bande à 3 m ne serait jamais vue ; décision utilisateur 2026-10-31. Transparent sous 1 cm, comme le
    // tooltip (tooltipMin).
    id: "snow_depth", modeOf: "snowfall", label: STRINGS.layers.snow, modeLabel: STRINGS.snowModes.depth, unit: "cm",
    format: formatSnow, tickLabel: depthTick,
    stops: [
      s(0, 170, 205, 248, 0), s(0.99, 170, 205, 248, 0), s(1, 170, 205, 248, 150), s(2, 150, 190, 246, 175),
      s(5, 125, 170, 244, 195), s(10, 105, 150, 240, 210), s(25, 80, 125, 232, 225), s(50, 60, 100, 220, 235),
      s(100, 70, 60, 185, 242), s(150, 140, 40, 150, 250),
      s(155, 220, 50, 100, 252), s(300, 250, 140, 40, 255), s(1000, 255, 225, 120, 255),
    ],
    ticks: [10, 50, 150, 300, 1000], tooltipMin: 1, isoStep: null,
  },
];

const BY_ID = new Map(LAYERS.map((d) => [d.id, d]));

export function layerDef(id: string): LayerDef | undefined {
  return BY_ID.get(id);
}
