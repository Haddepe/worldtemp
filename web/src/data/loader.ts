import * as THREE from "three";
import { type Grid, type LayerEntry, type Manifest, parseManifest } from "./manifest";
import { bitmapPixels } from "./pixels";

export class TextureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextureError";
  }
}

export interface LoaderDeps {
  fetchJson(url: string): Promise<unknown>;
  fetchBitmap(url: string): Promise<ImageBitmap>;
  /** Lecture CPU des pixels (tooltip). `null` = tooltip indisponible, rendu inchangé. */
  bitmapPixels(bitmap: ImageBitmap): Uint8ClampedArray | null;
}

export interface LoadedLayer {
  entry: LayerEntry;
  texture: THREE.Texture;
  pixels: Uint8ClampedArray | null;
}

/** URL du PNG d'une couche avec cache-busting `?v=<generated_at de la couche>` (spec couches §7). */
export function textureUrl(base: string, entry: LayerEntry): string {
  return `${base}/${entry.texture}?v=${encodeURIComponent(entry.generated_at)}`;
}

export function needsTextureFetch(prev: LayerEntry | null, next: LayerEntry): boolean {
  return prev === null || prev.generated_at !== next.generated_at;
}

export function isStale(entry: LayerEntry, nowMs: number, staleAfterMs: number): boolean {
  return nowMs - Date.parse(entry.valid_time_utc) > staleAfterMs;
}

/**
 * Texture « donnée » : aucune conversion de couleur, filtrage linéaire, bouclage
 * en u seulement. `flipY = false` car l'orientation d'un ImageBitmap est fixée à
 * sa création (`imageOrientation: "flipY"` dans `browserDeps`).
 */
export function bitmapToTexture(bitmap: ImageBitmap, grid: Pick<Grid, "width" | "height">): THREE.Texture {
  if (bitmap.width !== grid.width || bitmap.height !== grid.height) {
    if (typeof bitmap.close === "function") bitmap.close();
    throw new TextureError(`texture ${bitmap.width}×${bitmap.height}, grille ${grid.width}×${grid.height} attendue`);
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
    return createImageBitmap(blob, { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
  },
  bitmapPixels,
};

/** Relit `layers/latest.json`. Non réentrant. Renvoie le manifeste s'il a changé, `null` sinon. */
export class ManifestLoader {
  private current: Manifest | null = null;
  private inflight: Promise<Manifest | null> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly deps: LoaderDeps = browserDeps,
  ) {}

  get manifest(): Manifest | null {
    return this.current;
  }

  refresh(): Promise<Manifest | null> {
    if (this.inflight) return this.inflight;
    const run = async (): Promise<Manifest | null> => {
      const m = parseManifest(await this.deps.fetchJson(`${this.baseUrl}/latest.json`));
      if (this.current && this.current.generated_at === m.generated_at) return null;
      this.current = m;
      return m;
    };
    this.inflight = run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }
}

/** PNG d'une couche : texture GPU + pixels CPU. Non réentrant. Recharge seulement si `generated_at` a changé. */
export class LayerLoader {
  private current: LoadedLayer | null = null;
  private inflight: Promise<LoadedLayer | null> | null = null;
  /** Posé par `dispose()` : un chargement en vol libère son résultat au lieu de le stocker
   * (cache LRU §10 — un loader évincé pendant son chargement ne doit pas fuir). */
  private disposed = false;

  constructor(
    readonly id: string,
    private readonly baseUrl: string,
    private readonly deps: LoaderDeps = browserDeps,
  ) {}

  get data(): LoadedLayer | null {
    return this.current;
  }

  load(entry: LayerEntry, grid: Pick<Grid, "width" | "height">): Promise<LoadedLayer | null> {
    if (this.inflight) return this.inflight;
    const run = async (): Promise<LoadedLayer | null> => {
      if (!needsTextureFetch(this.current?.entry ?? null, entry)) return null;
      const bitmap = await this.deps.fetchBitmap(textureUrl(this.baseUrl, entry));
      const texture = bitmapToTexture(bitmap, grid);
      let pixels: Uint8ClampedArray | null = null;
      try {
        pixels = this.deps.bitmapPixels(bitmap);
      } catch (e) {
        console.warn(`[worldtemp] lecture des pixels de la couche ${this.id} impossible :`, e);
      }
      if (this.disposed) {
        texture.dispose();
        if (typeof bitmap.close === "function") bitmap.close();
        return null;
      }
      this.release();
      this.current = { entry, texture, pixels };
      return this.current;
    };
    this.inflight = run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private release(): void {
    const prev = this.current;
    if (!prev) return;
    const img = prev.texture.image as ImageBitmap | undefined;
    prev.texture.dispose();
    if (img && typeof img.close === "function") img.close();
    this.current = null;
  }

  dispose(): void {
    this.disposed = true;
    this.release();
  }
}
