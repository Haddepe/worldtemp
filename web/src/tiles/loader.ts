/**
 * Chargement des tuiles (spec tuiles §5 « Chargement ») : file de priorité (niveau grossier
 * d'abord, puis distance au centre de la vue), concurrence bornée, annulation, tentatives,
 * cache LRU par budget mémoire GPU.
 */
import * as THREE from "three";
import { type TileId, parent, tileKey } from "./grid";
import type { TileIndex } from "./index";
import type { TilesManifest } from "./manifest";
import { patchSphere } from "./patch";

export type TileSet = "sat" | "map";

export interface TileLoaderDeps {
  fetchBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const browserTileDeps: TileLoaderDeps = {
  async fetchBitmap(url, signal) {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
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
}

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
  usedBytes = 0;

  constructor(private readonly opts: TileLoaderOptions) {
    this.deps = opts.deps ?? browserTileDeps;
    this.delays = opts.retryDelaysMs ?? [2000, 8000];
  }

  get(t: TileId): TileEntry | undefined {
    const s = this.slots.get(tileKey(t));
    if (s) s.lastUsed = ++this.tick;
    return s;
  }

  isOcean(t: TileId): boolean {
    return this.opts.index !== null && !this.opts.index.has(t.z, t.x, t.y);
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
      if (!this.wanted.has(key.slice(4))) {
        if (job.controller) job.controller.abort();
        if (job.timer !== null) this.deps.clearTimeout(job.timer);
        if (job.state === "loading") this.inflight--;
        this.jobs.delete(key);
      }
    }

    for (const { tile, priority } of wanted.values()) {
      if (this.needs(tile, "sat")) this.enqueue(tile, "sat", priority);
      if (this.needs(tile, "map")) this.enqueue(tile, "map", priority);
    }
    this.evict();
    this.pump();
  }

  private needs(tile: TileId, set: TileSet): boolean {
    if (set === "sat" && tile.z > this.opts.manifest.sat.maxLevel) return false;
    if (set === "map" && (this.opts.index === null || tile.z > this.opts.manifest.map.maxLevel || this.isOcean(tile))) return false;
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
    const ext = this.opts.manifest[job.set].ext;
    return `${this.opts.baseUrl}/${job.set}/${job.tile.z}/${job.tile.x}/${job.tile.y}.${ext}`;
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

  private release(slot: Slot): void {
    for (const set of ["sat", "map"] as const) {
      const texture = slot[set];
      if (!texture) continue;
      const img = texture.image as ImageBitmap | undefined;
      texture.dispose();
      if (img && typeof img.close === "function") img.close();
    }
    this.usedBytes -= slot.bytes;
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
