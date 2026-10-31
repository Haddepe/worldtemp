/**
 * Chargement des tuiles (spec tuiles §5 « Chargement ») : file de priorité (niveau grossier
 * d'abord, puis distance au centre de la vue), concurrence bornée, annulation, tentatives,
 * cache LRU par budget mémoire GPU.
 */
import * as THREE from "three";
import { type TileId, parent, tileBounds, tileKey } from "./grid";
import type { TileIndex } from "./index";
import type { ForestManifest, TilesManifest } from "./manifest";
import { patchSphere } from "./patch";

export type TileSet = "sat" | "map" | "forest";

/** Jeu `forest` (spec forêt §6) : sa propre racine, son propre manifeste et son propre index. */
export interface ForestSource {
  /** Racine versionnée, ex. `https://data.globelayers.com/tiles/forest/v1.12` (tuiles sous `forest/z/x/y`). */
  baseUrl: string;
  manifest: ForestManifest;
  index: TileIndex;
}

/**
 * Tuile forêt à lire pour la tuile `t` du globe (Review Focus 3) : `t` bornée au niveau le plus fin
 * publié à cet endroit — `maxLevel` dans la bande tropicale, `maxLevelOutside` ailleurs (repli
 * stockage) —, ou `null` si l'index dit qu'elle est vide (pas de forêt : rien à dessiner, rien à
 * demander). Jamais une tuile absente de l'index : aucune requête 404 hors tropiques.
 */
export function forestTileFor(t: TileId, manifest: ForestManifest, index: TileIndex): TileId | null {
  // La bande est alignée sur la grille de `maxLevelOutside` : le centre de la tuile suffit à la situer.
  const b = tileBounds(t);
  const lon = (b.lonMin + b.lonMax) / 2;
  const lat = (b.latMin + b.latMax) / 2;
  const r = manifest.tropics;
  const tropical = lon > r.lonMin && lon < r.lonMax && lat > r.latMin && lat < r.latMax;
  const cap = Math.min(tropical ? manifest.maxLevel : manifest.maxLevelOutside, index.maxLevel);
  const k = t.z - cap;
  const q = k > 0 ? { z: cap, x: t.x >> k, y: t.y >> k } : t;
  return index.has(q.z, q.x, q.y) ? q : null;
}

