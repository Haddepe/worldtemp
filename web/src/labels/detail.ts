/**
 * Villes de détail (spec lot F §4.1) : tuiles GeoNames `geo/cities/5/{x}/{y}.json`, chargées de
 * près seulement. Réutilise la grille et le cadrage des tuiles image (`selectTiles`), pas leur
 * chargeur (lié aux textures et au budget GPU). Logique pure : le réseau et l'horloge sont injectés.
 */
import { GEO_VERSION } from "../geo/loader";
import { type TileId, tileKey } from "../tiles/grid";
import { type ViewState, selectTiles } from "../tiles/lod";
import { type DetailBatch, type Place, parseDetailPlaces, unitVectors } from "./data";

export const DETAIL_LEVEL = 5;
/** Miroir du dernier palier de CITY_TIERS (`labels/select.ts`) : toutes les villes y sont éligibles. */
export const DETAIL_MAX_D = 1.25;
export const DETAIL_CONCURRENCY = 4;
/** Tuiles prêtes gardées hors vue (LRU). */
export const DETAIL_CACHE = 64;
/** Délai minimal avant de réessayer une tuile en échec (et seulement si la caméra a bougé, dette n° 19). */
export const DETAIL_RETRY_MS = 2000;

export interface DetailDeps {
  /** JSON de l'URL ; `null` si 404 (tuile sans ville) ; rejette sur tout autre échec. */
  fetchJson(url: string, signal: AbortSignal): Promise<unknown | null>;
  now?: () => number;
}

type Entry =
  | { state: "loading"; ctrl: AbortController }
  | { state: "ready"; places: Place[] }
  | { state: "failed"; at: number };

const EMPTY: DetailBatch = { places: [], unit: new Float32Array(0) };

export function detailTiles(view: ViewState, enabled: boolean): TileId[] {
  if (!enabled || view.cameraPosition.length() >= DETAIL_MAX_D) return [];
  // Seuil nul : la descente est forcée jusqu'au niveau 5 dans tout ce qui est visible.
  return selectTiles(view, { maxLevel: DETAIL_LEVEL, k: 0 });
}

export class DetailLabels {
  private readonly entries = new Map<string, Entry>();
  private wanted: TileId[] = [];
  private lastPos = "";
  private ver = 0;
  private memo: { ver: number; batch: DetailBatch } | null = null;
  private readonly now: () => number;

  constructor(
    private readonly base: string,
    private readonly deps: DetailDeps,
    private readonly onChange: () => void,
  ) {
    this.now = deps.now ?? (() => performance.now());
  }

  /** Change dès que l'ensemble des villes visibles change. */
  get version(): number {
    return this.ver;
  }

  /** À chaque vue (`SceneHandle.onViewChange`). */
  update(view: ViewState, enabled: boolean): void {
    const pos = view.cameraPosition.toArray().join(",");
    const moved = pos !== this.lastPos;
    this.lastPos = pos;
    const before = this.readySignature();
    this.wanted = detailTiles(view, enabled);
    const keys = new Set(this.wanted.map(tileKey));
    const now = this.now();
    for (const [key, e] of this.entries) {
      if (e.state === "loading" && !keys.has(key)) {
        e.ctrl.abort();
        this.entries.delete(key);
      } else if (e.state === "failed" && moved && now - e.at >= DETAIL_RETRY_MS) {
        this.entries.delete(key);
      }
    }
    // LRU : une tuile voulue et prête repasse en fin de Map (la plus récente).
    for (const key of keys) {
      const e = this.entries.get(key);
      if (e?.state === "ready") {
        this.entries.delete(key);
        this.entries.set(key, e);
      }
    }
    this.pump();
    this.evict(keys);
    if (this.readySignature() !== before) this.ver++;
  }

  /** Villes des tuiles voulues et prêtes, par population décroissante puis nom. */
  current(): DetailBatch {
    if (this.memo?.ver === this.ver) return this.memo.batch;
    const all: Place[] = [];
    for (const t of this.wanted) {
      const e = this.entries.get(tileKey(t));
      if (e?.state === "ready") all.push(...e.places);
    }
    all.sort((a, b) => b.pop - a.pop || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const batch = all.length ? { places: all, unit: unitVectors(all) } : EMPTY;
    this.memo = { ver: this.ver, batch };
    return batch;
  }

  private readySignature(): string {
    return this.wanted
      .map(tileKey)
      .filter((k) => this.entries.get(k)?.state === "ready")
      .join(";");
  }

  private pump(): void {
    let loading = 0;
    for (const e of this.entries.values()) if (e.state === "loading") loading++;
    for (const t of this.wanted) {
      if (loading >= DETAIL_CONCURRENCY) return;
      const key = tileKey(t);
      if (this.entries.has(key)) continue;
      const ctrl = new AbortController();
      this.entries.set(key, { state: "loading", ctrl });
      loading++;
      void this.load(t, key, ctrl);
    }
  }

  private async load(t: TileId, key: string, ctrl: AbortController): Promise<void> {
    let next: Entry;
    try {
      const json = await this.deps.fetchJson(`${this.base}/cities/${t.z}/${t.x}/${t.y}.json?v=${GEO_VERSION}`, ctrl.signal);
      next = { state: "ready", places: json === null ? [] : parseDetailPlaces(json) };
    } catch (e) {
      if (ctrl.signal.aborted) return;
      console.warn(`[worldtemp] city tile ${key} unavailable:`, e);
      next = { state: "failed", at: this.now() };
    }
    const cur = this.entries.get(key);
    if (cur?.state !== "loading" || cur.ctrl !== ctrl) return; // annulée ou remplacée entre-temps
    this.entries.delete(key);
    this.entries.set(key, next);
    this.pump();
    if (next.state === "ready" && this.wanted.some((w) => tileKey(w) === key)) {
      this.ver++;
      this.onChange();
    }
  }

  /** Garde au plus DETAIL_CACHE tuiles terminées hors vue, les plus anciennes partent d'abord. */
  private evict(keys: ReadonlySet<string>): void {
    let idle = 0;
    for (const [key, e] of this.entries) if (e.state !== "loading" && !keys.has(key)) idle++;
    for (const [key, e] of this.entries) {
      if (idle <= DETAIL_CACHE) return;
      if (e.state === "loading" || keys.has(key)) continue;
      this.entries.delete(key);
      idle--;
    }
  }
}
