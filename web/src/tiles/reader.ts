/**
 * Lecture d'un pixel de tuile forêt pour le tooltip (spec forêt §7, Review Focus 1) : la tuile la
 * plus fine présente à l'index pour ce point (`forestTileFor`), décodée en octets, texel exact —
 * aucune interpolation de l'année, jamais la valeur d'une autre tuile (ancêtre, voisine). Une tuile
 * vide à l'index = pas de forêt (`null`) ; une tuile pas encore décodée = rien (`peek` → undefined).
 */
import { tileAt, tileBounds, type TileId } from "./grid";
import { type ByteRange, rangeHeader } from "./deep";
import { forestTileFor, forestTileRequest, type ForestSource } from "./loader";

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
  /** `range` non nul : tuile profonde lue dans son archive (requête Range). */
  decode(url: string, signal: AbortSignal, range?: ByteRange | null): Promise<TilePixels>;
  /** Tuiles décodées gardées (≈ 1 Mo chacune à 512 px). */
  cacheSize?: number;
  /** Décodages simultanés au plus (survol rapide : pas une requête par case traversée). */
  maxInflight?: number;
  /** Après un échec (404, réseau coupé), aucune nouvelle requête de cette tuile pendant ce délai. */
  failureCooldownMs?: number;
  now?(): number;
}

export interface TileReader {
  /** Décode la tuile au besoin. `null` : pas de forêt (tuile vide à l'index) ou pas de jeu forêt.
   * Rejette si la tuile a échoué récemment, ou si la demande est remplacée par une plus récente. */
  read(lon: number, lat: number): Promise<ForestReading | null>;
  /** Synchrone, sans téléchargement : `undefined` si la tuile n'est pas (encore) décodée. */
  peek(lon: number, lat: number): ForestReading | null | undefined;
  /** Annule les décodages en vol et la demande en attente (couche quittée) ; garde les tuiles décodées. */
  reset(): void;
}

interface Entry {
  promise: Promise<TilePixels>;
  pixels: TilePixels | null;
  controller: AbortController;
}

/** Tuile à décoder : clé de cache = URL (tuile R2) ou `url#offset` (tuile profonde, même archive). */
interface Req {
  key: string;
  url: string;
  range: ByteRange | null;
}

/** Demande en attente d'une place de décodage : une seule, la plus récente. */
interface Waiting {
  req: Req;
  promise: Promise<TilePixels>;
  resolve(p: TilePixels): void;
  reject(e: Error): void;
}

export function createTileReader(deps: TileReaderDeps): TileReader {
  const max = Math.max(1, deps.cacheSize ?? 6);
  const maxInflight = Math.max(1, deps.maxInflight ?? 1);
  const cooldown = deps.failureCooldownMs ?? 10_000;
  const now = deps.now ?? (() => Date.now());
  /** Ordre d'insertion = ordre d'usage (LRU) ; clé = `Req.key`, qui porte la racine versionnée. */
  const cache = new Map<string, Entry>();
  /** Cache négatif : clé → instant jusqu'auquel la tuile n'est pas redemandée. */
  const failedUntil = new Map<string, number>();
  let inflight = 0;
  let waiting: Waiting | null = null;

  const locate = (lon: number, lat: number): { src: ForestSource; tile: TileId; req: Req } | null => {
    const src = deps.source();
    if (!src) return null;
    const tile = forestTileFor(tileAt(src.deepMaxLevel, lon, lat), src);
    if (!tile) return null;
    const { url, range } = forestTileRequest(src, tile);
    return { src, tile, req: { key: range ? `${url}#${range.offset}` : url, url, range } };
  };

  const touch = (url: string, e: Entry): void => {
    cache.delete(url);
    cache.set(url, e);
  };

  /** Éviction LRU des seules tuiles décodées : une entrée en vol n'est jamais retirée (elle serait relue). */
  const evict = (): void => {
    for (const [url, e] of cache) {
      if (cache.size <= max) return;
      if (e.pixels) cache.delete(url);
    }
  };

  const coolingDown = (url: string): boolean => {
    const until = failedUntil.get(url);
    if (until === undefined) return false;
    if (now() < until) return true;
    failedUntil.delete(url);
    return false;
  };

  const start = (req: Req): Entry => {
    const key = req.key;
    const controller = new AbortController();
    inflight++;
    const entry: Entry = { promise: deps.decode(req.url, controller.signal, req.range), pixels: null, controller };
    cache.set(key, entry);
    const done = (): void => {
      inflight--;
      drain();
    };
    entry.promise.then(
      (p) => {
        entry.pixels = p;
        evict();
        done();
      },
      () => {
        if (cache.get(key) === entry) cache.delete(key);
        // Annulé (couche quittée) n'est pas un échec : pas de cache négatif.
        if (!controller.signal.aborted) failedUntil.set(key, now() + cooldown);
        done();
      },
    );
    evict();
    return entry;
  };

  const drain = (): void => {
    if (!waiting || inflight >= maxInflight) return;
    const w = waiting;
    waiting = null;
    const e = cache.get(w.req.key);
    if (e) e.promise.then(w.resolve, w.reject);
    else if (coolingDown(w.req.key)) w.reject(new Error(`tile failed recently: ${w.req.key}`));
    else start(w.req).promise.then(w.resolve, w.reject);
  };

  const pixelsFor = (req: Req): Promise<TilePixels> => {
    const key = req.key;
    const e = cache.get(key);
    if (e) {
      touch(key, e);
      return e.promise;
    }
    if (coolingDown(key)) return Promise.reject(new Error(`tile failed recently: ${key}`));
    if (inflight < maxInflight) return start(req).promise;
    if (waiting?.req.key === key) return waiting.promise;
    waiting?.reject(new Error("superseded by a newer tile request"));
    let resolve!: (p: TilePixels) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<TilePixels>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    waiting = { req, promise, resolve, reject };
    return promise;
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
      const e = cache.get(at.req.key);
      if (!e?.pixels) return undefined;
      touch(at.req.key, e);
      return texel(at.src, at.tile, e.pixels, lon, lat);
    },
    async read(lon, lat) {
      const at = locate(lon, lat);
      if (!at) return null;
      const px = await pixelsFor(at.req);
      return texel(at.src, at.tile, px, lon, lat);
    },
    reset() {
      waiting?.reject(new Error("tile reader reset"));
      waiting = null;
      for (const e of cache.values()) if (!e.pixels) e.controller.abort();
    },
  };
}

/** Décodage navigateur : `createImageBitmap` sans retournement ni conversion, puis `getImageData`. */
export async function browserDecodeTile(url: string, signal: AbortSignal, range?: ByteRange | null): Promise<TilePixels> {
  const r = await fetch(url, range ? { signal, headers: { Range: rangeHeader(range) } } : { signal });
  if (range ? r.status !== 206 : !r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
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
