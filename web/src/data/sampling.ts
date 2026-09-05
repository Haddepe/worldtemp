import type { Grid } from "./metadata";

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
