import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { MetadataError, parseManifest } from "../src/data/manifest";
import {
  LayerLoader, ManifestLoader, TextureError, bitmapToTexture, isStale, needsTextureFetch, textureUrl, type LoaderDeps,
} from "../src/data/loader";
import { GRID, MANIFEST } from "./fixtures";

const BASE = "https://example.test/layers";
const M = parseManifest(MANIFEST);
const TEMP = M.layers.temp!;

function fakeBitmap(width = 1440, height = 721): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

function deps(json: unknown, bitmap: ImageBitmap = fakeBitmap(), pixels: (b: ImageBitmap) => Uint8ClampedArray | null = () => new Uint8ClampedArray(4)) {
  return {
    fetchJson: vi.fn(async () => JSON.parse(JSON.stringify(json))),
    fetchBitmap: vi.fn(async () => bitmap),
    bitmapPixels: pixels,
  } satisfies LoaderDeps;
}

describe("textureUrl / needsTextureFetch / isStale", () => {
  it("cache-buste avec le generated_at de la couche", () => {
    expect(textureUrl(BASE, TEMP)).toBe(`${BASE}/temp.png?v=2026-09-12T14%3A12%3A40Z`);
  });
  it("needsTextureFetch compare generated_at", () => {
    expect(needsTextureFetch(null, TEMP)).toBe(true);
    expect(needsTextureFetch(TEMP, { ...TEMP })).toBe(false);
    expect(needsTextureFetch(TEMP, { ...TEMP, generated_at: "2026-09-12T15:12:40Z" })).toBe(true);
  });
  it("isStale juge valid_time_utc de la couche", () => {
    const valid = Date.parse(TEMP.valid_time_utc);
    expect(isStale(TEMP, valid + 6 * 3600_000, 6 * 3600_000)).toBe(false);
    expect(isStale(TEMP, valid + 6 * 3600_000 + 1, 6 * 3600_000)).toBe(true);
  });
});

describe("bitmapToTexture", () => {
  it("texture donnée (NoColorSpace, linéaire, repeat en u, flipY false)", () => {
    const t = bitmapToTexture(fakeBitmap(), GRID);
    expect(t.colorSpace).toBe(THREE.NoColorSpace);
    expect(t.wrapS).toBe(THREE.RepeatWrapping);
    expect(t.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(t.flipY).toBe(false);
    expect(t.generateMipmaps).toBe(false);
  });
  it("refuse des dimensions ≠ grille et ferme le bitmap", () => {
    const b = fakeBitmap(1441, 721);
    expect(() => bitmapToTexture(b, GRID)).toThrowError(TextureError);
    expect(b.close).toHaveBeenCalled();
  });
});

describe("ManifestLoader", () => {
  it("premier refresh renvoie le manifeste, second identique renvoie null", async () => {
    const d = deps(MANIFEST);
    const ml = new ManifestLoader(BASE, d);
    expect(ml.manifest).toBeNull();
    const m = await ml.refresh();
    expect(m?.schema_version).toBe(2);
    expect(await ml.refresh()).toBeNull();
    expect(ml.manifest).toBe(m);
    expect(d.fetchJson).toHaveBeenCalledWith(`${BASE}/latest.json`);
  });
  it("manifeste invalide : lève et conserve l'état", async () => {
    const d = deps(MANIFEST);
    const ml = new ManifestLoader(BASE, d);
    await ml.refresh();
    d.fetchJson.mockResolvedValueOnce({ schema_version: 1 });
    await expect(ml.refresh()).rejects.toThrowError(MetadataError);
    expect(ml.manifest?.schema_version).toBe(2);
  });
  it("non réentrant : deux appels concurrents partagent la même promesse", async () => {
    const d = deps(MANIFEST);
    const ml = new ManifestLoader(BASE, d);
    const [a, b] = await Promise.all([ml.refresh(), ml.refresh()]);
    expect(a).toBe(b);
    expect(d.fetchJson).toHaveBeenCalledTimes(1);
  });
});

describe("LayerLoader", () => {
  it("charge une entrée, renvoie null si generated_at inchangé, recharge sinon", async () => {
    const d = deps(null);
    const ll = new LayerLoader("temp", BASE, d);
    const first = await ll.load(TEMP, GRID);
    expect(first?.entry).toBe(TEMP);
    expect(first?.pixels?.length).toBe(4);
    expect(d.fetchBitmap).toHaveBeenCalledWith(textureUrl(BASE, TEMP));
    expect(await ll.load({ ...TEMP }, GRID)).toBeNull();
    const next = { ...TEMP, generated_at: "2026-09-12T15:12:40Z" };
    const second = await ll.load(next, GRID);
    expect(second?.entry).toBe(next);
    expect(ll.data).toBe(second);
  });
  it("dispose libère la texture précédente et ferme son bitmap", async () => {
    const b1 = fakeBitmap();
    const d = deps(null, b1);
    const ll = new LayerLoader("temp", BASE, d);
    const first = await ll.load(TEMP, GRID);
    const disposeSpy = vi.spyOn(first!.texture, "dispose");
    d.fetchBitmap.mockResolvedValueOnce(fakeBitmap());
    await ll.load({ ...TEMP, generated_at: "2026-09-12T15:12:40Z" }, GRID);
    expect(disposeSpy).toHaveBeenCalled();
    expect(b1.close).toHaveBeenCalled();
    ll.dispose();
    expect(ll.data).toBeNull();
  });
  it("pixels indisponibles → data.pixels null, texture quand même", async () => {
    const d = deps(null, fakeBitmap(), () => { throw new Error("canvas"); });
    const ll = new LayerLoader("temp", BASE, d);
    const got = await ll.load(TEMP, GRID);
    expect(got?.pixels).toBeNull();
    expect(got?.texture).toBeInstanceOf(THREE.Texture);
  });
  it("non réentrant : deux load concurrents partagent la même promesse", async () => {
    const d = deps(null);
    const ll = new LayerLoader("temp", BASE, d);
    const [a, b] = await Promise.all([ll.load(TEMP, GRID), ll.load(TEMP, GRID)]);
    expect(a).toBe(b);
    expect(a?.entry).toBe(TEMP);
    expect(d.fetchBitmap).toHaveBeenCalledTimes(1);
  });
  it("dimensions fausses → TextureError, état inchangé", async () => {
    const d = deps(null, fakeBitmap(10, 10));
    const ll = new LayerLoader("temp", BASE, d);
    await expect(ll.load(TEMP, GRID)).rejects.toThrowError(TextureError);
    expect(ll.data).toBeNull();
  });

  it("dispose pendant un load en vol libère le résultat au lieu de le stocker (I1)", async () => {
    const bitmap = fakeBitmap();
    let resolveFetch!: (b: ImageBitmap) => void;
    const d: LoaderDeps = {
      fetchJson: vi.fn(),
      fetchBitmap: vi.fn(() => new Promise<ImageBitmap>((resolve) => { resolveFetch = resolve; })),
      bitmapPixels: () => new Uint8ClampedArray(4),
    };
    const ll = new LayerLoader("temp", BASE, d);
    const pending = ll.load(TEMP, GRID);
    ll.dispose(); // évincé du cache pendant que le PNG est encore en vol
    resolveFetch(bitmap);
    const result = await pending;
    expect(result).toBeNull();
    expect(ll.data).toBeNull(); // pas d'instance orpheline retenant texture + pixels
    expect(bitmap.close).toHaveBeenCalled();
  });
});
