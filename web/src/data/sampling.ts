import type { Encoding, Grid } from "./metadata";

export interface Uv {
  u: number;
  v: number;
}

/**
 * Coordonnées de texture au centre du pixel GFS contenant (lon, lat).
 *
 * Grille cellulaire de la spec pipeline §4 : colonne x ↔ lon = -180 + 0,25·x
 * (1440 colonnes, dernière 179,75, pas de colonne de bouclage) ; ligne y ↔
 * lat = 90 − 0,25·y (721 lignes, pôles inclus). v est en convention Three.js
 * (0 en bas) : v = 1 − v_haut.
 *
 * MIROIR GLSL : `render/shaders/patch.frag.glsl` calcule la même chose depuis
 * vLonLat : eq.x = (vLonLat.x + 180) / 360, eq.y = (vLonLat.y + 90) / 180, puis
 * applique la même formule cellulaire. Modifier l'un impose de modifier l'autre.
 */
export function heatmapUv(lon: number, lat: number, grid: Pick<Grid, "width" | "height">): Uv {
  const x = ((lon + 180) / 360) * grid.width; // colonne fractionnaire
  const y = ((90 - lat) / 180) * (grid.height - 1); // ligne fractionnaire
  return {
    u: (x + 0.5) / grid.width,
    v: 1 - (y + 0.5) / grid.height,
  };
}

/**
 * Température (°C) au point (lon, lat), bilinéaire sur le canal R de `pixels` (RGBA, nord en
 * haut, `data/pixels.ts`). Mêmes coordonnées cellulaires que `heatmapUv` : lon −180 est le
 * centre de la colonne 0, lat 90 le centre de la ligne 0 ; bouclage en longitude, latitude bornée.
 */
export function sampleTemperature(
  pixels: Uint8ClampedArray,
  grid: Pick<Grid, "width" | "height">,
  encoding: Pick<Encoding, "min_c" | "max_c">,
  lon: number,
  lat: number,
): number {
  const W = grid.width;
  const H = grid.height;
  const toC = (t: number) => encoding.min_c + (t / 255) * (encoding.max_c - encoding.min_c);
  const at = (col: number, row: number) => pixels[(row * W + col) * 4] ?? 0;
  let x = ((lon + 180) / 360) * W;
  x = ((x % W) + W) % W;
  const x0 = Math.floor(x);
  const x1 = (x0 + 1) % W;
  const fx = x - x0;
  if (H < 2) return toC(at(x0, 0) * (1 - fx) + at(x1, 0) * fx); // hors contrat (721 lignes), garde d'index
  const y = Math.min(H - 1, Math.max(0, ((90 - lat) / 180) * (H - 1)));
  const y0 = Math.min(H - 2, Math.floor(y));
  const y1 = y0 + 1;
  const fy = y - y0;
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return toC(top * (1 - fy) + bottom * fy);
}
