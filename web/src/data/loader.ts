import * as THREE from "three";
import { parseMetadata, type LatestMetadata } from "./metadata";

export class TextureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextureError";
  }
}

export interface LoaderDeps {
  fetchJson(url: string): Promise<unknown>;
  fetchBitmap(url: string): Promise<ImageBitmap>;
}

export interface LoadedData {
  meta: LatestMetadata;
  texture: THREE.Texture;
}

/** URL du PNG avec cache-busting `?v=<generated_at>` (spec pipeline §4). */
export function textureUrl(base: string, meta: LatestMetadata): string {
  return `${base}/${meta.texture}?v=${encodeURIComponent(meta.generated_at)}`;
}

export function needsTextureFetch(prev: LatestMetadata | null, next: LatestMetadata): boolean {
  return prev === null || prev.generated_at !== next.generated_at;
}

export function isStale(meta: LatestMetadata, nowMs: number, staleAfterMs: number): boolean {
  return nowMs - Date.parse(meta.valid_time_utc) > staleAfterMs;
}

/**
 * Texture « donnée » (spec §3) : aucune conversion de couleur, filtrage
 * linéaire, bouclage en u seulement. `flipY = false` car l'orientation d'un
 * ImageBitmap est fixée à sa création (`imageOrientation: "flipY"` dans
 * `browserDeps`), Three.js ignore `flipY` pour ce type d'image.
 */
export function bitmapToTexture(bitmap: ImageBitmap, meta: LatestMetadata): THREE.Texture {
  const { width, height } = meta.grid;
  if (bitmap.width !== width || bitmap.height !== height) {
    if (typeof bitmap.close === "function") bitmap.close();
    throw new TextureError(`texture ${bitmap.width}×${bitmap.height}, grille ${width}×${height} attendue`);
  }
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

export const browserDeps: LoaderDeps = {
  async fetchJson(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
    return r.json();
  },
  async fetchBitmap(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
    const blob = await r.blob();
    return createImageBitmap(blob, {
      imageOrientation: "flipY",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
  },
};

export class DataLoader {
  private current: LoadedData | null = null;
  private inflight: Promise<LoadedData | null> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly deps: LoaderDeps = browserDeps,
  ) {}

  get data(): LoadedData | null {
    return this.current;
  }

  /**
   * Relit `latest.json`. Renvoie les nouvelles données si `generated_at` a
   * changé, `null` sinon. Lève (`MetadataError`, `TextureError`, erreur
   * réseau) sans toucher à l'état courant.
   *
   * Non réentrant : un appel pendant qu'un précédent est en cours renvoie la
   * même promesse au lieu de déclencher un second fetch/decode concurrent
   * (le minuteur de rafraîchissement et `visibilitychange` peuvent se
   * chevaucher).
   */
  refresh(): Promise<LoadedData | null> {
    if (this.inflight) return this.inflight;
    const run = async (): Promise<LoadedData | null> => {
      const meta = parseMetadata(await this.deps.fetchJson(`${this.baseUrl}/latest.json`));
      if (!needsTextureFetch(this.current?.meta ?? null, meta)) return null;
      const bitmap = await this.deps.fetchBitmap(textureUrl(this.baseUrl, meta));
      const texture = bitmapToTexture(bitmap, meta);
      const previous = this.current;
      this.current = { meta, texture };
      const img = previous?.texture.image as ImageBitmap | undefined;
      previous?.texture.dispose();
      if (img && typeof img.close === "function") img.close();
      return this.current;
    };
    this.inflight = run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }
}
