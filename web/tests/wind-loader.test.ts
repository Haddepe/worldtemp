import { describe, expect, it, vi } from "vitest";
import { TextureError } from "../src/data/loader";
import { parseManifest } from "../src/data/manifest";
import { WindLoader, type WindLoaderDeps } from "../src/wind/loader";
import { GRID, MANIFEST, WIND_ENTRIES } from "./fixtures";

const BASE = "https://example.test/layers";
const M = parseManifest({ ...MANIFEST, layers: { ...MANIFEST.layers, ...WIND_ENTRIES } });
const U = M.layers.wind_u!;
const V = M.layers.wind_v!;

function fakeBitmap(width = 1440, height = 721): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

function deps(opts: { bitmaps?: Record<string, ImageBitmap>; pixels?: (b: ImageBitmap) => Uint8ClampedArray | null; fail?: RegExp } = {}) {
  const fetchBitmap = vi.fn(async (url: string) => {
    if (opts.fail?.test(url)) throw new Error(`HTTP 500 sur ${url}`);
    return opts.bitmaps?.[url] ?? fakeBitmap();
  });
  return { fetchBitmap, bitmapPixels: opts.pixels ?? ((b) => new Uint8ClampedArray(b.width * b.height * 4)) } satisfies WindLoaderDeps;
}

describe("WindLoader — spec vent §8", () => {
  it("charge U et V ensemble, pixels à la taille de la grille, bitmaps fermés", async () => {
    const d = deps();
    const wl = new WindLoader(BASE, d);
    const f = await wl.load(U, V, GRID);
    expect(f).not.toBeNull();
    expect(d.fetchBitmap.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/wind_u.png?v=2026-09-12T14%3A12%3A40Z`, `${BASE}/wind_v.png?v=2026-09-12T14%3A12%3A40Z`,
    ]);
    expect(f!.u.length).toBe(1440 * 721 * 4);
    expect(f!.encU).toEqual(U.encoding);
    expect(f!.grid).toEqual({ width: 1440, height: 721 });
    expect(wl.field).toBe(f);
  });
  it("même generated_at : null, aucun fetch ; generated_at neuf : rechargé", async () => {
    const d = deps();
    const wl = new WindLoader(BASE, d);
    await wl.load(U, V, GRID);
    expect(await wl.load(U, V, GRID)).toBeNull();
    expect(d.fetchBitmap).toHaveBeenCalledTimes(2);
    const U2 = { ...U, generated_at: "2026-09-12T15:12:40Z" };
    const V2 = { ...V, generated_at: "2026-09-12T15:12:40Z" };
    const f2 = await wl.load(U2, V2, GRID);
    expect(f2).not.toBeNull();
    expect(d.fetchBitmap).toHaveBeenCalledTimes(4);
  });
  it("V en échec : rejet, bitmap U fermé, l'ancien champ reste", async () => {
    const d = deps();
    const wl = new WindLoader(BASE, d);
    const first = await wl.load(U, V, GRID);
    const bu = fakeBitmap();
    const failing = deps({ fail: /wind_v/, bitmaps: { [`${BASE}/wind_u.png?v=2026-09-12T14%3A12%3A40Z`]: bu } });
    const wl2 = new WindLoader(BASE, failing);
    await expect(wl2.load(U, V, GRID)).rejects.toThrow(/wind_v/);
    expect(bu.close).toHaveBeenCalled();
    expect(wl2.field).toBeNull();
    expect(wl.field).toBe(first);
  });
  it("dimensions ≠ grille : TextureError, bitmaps fermés", async () => {
    const bad = fakeBitmap(1441, 721);
    const good = fakeBitmap();
    const d = deps({ bitmaps: { [`${BASE}/wind_u.png?v=2026-09-12T14%3A12%3A40Z`]: bad, [`${BASE}/wind_v.png?v=2026-09-12T14%3A12%3A40Z`]: good } });
    await expect(new WindLoader(BASE, d).load(U, V, GRID)).rejects.toThrow(TextureError);
    expect(bad.close).toHaveBeenCalled();
    expect(good.close).toHaveBeenCalled();
  });
  it("pixels illisibles (null) : rejet", async () => {
    const d = deps({ pixels: () => null });
    await expect(new WindLoader(BASE, d).load(U, V, GRID)).rejects.toThrow(/pixels/);
  });
  it("non réentrant : deux load concurrents partagent la même promesse", async () => {
    const d = deps();
    const wl = new WindLoader(BASE, d);
    const [a, b] = await Promise.all([wl.load(U, V, GRID), wl.load(U, V, GRID)]);
    expect(a).toBe(b);
    expect(d.fetchBitmap).toHaveBeenCalledTimes(2);
  });
  it("dispose vide le champ", async () => {
    const wl = new WindLoader(BASE, deps());
    await wl.load(U, V, GRID);
    wl.dispose();
    expect(wl.field).toBeNull();
  });
});
