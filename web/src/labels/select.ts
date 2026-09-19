/**
 * Choix des étiquettes à afficher (spec repères §3) : éligibilité selon le zoom, horizon,
 * viewport, anti-chevauchement glouton par priorité, plafond, stabilité. Logique pure :
 * la projection est injectée, aucune mesure DOM (boîtes estimées).
 */
import type { Tier } from "../gpu/tier";
import type { LabelItem, LabelSet } from "./data";

/** Du plus loin au plus près ; le premier palier dont `d ≥ minD` s'applique. Les capitales passent toujours. */
export const CITY_TIERS: readonly { minD: number; minPop: number }[] = [
  { minD: 2.5, minPop: 5_000_000 },
  { minD: 1.6, minPop: 1_000_000 },
  { minD: 1.25, minPop: 100_000 },
  { minD: 0, minPop: 0 },
];
/**
 * Mêmes bornes que CITY_TIERS ; `maxRank` −1 = aucun pays (de près, les villes prennent la
 * place). Rang 7 = tous les vrais pays : les micro-États (rang ≥ 8, F1) restent exclus, leur
 * capitale reste une étiquette de ville plutôt que de masquer une vraie capitale.
 */
export const COUNTRY_TIERS: readonly { minD: number; maxRank: number }[] = [
  { minD: 2.5, maxRank: 3 },
  { minD: 1.6, maxRank: 5 },
  { minD: 1.25, maxRank: 7 },
  { minD: 0, maxRank: -1 },
];
export const LABEL_CAP: Record<Tier, number> = { high: 60, low: 30 };
export const NARROW_PX = 600;
/** Sous NARROW_PX, le plafond est ramené aux deux tiers plutôt qu'à la moitié (F4) : l'anti-
 * chevauchement limite déjà la densité, un plafond à la moitié laissait de la place inutilisée
 * sur mobile (Marseille, Toulouse, Bordeaux manquants alors que l'écran en avait la place). */
const NARROW_FACTOR = 2 / 3;
/** Marge de limbe (F3) : un point trop proche du bord projeté pose son texte hors du disque
 * du globe. Rejeté au-delà de LIMB_FRACTION × le rayon du limbe (0,92 ≈ 8 % de retrait). */
export const LIMB_FRACTION = 0.92;

/** Largeur moyenne d'un caractère (px CSS) à la taille de `.label`, et géométrie des boîtes. */
const CHAR_W = 6.5;
const COUNTRY_CHAR_W = 9; // capitales espacées
const VALUE_CHARS = 9;    // « 1013 hPa », « 120 µg/m³ »
const LINE_H = 15;
const PAD = 4;
const DOT = 8;            // point de la ville + écart avant le nom

export function tierIndex(d: number): number {
  const i = CITY_TIERS.findIndex((t) => d >= t.minD);
  return i === -1 ? CITY_TIERS.length - 1 : i;
}

export function labelCap(tier: Tier, viewportWidth: number): number {
  const cap = LABEL_CAP[tier];
  return viewportWidth < NARROW_PX ? Math.floor(cap * NARROW_FACTOR) : cap;
}

export function eligible(item: LabelItem, d: number): boolean {
  const t = tierIndex(d);
  if (item.kind === "country") return item.rank <= COUNTRY_TIERS[t]!.maxRank;
  return item.capital || item.pop >= CITY_TIERS[t]!.minPop;
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

/** Boîte estimée autour du point écran (x, y). Ville : point puis texte à droite ; pays : texte centré. */
export function labelBox(item: LabelItem, x: number, y: number, hasValue: boolean): Box {
  if (item.kind === "country") {
    const w = item.name.length * COUNTRY_CHAR_W + 2 * PAD;
    return { x0: x - w / 2, y0: y - LINE_H / 2 - PAD, x1: x + w / 2, y1: y + LINE_H / 2 + PAD };
  }
  const chars = Math.max(item.name.length, hasValue ? VALUE_CHARS : 0);
  return { x0: x - DOT / 2 - PAD, y0: y - LINE_H / 2 - PAD, x1: x + DOT + chars * CHAR_W + PAD, y1: y + LINE_H / 2 + (hasValue ? LINE_H : 0) + PAD };
}

export interface Placed { id: number; x: number; y: number }

export interface SelectInput {
  set: LabelSet;
  /** Distance caméra–centre. */
  d: number;
  /** Direction unité du centre vers la caméra. */
  camDir: { x: number; y: number; z: number };
  /** Écrit la position écran (px CSS) de l'item ; `false` s'il est hors viewport. */
  project(id: number, out: { x: number; y: number }): boolean;
  cap: number;
  /** Une valeur de couche s'affiche sous le nom des villes. */
  hasValue: boolean;
  /** Cadre (px CSS) dont la boîte estimée ne doit pas dépasser : sinon le texte est coupé au bord. Absent = pas de contrôle. */
  bounds?: Box;
  /** Zones déjà occupées (panneaux de l'interface, posés au-dessus des étiquettes). */
  obstacles?: readonly Box[];
  /** Ids déjà affichés : placés d'abord (pas de clignotement en rotation). À vider par l'appelant à chaque changement de palier. */
  shown: ReadonlySet<number>;
}

export function selectLabels(input: SelectInput): Placed[] {
  const { set, d, camDir, cap, hasValue, shown, bounds } = input;
  const horizon = 1 / d; // point à rayon 1 (spec tuiles §5)
  const placed: Placed[] = [];
  // Les obstacles ouvrent la liste des boîtes occupées : même test que l'anti-chevauchement.
  const boxes: Box[] = input.obstacles ? [...input.obstacles] : [];
  const at = { x: 0, y: 0 };
  // Rayon du limbe (bord du disque projeté), en unités où le rayon de la sphère vaut 1 : la
  // tangente depuis la caméra fait un triangle rectangle d'hypoténuse d, donc de rayon
  // 1/√(d² − 1) (indépendant du point, ne dépend que de la distance caméra).
  const limbRadius = LIMB_FRACTION / Math.sqrt(d * d - 1);
  const tryPlace = (item: LabelItem): void => {
    const o = item.id * 3;
    const c = set.unit[o]! * camDir.x + set.unit[o + 1]! * camDir.y + set.unit[o + 2]! * camDir.z;
    if (c <= horizon) return;
    // Marge de limbe (F3) : rayon projeté du point ∝ √(1 − c²) / (d − c) (c = cosinus de
    // l'angle au centre) ; au-delà de limbRadius, le texte déborderait du disque du globe.
    if (Math.sqrt(Math.max(0, 1 - c * c)) / (d - c) > limbRadius) return;
    if (!eligible(item, d)) return;
    if (!input.project(item.id, at)) return;
    const box = labelBox(item, at.x, at.y, hasValue);
    if (bounds && (box.x0 < bounds.x0 || box.y0 < bounds.y0 || box.x1 > bounds.x1 || box.y1 > bounds.y1)) return;
    for (const b of boxes) {
      if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) return;
    }
    boxes.push(box);
    placed.push({ id: item.id, x: at.x, y: at.y });
  };
  for (const item of set.items) {
    if (placed.length >= cap) return placed;
    if (shown.has(item.id)) tryPlace(item);
  }
  for (const item of set.items) {
    if (placed.length >= cap) return placed;
    if (!shown.has(item.id)) tryPlace(item);
  }
  return placed;
}
