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
/**
 * Budget de candidats de détail (validation navigateur T11, V1) : chaque tuile voulue et prête ne
 * fournit que ses `floor(DETAIL_BUDGET / nombre de tuiles voulues)` villes les plus peuplées. Au-delà,
 * le plafond d'affichage (`LABEL_CAP`) les rend invisibles de toute façon, mais leur fusion et leur
 * sélection coûtaient des centaines de ms à chaque tuile arrivée.
 */
export const DETAIL_BUDGET = 6000;

export interface DetailDeps {
  /** JSON de l'URL ; `null` si 404 (tuile sans ville) ; rejette sur tout autre échec. */
  fetchJson(url: string, signal: AbortSignal): Promise<unknown | null>;
  now?: () => number;
  /** Tuiles voulues pour une vue (défaut `detailTiles`) ; injectable pour compter les appels. */
  select?: (view: ViewState, enabled: boolean) => TileId[];
  /** Vecteurs unité d'une tuile, calculés une fois à son arrivée (défaut `unitVectors`) ; injectable pour compter les appels. */
  vectors?: (places: readonly Place[]) => Float32Array;
}

/** Position (3), hauteur du viewport, champ vertical, bouton Labels, plans du frustum (6 × 4). */
const SIG_LEN = 6 + 24;

/** Tout ce dont dépend `detailTiles` : deux vues de même signature donnent les mêmes tuiles. */
function writeSignature(view: ViewState, enabled: boolean, out: Float64Array): void {
  const c = view.cameraPosition;
  out[0] = c.x;
  out[1] = c.y;
  out[2] = c.z;
  out[3] = view.viewportHeight;
  out[4] = view.fovYRad;
  out[5] = enabled ? 1 : 0;
  let i = 6;
  for (const pl of view.frustum.planes) {
    out[i++] = pl.normal.x;
    out[i++] = pl.normal.y;
    out[i++] = pl.normal.z;
    out[i++] = pl.constant;
  }
}

type Entry =
  | { state: "loading"; ctrl: AbortController }
  | { state: "ready"; places: Place[]; unit: Float32Array }
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
  private readonly sig = new Float64Array(SIG_LEN);
  private readonly lastSig = new Float64Array(SIG_LEN).fill(Number.NaN);
  private ver = 0;
  private memo: { ver: number; batch: DetailBatch } | null = null;
  private readonly now: () => number;
  private readonly select: (view: ViewState, enabled: boolean) => TileId[];
  private readonly vectors: (places: readonly Place[]) => Float32Array;

  constructor(
    private readonly base: string,
    private readonly deps: DetailDeps,
    private readonly onChange: () => void,
  ) {
    this.now = deps.now ?? (() => performance.now());
    this.select = deps.select ?? detailTiles;
    this.vectors = deps.vectors ?? unitVectors;
  }

  /** Change dès que l'ensemble des villes visibles change. */
  get version(): number {
    return this.ver;
  }

  /** À chaque vue (`SceneHandle.onViewChange`). */
  update(view: ViewState, enabled: boolean): void {
    // Appelée à chaque image quand le vent anime : vue et bouton inchangés, sans échec en attente
    // de réessai → mêmes tuiles, rien à faire (relecture finale F4). Les arrivées de tuiles
    // relancent elles-mêmes `pump()` depuis `load()`.
    writeSignature(view, enabled, this.sig);
    let same = true;
    for (let i = 0; i < SIG_LEN; i++) if (this.sig[i] !== this.lastSig[i]) same = false;
    if (same && !this.hasFailed()) return;
    const moved = this.sig[0] !== this.lastSig[0] || this.sig[1] !== this.lastSig[1] || this.sig[2] !== this.lastSig[2];
    this.lastSig.set(this.sig);
    const before = this.readySignature();
    this.wanted = this.select(view, enabled);
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

  /** Villes des tuiles voulues et prêtes, par population décroissante puis nom : au plus
   * `floor(DETAIL_BUDGET / nombre de tuiles voulues)` par tuile (ses plus peuplées, les lignes d'une
   * tuile étant déjà triées). Vecteurs recopiés depuis ceux de chaque tuile, jamais recalculés. */
  current(): DetailBatch {
    if (this.memo?.ver === this.ver) return this.memo.batch;
    const k = this.wanted.length ? Math.floor(DETAIL_BUDGET / this.wanted.length) : 0;
    const refs: { p: Place; unit: Float32Array; i: number }[] = [];
    for (const t of this.wanted) {
      const e = this.entries.get(tileKey(t));
      if (e?.state !== "ready") continue;
      const n = Math.min(k, e.places.length);
      for (let i = 0; i < n; i++) refs.push({ p: e.places[i]!, unit: e.unit, i });
    }
    // ≤ DETAIL_BUDGET éléments ; tri stable : à égalité, l'ordre des tuiles voulues départage.
    refs.sort(({ p: a }, { p: b }) => b.pop - a.pop || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    let batch = EMPTY;
    if (refs.length) {
      const unit = new Float32Array(refs.length * 3);
      refs.forEach((r, j) => unit.set(r.unit.subarray(r.i * 3, r.i * 3 + 3), j * 3));
      batch = { places: refs.map((r) => r.p), unit };
    }
    this.memo = { ver: this.ver, batch };
    return batch;
  }

  private hasFailed(): boolean {
    for (const e of this.entries.values()) if (e.state === "failed") return true;
    return false;
  }

  /** Le nombre de tuiles voulues fixe la part de chaque tuile (`DETAIL_BUDGET`) : il en fait partie. */
  private readySignature(): string {
    const ready = this.wanted
      .map(tileKey)
      .filter((k) => this.entries.get(k)?.state === "ready")
      .join(";");
    return `${this.wanted.length}|${ready}`;
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
      const places = json === null ? [] : parseDetailPlaces(json);
      next = { state: "ready", places, unit: this.vectors(places) };
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
