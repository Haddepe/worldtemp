/**
 * Tuiles forêt profondes (lot R5c) : archives `WTPK` (une par cellule de 10° × 10°) lues par
 * requêtes Range sur Hugging Face. MIROIR PYTHON : tiler/pack.py (`cell_of`, `read_directory`).
 *
 * Archive (little-endian) : en-tête 16 octets (`WTPK`, u8 version = 1, 3 nuls, u32 count, u32 nul),
 * `count` enregistrements de 16 octets (u8 z, nul, u16 x, u16 y, u16 nul, u32 offset absolu,
 * u32 length), puis les PNG. Le catalogue donne `count`, donc la longueur du répertoire
 * (16 + 16·count) : une seule requête Range par cellule, sans lecture préalable de l'en-tête.
 *
 * Hugging Face répond par une redirection 302 vers une URL signée de son CDN (≈ 1 h) ; `fetch` la
 * suit en gardant l'en-tête Range. Chaque lecture repasse par `resolve/` (≈ 0,16 s, 3 000
 * résolutions / 5 min / IP) : la réutilisation de l'URL signée n'est pas faite.
 */
import { type TileId, tileKey, tileSpan } from "./grid";
import type { DeepInfo } from "./manifest";

export interface ByteRange {
  offset: number;
  length: number;
}

export type DeepLookup = { state: "present"; range: ByteRange; url: string } | { state: "absent" } | { state: "pending" };

const HEADER_SIZE = 16;
const RECORD_SIZE = 16;
const MAGIC = [0x57, 0x54, 0x50, 0x4b]; // "WTPK"

/** Cellule 10° × 10° (`"{cx}_{cy}"`, cx 0..35, cy 0..17) contenant le centre de la tuile. */
export function cellOf(z: number, x: number, y: number): string {
  const s = tileSpan(z);
  const lon = -180 + (x + 0.5) * s;
  const lat = 90 - (y + 0.5) * s;
  return `${Math.floor((lon + 180) / 10)}_${Math.floor((90 - lat) / 10)}`;
}

/** `catalog.json` : cellule → nombre de tuiles et taille de l'archive. Cellule absente = aucune tuile. */
export function parseCatalog(json: unknown): Map<string, { count: number; bytes: number }> {
  if (typeof json !== "object" || json === null) throw new Error("catalog.json: expected an object");
  const c = json as Record<string, unknown>;
  if (c.format !== "wtpk1") throw new Error(`catalog.json: unknown format ${String(c.format)}`);
  if (typeof c.cells !== "object" || c.cells === null || Array.isArray(c.cells)) throw new Error("catalog.json: cells: expected an object");
  const out = new Map<string, { count: number; bytes: number }>();
  const uint = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
  for (const [name, v] of Object.entries(c.cells as Record<string, unknown>)) {
    const e = v as Record<string, unknown> | null;
    if (typeof e !== "object" || e === null || !uint(e.count) || !uint(e.bytes)) throw new Error(`catalog.json: cells.${name}: expected {count, bytes}`);
    out.set(name, { count: e.count, bytes: e.bytes });
  }
  return out;
}

/** Répertoire d'une archive : `tileKey` → plage du PNG dans le fichier. */
export function parseDirectory(buf: ArrayBuffer): Map<string, ByteRange> {
  if (buf.byteLength < HEADER_SIZE) throw new Error("WTPK: truncated header");
  const v = new DataView(buf);
  if (MAGIC.some((c, i) => v.getUint8(i) !== c)) throw new Error("WTPK: invalid signature");
  if (v.getUint8(4) !== 1) throw new Error(`WTPK: unknown version ${v.getUint8(4)}`);
  const count = v.getUint32(8, true);
  if (buf.byteLength < HEADER_SIZE + RECORD_SIZE * count) throw new Error(`WTPK: truncated directory (${count} records)`);
  const out = new Map<string, ByteRange>();
  for (let i = 0; i < count; i++) {
    const o = HEADER_SIZE + RECORD_SIZE * i;
    const t = { z: v.getUint8(o), x: v.getUint16(o + 2, true), y: v.getUint16(o + 4, true) };
    out.set(tileKey(t), { offset: v.getUint32(o + 8, true), length: v.getUint32(o + 12, true) });
  }
  return out;
}

