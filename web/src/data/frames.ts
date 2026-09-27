/**
 * Échéances de la frise (spec lot E §5.3, §5.4) : file de téléchargement partagée, jeu
 * d'échéances par couche, chargeurs. On ne garde que le canal R (1 Mo par échéance au lieu de 4).
 */
import type { Tier } from "../gpu/tier";
import { blurRedChannel } from "./blur";
import { TextureError } from "./loader";
import type { Frame, Grid } from "./manifest";

/** Téléchargements simultanés d'échéances, toutes couches confondues. */
export const FRAME_CONCURRENCY = 3;
/** Couches gardées en mémoire avec leurs échéances (profil `low` : une seule). */
export const CACHED_LAYERS: Record<Tier, number> = { high: 2, low: 1 };
/** Délai avant de retenter une échéance en échec. */
export const RETRY_AFTER_MS = 30_000;

export type Task = () => Promise<void>;

/**
 * Source de tâches auprès de laquelle le limiteur tire : `peek()` donne le rang, dans l'ordre
 * voulu courant de la source, du premier index chargeable (`null` si aucun) ; `take()` démarre
 * effectivement ce chargement.
 */
interface Source {
  peek(): number | null;
  take(): Task | null;
}

/**
 * Au plus `max` tâches en vol. Les tâches sont **tirées** auprès des sources quand une place se
 * libère : on choisit la source au rang le plus petit (position du prochain index chargeable dans
 * son propre ordre voulu — la couche 0 d'une frise en préchargement complet ne doit pas affamer le
 * vent d'une autre couche), à égalité la priorité la plus basse l'emporte, puis l'ordre
 * d'inscription. Un changement d'ordre voulu prend effet immédiatement, sans file interne à
 * réordonner.
 */
export class Limiter {
  private active = 0;
  private sources: { source: Source; priority: number }[] = [];

  constructor(readonly max: number) {
    if (!(max >= 1)) throw new Error("expected max ≥ 1");
  }

  get running(): number {
    return this.active;
  }

  add(source: Source, priority = 0): () => void {
    const s = { source, priority };
    this.sources = [...this.sources, s].sort((x, y) => x.priority - y.priority); // tri stable : priorité puis inscription
    return () => {
      this.sources = this.sources.filter((x) => x !== s);
    };
  }

  kick(): void {
    while (this.active < this.max) {
      let chosen: Source | null = null;
      let bestRank = Infinity;
      for (const s of this.sources) {
        const rank = s.source.peek();
        if (rank === null || rank >= bestRank) continue; // `>=` : à rang égal, la première trouvée (priorité puis inscription) gagne
        bestRank = rank;
        chosen = s.source;
      }
      if (!chosen) return;
      const task = chosen.take();
      if (!task) return; // ne devrait pas arriver : peek() et take() lisent le même état, sans mutation entre les deux
      this.active++;
      let result: Promise<void>;
      try {
        result = task(); // appel synchrone : une source démarre son chargement dès que la place se libère
      } catch (e) {
        result = Promise.reject(e); // tâche non conforme au contrat (jette avant de renvoyer sa promesse) : la place ne doit pas fuir
      }
      result
        .catch((e) => console.error("[worldtemp] forecast frame task failed:", e))
        .finally(() => {
          this.active--;
          this.kick();
        });
    }
  }
}

export type FrameState = "empty" | "loading" | "ready" | "failed";

interface Waiter {
  indices: number[];
  resolve: () => void;
  reject: (e: Error) => void;
}

/** Échéances d'une couche (ou du vent) pour un run donné. */
export class FrameSet<T> {
  private currentKey: string | null = null;
  private frames: readonly Frame[] = [];
  private data: (T | null)[] = [];
  private states: FrameState[] = [];
  private failedAt: number[] = [];
  private wanted: number[] = [];
  private waiters: Waiter[] = [];
  private generation = 0;
  private disposed = false;
  private readonly unregister: () => void;

