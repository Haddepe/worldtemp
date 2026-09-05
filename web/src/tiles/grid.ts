/**
 * Maths de la pyramide géodésique (spec tuiles §2). MIROIR PYTHON : tiler/grid.py.
 * Modifier l'un impose de modifier l'autre ; les deux sont testés avec les mêmes nombres.
 */

export const TILE_SIZE = 512;

export interface TileId {
  z: number;
  x: number;
  y: number;
}

export interface Bounds {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

export function tilesPerLevel(z: number): [number, number] {
  return [2 ** (z + 1), 2 ** z];
}

export function tileSpan(z: number): number {
  return 180 / 2 ** z;
}

export function tileBounds(t: TileId): Bounds {
  const s = tileSpan(t.z);
  const lonMin = -180 + t.x * s;
  const latMax = 90 - t.y * s;
  return { lonMin, lonMax: lonMin + s, latMin: latMax - s, latMax };
}

export function tileAt(z: number, lon: number, lat: number): TileId {
  const [cols, rows] = tilesPerLevel(z);
  const s = tileSpan(z);
  const x = Math.min(cols - 1, Math.max(0, Math.floor((lon + 180) / s)));
  const y = Math.min(rows - 1, Math.max(0, Math.floor((90 - lat) / s)));
  return { z, x, y };
}

export function parent(t: TileId): TileId | null {
  return t.z === 0 ? null : { z: t.z - 1, x: t.x >> 1, y: t.y >> 1 };
}

export function children(t: TileId): TileId[] {
  const z = t.z + 1;
  const x = t.x * 2;
  const y = t.y * 2;
  return [{ z, x, y }, { z, x: x + 1, y }, { z, x, y: y + 1 }, { z, x: x + 1, y: y + 1 }];
}

export function tileKey(t: TileId): string {
  return `${t.z}/${t.x}/${t.y}`;
}

/** Sous-rectangle UV (v = 0 au sud) occupé par `leaf` dans la texture de `ancestor`. */
export function subRect(leaf: TileId, ancestor: TileId): { offsetX: number; offsetY: number; scale: number } {
  const k = leaf.z - ancestor.z;
  const n = 2 ** k;
  const localX = leaf.x - ancestor.x * n;
  const rowFromNorth = leaf.y - ancestor.y * n;
  if (k < 0 || localX < 0 || localX >= n || rowFromNorth < 0 || rowFromNorth >= n) {
    throw new Error(`${tileKey(ancestor)} n'est pas un ancêtre de ${tileKey(leaf)}`);
  }
  return { offsetX: localX / n, offsetY: 1 - (rowFromNorth + 1) / n, scale: 1 / n };
}

export function pixelsPerDegree(z: number): number {
  return (TILE_SIZE * 2 ** z) / 180;
}
