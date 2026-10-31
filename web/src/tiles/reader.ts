/**
 * Lecture d'un pixel de tuile forêt pour le tooltip (spec forêt §7, Review Focus 1) : la tuile la
 * plus fine présente à l'index pour ce point (`forestTileFor`), décodée en octets, texel exact —
 * aucune interpolation de l'année, jamais la valeur d'une autre tuile (ancêtre, voisine). Une tuile
 * vide à l'index = pas de forêt (`null`) ; une tuile pas encore décodée = rien (`peek` → undefined).
 */
import { tileAt, tileBounds, type TileId } from "./grid";
import { forestTileFor, forestTileUrl, type ForestSource } from "./loader";

export interface ForestReading {
  /** Couvert 2000, % de canopée (0 sous le seuil). */
  cover: number;
  /** Année de perte (2001–2024), `null` sans perte : part nulle → pas de perte (R4). */
  lossYear: number | null;
  /** Niveau de la tuile lue. */
  level: number;
}

/** Octets RGBA, ligne 0 au nord (décodés sans retournement). */
export interface TilePixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface TileReaderDeps {
  /** Jeu forêt courant ; `null` tant que son manifeste n'est pas chargé. */
  source(): ForestSource | null;
  decode(url: string): Promise<TilePixels>;
  /** Tuiles décodées gardées (≈ 1 Mo chacune à 512 px). */
  cacheSize?: number;
}

export interface TileReader {
  /** Décode la tuile au besoin. `null` : pas de forêt (tuile vide à l'index) ou pas de jeu forêt. */
  read(lon: number, lat: number): Promise<ForestReading | null>;
  /** Synchrone, sans téléchargement : `undefined` si la tuile n'est pas (encore) décodée. */
  peek(lon: number, lat: number): ForestReading | null | undefined;
}

interface Entry {
  promise: Promise<TilePixels>;
  pixels: TilePixels | null;
}

export function createTileReader(deps: TileReaderDeps): TileReader {
  const max = Math.max(1, deps.cacheSize ?? 6);
  /** Ordre d'insertion = ordre d'usage (LRU) ; clé = URL, qui porte la racine versionnée. */
  const cache = new Map<string, Entry>();

  const locate = (lon: number, lat: number): { src: ForestSource; tile: TileId; url: string } | null => {
    const src = deps.source();
    if (!src) return null;
    const tile = forestTileFor(tileAt(src.manifest.maxLevel, lon, lat), src.manifest, src.index);
    return tile ? { src, tile, url: forestTileUrl(src, tile) } : null;
  };

  const touch = (url: string, e: Entry): void => {
    cache.delete(url);
    cache.set(url, e);
  };

  const texel = (src: ForestSource, tile: TileId, px: TilePixels, lon: number, lat: number): ForestReading => {
    const b = tileBounds(tile);
    const col = Math.min(px.width - 1, Math.max(0, Math.floor(((lon - b.lonMin) / (b.lonMax - b.lonMin)) * px.width)));
    const row = Math.min(px.height - 1, Math.max(0, Math.floor(((b.latMax - lat) / (b.latMax - b.latMin)) * px.height)));
    const i = (row * px.width + col) * 4;
    const ch = src.manifest.channels;
    const byte = (c: number): number => px.data[i + c] ?? 0;
    const year = byte(ch.year);
    return { cover: byte(ch.cover), lossYear: byte(ch.share) > 0 && year > 0 ? src.manifest.yearBase + year : null, level: tile.z };
  };

  return {
    peek(lon, lat) {
      const at = locate(lon, lat);
      if (!at) return null;
      const e = cache.get(at.url);
      if (!e?.pixels) return undefined;
      touch(at.url, e);
      return texel(at.src, at.tile, e.pixels, lon, lat);
    },
    async read(lon, lat) {
      const at = locate(lon, lat);
      if (!at) return null;
      let e = cache.get(at.url);
      if (e) touch(at.url, e);
      else {
        const entry: Entry = { promise: deps.decode(at.url), pixels: null };
        e = entry;
        cache.set(at.url, entry);
        while (cache.size > max) cache.delete(cache.keys().next().value as string);
        entry.promise.then(
          (p) => (entry.pixels = p),
          () => {
            if (cache.get(at.url) === entry) cache.delete(at.url); // nouvel essai à la lecture suivante
          },
        );
      }
      const px = await e.promise;
      return texel(at.src, at.tile, px, lon, lat);
    },
  };
}

/** Décodage navigateur : `createImageBitmap` sans retournement ni conversion, puis `getImageData`. */
export async function browserDecodeTile(url: string): Promise<TilePixels> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  try {
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("2D canvas unavailable");
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { width: img.width, height: img.height, data: img.data };
  } finally {
    bmp.close();
  }
}