  constructor(
    private readonly load: (frame: Frame, index: number) => Promise<T>,
    private readonly limiter: Limiter,
    private readonly onReady: (index: number) => void = () => {},
    private readonly now: () => number = Date.now,
    priority = 0,
  ) {
    this.unregister = limiter.add({ peek: () => this.peek(), take: () => this.take() }, priority);
  }

  /** Clé passée au dernier `setFrames` (run, generated_at) ; `null` avant le premier appel ou après
   * `dispose()` — permet à l'appelant (revue T12 round 1, finding 2) de détecter une frise dont la
   * clé n'a pas encore été mise à jour pour le manifeste courant, et de ne pas s'y fier entre-temps. */
  get key(): string | null {
    return this.currentKey;
  }

  /** Frise courante ; une autre clé (run, generated_at) oublie toutes les échéances chargées. Ignoré après dispose(). */
  setFrames(key: string, frames: readonly Frame[]): void {
    if (this.disposed) return;
    if (key === this.currentKey) return;
    this.currentKey = key;
    this.frames = frames;
    this.data = frames.map(() => null);
    this.states = frames.map((): FrameState => "empty");
    this.failedAt = frames.map(() => 0);
    this.wanted = [];
    this.generation++;
    this.rejectAll(new Error("forecast replaced"));
  }

  get length(): number {
    return this.frames.length;
  }

  get(i: number): T | null {
    return this.data[i] ?? null;
  }

  isReady(i: number): boolean {
    return this.states[i] === "ready";
  }

  /** Prête ou en échec : la lecture n'attend plus cette échéance (repli sur la voisine). */
  isSettled(i: number): boolean {
    const s = this.states[i];
    return s === "ready" || s === "failed";
  }

  stateOf(i: number): FrameState | undefined {
    return this.states[i];
  }

  /** Ordre de chargement voulu, qui remplace le précédent ; une échéance en échec depuis RETRY_AFTER_MS redevient chargeable. */
  want(order: readonly number[]): void {
    const now = this.now();
    const valid: number[] = [];
    for (const i of order) {
      if (!Number.isInteger(i) || i < 0 || i >= this.frames.length || valid.includes(i)) continue;
      if (this.states[i] === "failed" && now - this.failedAt[i]! >= RETRY_AFTER_MS) this.states[i] = "empty";
      valid.push(i);
    }
    this.wanted = valid;
    this.limiter.kick();
  }

  /** Met `indices` en tête de l'ordre voulu ; résolue quand ils sont prêts, rejetée si l'un échoue (ou déjà après dispose()). */
  ensure(indices: readonly number[]): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("forecast frames released"));
    const head = [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < this.frames.length);
    this.want([...head, ...this.wanted.filter((i) => !head.includes(i))]);
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ indices: head, resolve, reject });
      this.settle();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unregister();
    this.currentKey = null;
    this.frames = [];
    this.data = [];
    this.states = [];
    this.failedAt = [];
    this.wanted = [];
    this.rejectAll(new Error("forecast frames released"));
  }

  private settle(): void {
    this.waiters = this.waiters.filter((w) => {
      if (w.indices.some((i) => this.states[i] === "failed")) {
        w.reject(new Error("forecast frame unavailable"));
        return false;
      }
      if (w.indices.every((i) => this.states[i] === "ready")) {
        w.resolve();
        return false;
      }
      return true;
    });
  }

  private rejectAll(e: Error): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w.reject(e);
  }

  /** Rang, dans l'ordre voulu courant, du premier index chargeable ; `null` si aucun (ou après dispose()). */
  private peek(): number | null {
    if (this.disposed) return null;
    const idx = this.wanted.findIndex((j) => this.states[j] === "empty");
    return idx === -1 ? null : idx;
  }

  private take(): Task | null {
    if (this.disposed) return null;
    const i = this.wanted.find((j) => this.states[j] === "empty");
    if (i === undefined) return null;
    this.states[i] = "loading";
    const gen = this.generation;
    const frame = this.frames[i]!;
    return async () => {
      let value: T;
      try {
        value = await this.load(frame, i);
      } catch (e) {
        if (gen !== this.generation || this.disposed) return;
        console.warn(`[worldtemp] forecast frame ${frame.texture} unavailable:`, e);
        this.states[i] = "failed";
        this.failedAt[i] = this.now();
        this.settle();
        return;
      }
      if (gen !== this.generation || this.disposed) return;
      this.data[i] = value;
      this.states[i] = "ready";
      this.settle();
      this.onReady(i);
    };
  }
}

