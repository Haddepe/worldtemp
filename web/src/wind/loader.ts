/**
 * Chargement des deux PNG U/V du vent (spec vent §8) : pixels CPU seulement, jamais de
 * texture GPU. Les deux composantes sont remplacées ensemble. Non réentrant.
 * Les deux canaux R sont fusionnés en un seul tableau entrelacé `[u, v]` (2 Mo) : les
 * tampons RGBA (8 Mo) ne sont pas conservés.
 */
import { TextureError, browserDeps, needsTextureFetch, textureUrl } from "../data/loader";
import type { Grid, LayerEntry } from "../data/manifest";
import type { WindField } from "./sim";

export interface WindLoaderDeps {
  fetchBitmap(url: string): Promise<ImageBitmap>;
  bitmapPixels(bitmap: ImageBitmap): Uint8ClampedArray | null;
}

function close(b: ImageBitmap): void {
  if (typeof b.close === "function") b.close();
}

export class WindLoader {
  private current: { field: WindField; entryU: LayerEntry; entryV: LayerEntry } | null = null;
  private inflight: Promise<WindField | null> | null = null;
  private disposed = false;

  constructor(
    private readonly baseUrl: string,
    private readonly deps: WindLoaderDeps = browserDeps,
  ) {}

  get field(): WindField | null {
    return this.current?.field ?? null;
  }

  /** `null` si les deux entrées ont le même `generated_at` que le champ courant. Lève si l'un des PNG échoue. */
  load(entryU: LayerEntry, entryV: LayerEntry, grid: Pick<Grid, "width" | "height">): Promise<WindField | null> {
    if (this.inflight) return this.inflight;
    const run = async (): Promise<WindField | null> => {
      const prev = this.current;
      if (prev && !needsTextureFetch(prev.entryU, entryU) && !needsTextureFetch(prev.entryV, entryV)) return null;
      // `sampleUV` décode en ligne, en linéaire : un encodage racine passerait silencieusement faux
      if (entryU.encoding.scale !== "linear" || entryV.encoding.scale !== "linear") {
        throw new TextureError("non-linear wind encoding");
      }
      const results = await Promise.allSettled([
        this.deps.fetchBitmap(textureUrl(this.baseUrl, entryU)),
        this.deps.fetchBitmap(textureUrl(this.baseUrl, entryV)),
      ]);
      const got = results.filter((r): r is PromiseFulfilledResult<ImageBitmap> => r.status === "fulfilled").map((r) => r.value);
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) {
        for (const b of got) close(b); // l'autre composante a peut-être réussi : ne pas la fuir
        throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
      }
      const [bu, bv] = got as [ImageBitmap, ImageBitmap];
      try {
        for (const b of [bu, bv]) {
          if (b.width !== grid.width || b.height !== grid.height) {
            throw new TextureError(`wind ${b.width}×${b.height}, expected grid ${grid.width}×${grid.height}`);
          }
        }
        const u = this.deps.bitmapPixels(bu);
        const v = this.deps.bitmapPixels(bv);
        if (!u || !v) throw new Error("unreadable wind pixels");
        if (this.disposed) return null;
        const n = grid.width * grid.height;
        const uv = new Uint8Array(n * 2); // canal R des deux RGBA, entrelacé
        for (let i = 0; i < n; i++) {
          uv[i * 2] = u[i * 4]!;
          uv[i * 2 + 1] = v[i * 4]!;
        }
        const field: WindField = { uv, grid: { width: grid.width, height: grid.height }, encU: entryU.encoding, encV: entryV.encoding };
        this.current = { field, entryU, entryV };
        return field;
      } finally {
        close(bu);
        close(bv);
      }
    };
    this.inflight = run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  dispose(): void {
    this.disposed = true;
    this.current = null;
  }
}
