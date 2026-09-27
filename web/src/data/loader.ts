import { type Forecast, parseForecast } from "./manifest";
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
  /** Lecture CPU des pixels (RGBA nord en haut) ; `null` si illisible. */
  bitmapPixels(bitmap: ImageBitmap): Uint8ClampedArray | null;
}

/** Run plus vieux que `afterMs` : statut « données anciennes » (spec lot E §6.4). */
export function isRunStale(entry: { run: string }, nowMs: number, afterMs: number): boolean {
  return nowMs - Date.parse(entry.run) > afterMs;
}

export const browserDeps: LoaderDeps = {
  async fetchJson(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
  },
  async fetchBitmap(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    const blob = await r.blob();
    return createImageBitmap(blob, { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
  },
  bitmapPixels,
};

/** Relit `layers/forecast.json`. Non réentrant. Renvoie le manifeste s'il a changé, `null` sinon. */
export class ManifestLoader {
  private current: Forecast | null = null;
  private inflight: Promise<Forecast | null> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly deps: LoaderDeps = browserDeps,
  ) {}

  get manifest(): Forecast | null {
    return this.current;
  }

  refresh(): Promise<Forecast | null> {
    if (this.inflight) return this.inflight;
    const run = async (): Promise<Forecast | null> => {
      const m = parseForecast(await this.deps.fetchJson(`${this.baseUrl}/forecast.json`));
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