export interface FrameDeps {
  fetchBitmap(url: string): Promise<ImageBitmap>;
  /** RGBA nord en haut (`data/pixels.ts`) ; `null` si illisible. */
  bitmapPixels(bitmap: ImageBitmap): Uint8ClampedArray | null;
}

/** Canal R d'un tampon RGBA nord en haut. */
export function redChannel(rgba: ArrayLike<number>): Uint8Array {
  const n = Math.floor(rgba.length / 4);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = rgba[i * 4]!;
  return out;
}

/** URL d'une échéance : immuable, donc sans cache-busting. */
export function frameUrl(base: string, frame: Pick<Frame, "texture">): string {
  return `${base}/${frame.texture}`;
}

function close(b: ImageBitmap): void {
  if (typeof b.close === "function") b.close();
}

/** Canal R d'un PNG d'échéance ; le bitmap est fermé, succès ou échec. */
function readRed(deps: FrameDeps, bitmap: ImageBitmap, grid: Pick<Grid, "width" | "height">): Uint8Array {
  try {
    if (bitmap.width !== grid.width || bitmap.height !== grid.height) {
      throw new TextureError(`frame ${bitmap.width}×${bitmap.height}, expected grid ${grid.width}×${grid.height}`);
    }
    const rgba = deps.bitmapPixels(bitmap);
    if (!rgba || rgba.length !== grid.width * grid.height * 4) throw new Error("unreadable frame pixels");
    return redChannel(rgba);
  } finally {
    close(bitmap);
  }
}

/** Échéance d'une couche scalaire : valeurs brutes (tooltip, étiquettes) et canal rendu (flouté si `soften`). */
export interface ScalarFrame {
  /** Canal R nord en haut, `width × height`. */
  values: Uint8Array;
  /** Canal R rendu, nord en haut ; `=== values` sans flou. */
  render: Uint8Array;
}

export async function loadScalarFrame(
  deps: FrameDeps, base: string, frame: Pick<Frame, "texture">, grid: Pick<Grid, "width" | "height">, soften: number,
): Promise<ScalarFrame> {
  const values = readRed(deps, await deps.fetchBitmap(frameUrl(base, frame)), grid);
  const render = soften > 0 ? blurRedChannel(values, grid.width, grid.height, soften, false, 1) : values;
  return { values, render };
}

/** Vent : PNG U et V d'une même échéance, entrelacés `[u, v]` (spec vent §8). */
export async function loadWindFrame(
  deps: FrameDeps, base: string, frameU: Pick<Frame, "texture">, frameV: Pick<Frame, "texture">, grid: Pick<Grid, "width" | "height">,
): Promise<Uint8Array> {
  const results = await Promise.allSettled([deps.fetchBitmap(frameUrl(base, frameU)), deps.fetchBitmap(frameUrl(base, frameV))]);
  const got = results.filter((r): r is PromiseFulfilledResult<ImageBitmap> => r.status === "fulfilled").map((r) => r.value);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) {
    for (const b of got) close(b); // l'autre composante a peut-être réussi : ne pas la fuir
    throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
  }
  const [bu, bv] = got as [ImageBitmap, ImageBitmap];
  let u: Uint8Array;
  try {
    u = readRed(deps, bu, grid);
  } catch (e) {
    close(bv);
    throw e;
  }
  const v = readRed(deps, bv, grid);
  const uv = new Uint8Array(u.length * 2);
  for (let i = 0; i < u.length; i++) {
    uv[i * 2] = u[i]!;
    uv[i * 2 + 1] = v[i]!;
  }
  return uv;
}