/** En-tête HTTP `Range` d'une plage (bornes incluses). */
export function rangeHeader(r: ByteRange): string {
  return `bytes=${r.offset}-${r.offset + r.length - 1}`;
}

/** Lecture navigateur d'une plage : statut 206 exigé (un 200 renverrait le fichier entier). */
export async function browserFetchRange(url: string, range: ByteRange, signal: AbortSignal): Promise<ArrayBuffer> {
  const r = await fetch(url, { signal, headers: { Range: rangeHeader(range) } });
  if (r.status !== 206) throw new Error(`HTTP ${r.status} for ${url} (expected 206)`);
  return r.arrayBuffer();
}

export async function browserFetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

export interface DeepCatalogDeps {
  fetchJson(url: string, signal: AbortSignal): Promise<unknown>;
  fetchRange(url: string, range: ByteRange, signal: AbortSignal): Promise<ArrayBuffer>;
  /** Un répertoire (ou le catalogue) vient d'arriver : la vue est à recalculer. */
  onChange(): void;
  now?(): number;
  /** Après un échec (HF injoignable, 429), rien n'est redemandé pendant ce délai. */
  failureCooldownMs?: number;
}

type Cell = { state: "loading" } | { state: "ready"; dir: Map<string, ByteRange> } | { state: "failed"; until: number };

/** Délai d'une requête (catalogue ou répertoire) : au-delà, échec et refroidissement. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Catalogue et répertoires des cellules, chargés à la demande : au plus un chargement à la fois
 * par cellule (catalogue d'abord, une fois). Tant qu'il manque quelque chose : `pending`, et la
 * couche reste aux niveaux R2 (Review Focus 1, 2).
 */
export class DeepCatalog {
  private readonly now: () => number;
  private readonly cooldown: number;
  private catalog: Map<string, { count: number; bytes: number }> | null = null;
  private catalogLoading = false;
  private catalogFailedUntil = 0;
  private readonly cells = new Map<string, Cell>();
  /** Cellules demandées avant l'arrivée du catalogue : chargées dès qu'il arrive. */
  private readonly waiting = new Set<string>();

  constructor(
    private readonly info: DeepInfo,
    private readonly deps: DeepCatalogDeps,
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.cooldown = deps.failureCooldownMs ?? 30_000;
  }

  cellUrl(name: string): string {
    return `${this.info.baseUrl}/${name}.wtpk`;
  }

  lookup(t: TileId): DeepLookup {
    const name = cellOf(t.z, t.x, t.y);
    if (!this.catalog) {
      this.waiting.add(name);
      this.loadCatalog();
      return { state: "pending" };
    }
    const info = this.catalog.get(name);
    if (!info) return { state: "absent" };
    const cell = this.cells.get(name);
    if (cell?.state === "ready") {
      const range = cell.dir.get(tileKey(t));
      return range ? { state: "present", range, url: this.cellUrl(name) } : { state: "absent" };
    }
    if (cell?.state === "loading" || (cell?.state === "failed" && this.now() < cell.until)) return { state: "pending" };
    this.loadCell(name, info.count);
    return { state: "pending" };
  }

  private signal(): AbortSignal {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }

  private loadCatalog(): void {
    if (this.catalogLoading || this.now() < this.catalogFailedUntil) return;
    this.catalogLoading = true;
    this.deps
      .fetchJson(`${this.info.baseUrl}/${this.info.catalog}`, this.signal())
      .then(parseCatalog)
      .then(
        (catalog) => {
          this.catalogLoading = false;
          this.catalog = catalog;
          let changed = false;
          for (const name of this.waiting) {
            const info = catalog.get(name);
            if (info) this.loadCell(name, info.count);
            else changed = true; // pending → absent
          }
          this.waiting.clear();
          if (changed) this.deps.onChange();
        },
        () => {
          this.catalogLoading = false;
          this.catalogFailedUntil = this.now() + this.cooldown;
        },
      );
  }

  private loadCell(name: string, count: number): void {
    this.cells.set(name, { state: "loading" });
    this.deps
      .fetchRange(this.cellUrl(name), { offset: 0, length: HEADER_SIZE + RECORD_SIZE * count }, this.signal())
      .then(parseDirectory)
      .then(
        (dir) => {
          this.cells.set(name, { state: "ready", dir });
          this.deps.onChange();
        },
        () => this.cells.set(name, { state: "failed", until: this.now() + this.cooldown }),
      );
  }
}
