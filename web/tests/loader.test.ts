import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { MetadataError } from "../src/data/metadata";
import {
  DataLoader,
  TextureError,
  bitmapToTexture,
  isStale,
  needsTextureFetch,
  textureUrl,
  type LoaderDeps,
} from "../src/data/loader";
import { parseMetadata } from "../src/data/metadata";
import { SAMPLE } from "./fixtures";

const BASE = "https://example.test/gfs";
const META = parseMetadata(SAMPLE);

function fakeBitmap(width = 1440, height = 721): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

function deps(json: unknown, bitmap: ImageBitmap = fakeBitmap()): LoaderDeps & {
  fetchJson: ReturnType<typeof vi.fn>;
  fetchBitmap: ReturnType<typeof vi.fn>;
} {
  return {
    fetchJson: vi.fn(async () => JSON.parse(JSON.stringify(json))),
    fetchBitmap: vi.fn(async () => bitmap),
  };
}

describe("textureUrl", () => {
  it("cache-buste avec generated_at", () => {
    expect(textureUrl(BASE, META)).toBe(`${BASE}/latest.png?v=2026-08-30T14%3A07%3A42Z`);
  });
});

describe("needsTextureFetch", () => {
  it("premier chargement → oui", () => expect(needsTextureFetch(null, META)).toBe(true));
  it("même generated_at → non", () => expect(needsTextureFetch(META, { ...META })).toBe(false));
  it("generated_at différent → oui", () =>
    expect(needsTextureFetch(META, { ...META, generated_at: "2026-08-30T15:07:42Z" })).toBe(true));
});

describe("bitmapToTexture", () => {
  it("règle la texture comme une donnée, pas une couleur", () => {
    const t = bitmapToTexture(fakeBitmap(), META);
    expect(t.colorSpace).toBe(THREE.NoColorSpace);
    expect(t.minFilter).toBe(THREE.LinearFilter);
    expect(t.magFilter).toBe(THREE.LinearFilter);
    expect(t.generateMipmaps).toBe(false);
    expect(t.wrapS).toBe(THREE.RepeatWrapping);
    expect(t.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(t.flipY).toBe(false);
    expect(t.version).toBeGreaterThan(0); // `needsUpdate = true` incrémente `version` (pas de getter)
  });
  it("refuse une image dont les dimensions ne sont pas celles de grid", () => {
    expect(() => bitmapToTexture(fakeBitmap(1441, 721), META)).toThrowError(TextureError);
  });
});

describe("isStale", () => {
  const valid = Date.parse(META.valid_time_utc);
  const sixHours = 6 * 3600 * 1000;
  it("frais sous le seuil", () => expect(isStale(META, valid + sixHours - 1, sixHours)).toBe(false));
  it("ancien au-delà du seuil", () => expect(isStale(META, valid + sixHours + 1, sixHours)).toBe(true));
});

describe("DataLoader.refresh", () => {
  it("premier appel : JSON puis PNG, renvoie les données", async () => {
    const d = deps(SAMPLE);
    const loader = new DataLoader(BASE, d);
    const got = await loader.refresh();
    expect(got?.meta.generated_at).toBe(META.generated_at);
    expect(d.fetchJson).toHaveBeenCalledWith(`${BASE}/latest.json`);
    expect(d.fetchBitmap).toHaveBeenCalledWith(textureUrl(BASE, META));
    expect(loader.data).toBe(got);
  });

  it("generated_at identique : pas de fetch PNG, renvoie null", async () => {
    const d = deps(SAMPLE);
    const loader = new DataLoader(BASE, d);
    await loader.refresh();
    const again = await loader.refresh();
    expect(again).toBeNull();
    expect(d.fetchBitmap).toHaveBeenCalledTimes(1);
  });

  it("generated_at différent : nouveau PNG, l'ancienne texture est libérée", async () => {
    const d = deps(SAMPLE);
    const loader = new DataLoader(BASE, d);
    const first = await loader.refresh();
    const dispose = vi.spyOn(first!.texture, "dispose");
    d.fetchJson.mockResolvedValueOnce({ ...SAMPLE, generated_at: "2026-08-30T15:07:42Z" });
    const second = await loader.refresh();
    expect(second).not.toBeNull();
    expect(second?.meta.generated_at).toBe("2026-08-30T15:07:42Z");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(d.fetchBitmap).toHaveBeenCalledTimes(2);
  });

  it("generated_at différent : l'ancien ImageBitmap est fermé", async () => {
    const firstBitmap = fakeBitmap();
    const d = deps(SAMPLE, firstBitmap);
    const loader = new DataLoader(BASE, d);
    await loader.refresh();
    d.fetchJson.mockResolvedValueOnce({ ...SAMPLE, generated_at: "2026-08-30T15:07:42Z" });
    d.fetchBitmap.mockResolvedValueOnce(fakeBitmap());
    await loader.refresh();
    expect(firstBitmap.close).toHaveBeenCalledTimes(1);
  });

  it("JSON invalide : lève MetadataError, l'état courant reste intact", async () => {
    const d = deps(SAMPLE);
    const loader = new DataLoader(BASE, d);
    const first = await loader.refresh();
    d.fetchJson.mockResolvedValueOnce({ ...SAMPLE, schema_version: 2 });
    await expect(loader.refresh()).rejects.toThrowError(MetadataError);
    expect(loader.data).toBe(first);
  });

  it("PNG aux mauvaises dimensions : lève TextureError, l'état courant reste intact", async () => {
    const d = deps(SAMPLE);
    const loader = new DataLoader(BASE, d);
    const first = await loader.refresh();
    d.fetchJson.mockResolvedValueOnce({ ...SAMPLE, generated_at: "2026-08-30T15:07:42Z" });
    d.fetchBitmap.mockResolvedValueOnce(fakeBitmap(10, 10));
    await expect(loader.refresh()).rejects.toThrowError(TextureError);
    expect(loader.data).toBe(first);
  });

  it("appels concurrents : un seul fetch en vol, la même promesse pour les deux appels", async () => {
    let resolveJson!: (value: unknown) => void;
    const jsonPromise = new Promise<unknown>((resolve) => {
      resolveJson = resolve;
    });
    const fetchJson = vi.fn(() => jsonPromise);
    const fetchBitmap = vi.fn(async () => fakeBitmap());
    const loader = new DataLoader(BASE, { fetchJson, fetchBitmap });

    const p1 = loader.refresh();
    const p2 = loader.refresh();
    expect(p1).toBe(p2);

    resolveJson(SAMPLE);
    const [got1, got2] = await Promise.all([p1, p2]);
    expect(got1?.meta.generated_at).toBe(META.generated_at);
    expect(got2).toBe(got1);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchBitmap).toHaveBeenCalledTimes(1);
  });
});
