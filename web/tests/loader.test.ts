import { describe, expect, it, vi } from "vitest";
import { ManifestLoader, isRunStale, type LoaderDeps } from "../src/data/loader";
import { MetadataError, parseForecast } from "../src/data/manifest";
import { FORECAST } from "./fixtures";

const BASE = "https://example.test/layers";

function deps(json: unknown) {
  return {
    fetchJson: vi.fn(async () => JSON.parse(JSON.stringify(json))),
    fetchBitmap: vi.fn(async (): Promise<ImageBitmap> => {
      throw new Error("unused");
    }),
    bitmapPixels: () => null,
  } satisfies LoaderDeps;
}

describe("isRunStale — spec lot E §6.4", () => {
  it("juge l'âge du run", () => {
    const temp = parseForecast(FORECAST).layers.temp!;
    const run = Date.parse(temp.run);
    expect(isRunStale(temp, run + 12 * 3600_000, 12 * 3600_000)).toBe(false);
    expect(isRunStale(temp, run + 12 * 3600_000 + 1, 12 * 3600_000)).toBe(true);
  });
});

describe("ManifestLoader — forecast.json", () => {
  it("premier refresh renvoie le manifeste, second identique renvoie null", async () => {
    const d = deps(FORECAST);
    const ml = new ManifestLoader(BASE, d);
    expect(ml.manifest).toBeNull();
    const m = await ml.refresh();
    expect(m?.schema_version).toBe(3);
    expect(await ml.refresh()).toBeNull();
    expect(ml.manifest).toBe(m);
    expect(d.fetchJson).toHaveBeenCalledWith(`${BASE}/forecast.json`);
  });
  it("manifeste invalide (v2) : lève et conserve l'état", async () => {
    const d = deps(FORECAST);
    const ml = new ManifestLoader(BASE, d);
    await ml.refresh();
    d.fetchJson.mockResolvedValueOnce({ schema_version: 2 });
    await expect(ml.refresh()).rejects.toThrowError(MetadataError);
    expect(ml.manifest?.schema_version).toBe(3);
  });
  it("non réentrant : deux appels concurrents partagent la même promesse", async () => {
    const d = deps(FORECAST);
    const ml = new ManifestLoader(BASE, d);
    const [a, b] = await Promise.all([ml.refresh(), ml.refresh()]);
    expect(a).toBe(b);
    expect(d.fetchJson).toHaveBeenCalledTimes(1);
  });
});