export interface TileLoaderDeps {
  fetchBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const browserTileDeps: TileLoaderDeps = {
  async fetchBitmap(url, signal) {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    const blob = await r.blob();
    return createImageBitmap(blob, { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
  },
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as number),
};

export interface TileLoaderOptions {
  baseUrl: string;
  manifest: TilesManifest;
  /** `null` = pas d'index : aucune tuile `map` n'est demandée (mode repli). */
  index: TileIndex | null;
  /** Jeu `forest` ; absent tant que son manifeste n'est pas chargé (`configureForest`). */
  forest?: ForestSource | null;
  budgetBytes: number;
  concurrency: number;
  anisotropy: number;
  deps?: TileLoaderDeps;
  retryDelaysMs?: number[];
  onLoad(t: TileId): void;
}

export interface TileEntry {
  sat?: THREE.Texture;
  map?: THREE.Texture;
  forest?: THREE.Texture;
}

const SETS = ["sat", "map", "forest"] as const;

export interface Resolved {
  tile: TileId;
  texture: THREE.Texture;
}

/** RGBA 8 bits + mipmaps (× 4/3). */
export function textureBytes(width: number, height: number): number {
  return Math.round(width * height * 4 * (4 / 3));
}


type JobState = "queued" | "loading" | "waiting" | "failed";

interface Job {
  tile: TileId;
  set: TileSet;
  key: string;
  state: JobState;
  attempts: number;
  priority: number;
  controller: AbortController | null;
  timer: unknown;
}

interface Slot extends TileEntry {
  tile: TileId;
  lastUsed: number;
  bytes: number;
}

export class TileLoader {
  private readonly deps: TileLoaderDeps;
  private readonly delays: number[];
  private readonly slots = new Map<string, Slot>();
  private readonly jobs = new Map<string, Job>();
  private wanted = new Set<string>();
  private inflight = 0;
  private tick = 0;
  /** Couche Forest active : seulement alors le jeu `forest` est demandé. */
  private forestOn = false;
  usedBytes = 0;

  constructor(private opts: TileLoaderOptions) {
    this.deps = opts.deps ?? browserTileDeps;
    this.delays = opts.retryDelaysMs ?? [2000, 8000];
  }

  get(t: TileId): TileEntry | undefined {
    const s = this.slots.get(tileKey(t));
    if (s) s.lastUsed = ++this.tick;
    return s;
  }

  isOcean(t: TileId): boolean {
    const index = this.opts.index;
    if (index === null) return false;
    const m = index.maxLevel;
    const k = t.z - m;
    const q = k > 0 ? { z: m, x: t.x >> k, y: t.y >> k } : t;
    return !index.has(q.z, q.x, q.y);
  }

  /** Remplace manifeste et index (reprise après un repli sans tuiles). */
  configure(manifest: TilesManifest, index: TileIndex | null): void {
    this.opts = { ...this.opts, manifest, index };
  }

  /** Pose (ou retire) le jeu `forest`. */
  configureForest(forest: ForestSource | null): void {
    this.opts = { ...this.opts, forest };
  }

  /** Tuile forêt à lire pour `t` (voir `forestTileFor`) ; `null` sans jeu `forest` configuré. */
  forestTile(t: TileId): TileId | null {
    const f = this.opts.forest;
    return f ? forestTileFor(t, f.manifest, f.index) : null;
  }

  /**
   * Couche Forest affichée ou non. Éteinte : requêtes `forest` annulées et textures `forest` rendues
   * tout de suite (elles ne comptent plus dans le budget des tuiles voulues).
   */
  setForestEnabled(on: boolean): void {
    if (on === this.forestOn) return;
    this.forestOn = on;
    if (on) return;
    for (const [key, job] of this.jobs) {
      if (job.set === "forest") this.drop(key, job);
    }
    for (const [key, slot] of this.slots) {
      const texture = slot.forest;
      if (!texture) continue;
      slot.bytes -= this.freeTexture(texture);
      slot.forest = undefined;
      if (!slot.sat && !slot.map) this.slots.delete(key); // slot vide : rien à garder
    }
  }

  resolve(t: TileId, set: TileSet): Resolved | null {
    for (let cur: TileId | null = t; cur; cur = parent(cur)) {
      const texture = this.get(cur)?.[set];
      if (texture) return { tile: cur, texture };
    }
    return null;
  }

  update(selected: TileId[], cameraPosition: THREE.Vector3): void {
    const wanted = new Map<string, { tile: TileId; priority: number }>();
    for (const leaf of selected) {
      const dist = cameraPosition.distanceTo(patchSphere(leaf).center);
      for (let cur: TileId | null = leaf; cur; cur = parent(cur)) {
        const key = tileKey(cur);
        const priority = cur.z * 1000 + dist;
        const prev = wanted.get(key);
        if (!prev || priority < prev.priority) wanted.set(key, { tile: cur, priority });
      }
    }
    this.wanted = new Set(wanted.keys());

    for (const [key, job] of this.jobs) {
      if (!this.wanted.has(tileKey(job.tile))) this.drop(key, job);
    }

    for (const { tile, priority } of wanted.values()) {
      for (const set of SETS) if (this.needs(tile, set)) this.enqueue(tile, set, priority);
    }
    this.evict();
    this.pump();
  }

  private drop(key: string, job: Job): void {
    if (job.controller) job.controller.abort();
    if (job.timer !== null) this.deps.clearTimeout(job.timer);
    if (job.state === "loading") this.inflight--;
    this.jobs.delete(key);
  }

  private needs(tile: TileId, set: TileSet): boolean {
    if (set === "sat" && tile.z > this.opts.manifest.sat.maxLevel) return false;
    if (set === "map" && (this.opts.index === null || tile.z > this.opts.manifest.map.maxLevel || this.isOcean(tile))) return false;
    if (set === "forest") {
      // Seulement les tuiles publiées elles-mêmes : un ancêtre se demande à son tour dans la chaîne.
      const q = this.forestOn ? this.forestTile(tile) : null;
      if (q === null || q.z !== tile.z) return false;
    }
    return this.slots.get(tileKey(tile))?.[set] === undefined;
  }

  private enqueue(tile: TileId, set: TileSet, priority: number): void {
    const key = `${set}:${tileKey(tile)}`;
    const existing = this.jobs.get(key);
    if (existing) {
      existing.priority = priority;
      return;
    }
    this.jobs.set(key, { tile, set, key, state: "queued", attempts: 0, priority, controller: null, timer: null });
  }

  private pump(): void {
    const queued = [...this.jobs.values()].filter((j) => j.state === "queued").sort((a, b) => a.priority - b.priority);
    for (const job of queued) {
      if (this.inflight >= this.opts.concurrency) break;
      this.start(job);
    }
  }

  private url(job: Job): string {
    const { z, x, y } = job.tile;
    if (job.set === "forest") {
      const f = this.opts.forest!;
      return `${f.baseUrl}/forest/${z}/${x}/${y}.${f.manifest.ext}`;
    }
    const ext = this.opts.manifest[job.set].ext;
    return `${this.opts.baseUrl}/${job.set}/${z}/${x}/${y}.${ext}`;
  }

  private start(job: Job): void {
    job.state = "loading";
    job.controller = new AbortController();
    this.inflight++;
    this.deps.fetchBitmap(this.url(job), job.controller.signal).then(
      (bitmap) => {
        if (this.jobs.get(job.key) !== job) {
          if (typeof bitmap.close === "function") bitmap.close();
          return;
        }
        this.inflight--;
        this.jobs.delete(job.key);
        this.store(job, bitmap);
        this.pump();
      },
      () => {
        if (this.jobs.get(job.key) !== job) return;
        this.inflight--;
        job.attempts++;
        job.controller = null;
        const delay = this.delays[job.attempts - 1];
        if (delay === undefined) {
          job.state = "failed";
        } else {
          job.state = "waiting";
          job.timer = this.deps.setTimeout(() => {
            job.timer = null;
            if (this.jobs.get(job.key) === job) {
              job.state = "queued";
              this.pump();
            }
          }, delay);
        }
        this.pump();
      },
    );
  }

  private store(job: Job, bitmap: ImageBitmap): void {
    const texture = new THREE.Texture(bitmap);
    texture.flipY = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    if (job.set === "sat") {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.opts.anisotropy;
    } else {
      texture.colorSpace = THREE.NoColorSpace;
    }
    texture.needsUpdate = true;
    const key = tileKey(job.tile);
    let slot = this.slots.get(key);
    if (!slot) {
      slot = { tile: job.tile, lastUsed: ++this.tick, bytes: 0 };
      this.slots.set(key, slot);
    }
    slot[job.set] = texture;
    const bytes = textureBytes(bitmap.width, bitmap.height);
    slot.bytes += bytes;
    this.usedBytes += bytes;
    this.evict();
    this.opts.onLoad(job.tile);
  }

  private evict(): void {
    if (this.usedBytes <= this.opts.budgetBytes) return;
    const candidates = [...this.slots.entries()].filter(([key]) => !this.wanted.has(key)).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key, slot] of candidates) {
      if (this.usedBytes <= this.opts.budgetBytes) break;
      this.release(slot);
      this.slots.delete(key);
    }
  }

  /** Libère une texture et renvoie les octets qu'elle comptait (déduits de `usedBytes`). */
  private freeTexture(texture: THREE.Texture): number {
    const img = texture.image as ImageBitmap | undefined;
    const bytes = img ? textureBytes(img.width, img.height) : 0;
    texture.dispose();
    if (img && typeof img.close === "function") img.close();
    this.usedBytes -= bytes;
    return bytes;
  }

  private release(slot: Slot): void {
    for (const set of SETS) {
      const texture = slot[set];
      if (texture) slot.bytes -= this.freeTexture(texture);
    }
    this.usedBytes -= slot.bytes; // reste éventuel (aucun en pratique)
    slot.bytes = 0;
  }

  dispose(): void {
    for (const job of this.jobs.values()) {
      job.controller?.abort();
      if (job.timer !== null) this.deps.clearTimeout(job.timer);
    }
    this.jobs.clear();
    for (const slot of this.slots.values()) this.release(slot);
    this.slots.clear();
    this.wanted.clear();
    this.inflight = 0;
  }
}
