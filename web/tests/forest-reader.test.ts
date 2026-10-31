import { describe, expect, it, vi } from "vitest";
import { TileIndex } from "../src/tiles/index";
import type { ForestSource } from "../src/tiles/loader";
import { parseForestManifest } from "../src/tiles/manifest";
import { createTileReader, type TilePixels } from "../src/tiles/reader";

/**
 * Même jeu réduit que tiles-loader.test.ts : niveaux 0–2, niveau 2 seulement dans la bande
 * (lon −180…−90, lat 0…90), niveau 1 ailleurs. Index : 0/0/0 ; 1/0/0 et 1/1/0 ; 2/0/0 seule.
 */
const manifest = (channels = { cover: 0, year: 1, share: 2 }) =>
  parseForestManifest({
    schema_version: 1, version: "v1.12", tile_size: 512, ext: "png", index: "index.bin", max_level: 2, max_level_outside: 1,
    tropics: { lon_min: -180, lon_max: -90, lat_min: 0, lat_max: 90 }, tropics_requested: { lon_min: -170, lon_max: -100, lat_min: 10, lat_max: 80 },
    channels, year_base: 2000, threshold: 30, source: "Hansen", license: "CC BY 4.0",
    generated_at: "2026-10-31T00:00:00Z", lossyear_fallback: {},
  });

function index(): TileIndex {
  const b = new Uint8Array(6 + 1 + 1 + 4);
  b.set([0x57, 0x54, 0x49, 0x58, 1, 2, 0b01, 0b11, 0b1, 0, 0, 0]);
  return TileIndex.parse(b.buffer);
}

const BASE = "https://t.test/tiles/forest/v1.12";
const source = (channels?: { cover: number; year: number; share: number }): ForestSource => ({ baseUrl: BASE, manifest: manifest(channels), index: index() });

/** Tuile 4 × 4 RGBA (ligne 0 au nord) : un texel (col, row) porte `rgb`, les autres 0. */
function pixels(texels: Record<string, [number, number, number]>): TilePixels {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (const [k, rgb] of Object.entries(texels)) {
    const [c, r] = k.split(",").map(Number) as [number, number];
    data.set([...rgb, 255], (r * 4 + c) * 4);
  }
  return { width: 4, height: 4, data };
}

/** Décodeur factice : promesses résolues à la main, appels enregistrés. */
function decoder(tiles: Record<string, TilePixels>) {
  const calls: string[] = [];
  const pending: { url: string; resolve: () => void; reject: (e: Error) => void }[] = [];
  const decode = vi.fn((url: string) => {
    calls.push(url);
    return new Promise<TilePixels>((resolve, reject) => {
      pending.push({
        url,
        resolve: () => (tiles[url] ? resolve(tiles[url]!) : reject(new Error(`no fixture for ${url}`))),
        reject,
      });
    });
  });
  const flush = async () => {
    for (const p of pending.splice(0)) p.resolve();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { calls, pending, decode, flush };
}

// Tuile 2/0/0 : lon −180…−135, lat 45…90 ; texel (2, 1) ↔ (−153, 76.5).
const T200 = `${BASE}/forest/2/0/0.png`;
const T110 = `${BASE}/forest/1/1/0.png`;

describe("createTileReader — lecture d'un texel de tuile forêt (Review Focus 1)", () => {
  it("tuile la plus fine présente à l'index, texel exact, canaux du manifeste", async () => {
    const d = decoder({ [T200]: pixels({ "2,1": [85, 0, 0], "3,1": [60, 19, 128] }) });
    const r = createTileReader({ source: () => source(), decode: d.decode });
    const p = r.read(-153, 76.5);
    await d.flush();
    expect(await p).toEqual({ cover: 85, lossYear: null, level: 2 });
    expect(d.calls).toEqual([T200]);
    // Texel voisin (3, 1) : perte de 2019 (share > 0), lue telle quelle, sans interpolation.
    expect(await r.read(-180 + 45 * 0.8, 76.5)).toEqual({ cover: 60, lossYear: 2019, level: 2 });
    expect(d.calls).toEqual([T200]); // en cache
  });

  it("tuile la plus fine absente de l'index : null, jamais la valeur de l'ancêtre (aucune requête)", async () => {
    const d = decoder({});
    const r = createTileReader({ source: () => source(), decode: d.decode });
    // 2/1/1 (lon −135…−90, lat 0…45) est dans la bande mais vide ; 1/0/0, son ancêtre, existe.
    expect(await r.read(-100, 20)).toBeNull();
    expect(r.peek(-100, 20)).toBeNull();
    expect(d.calls).toEqual([]);
  });

  it("hors bande : niveau max_level_outside ; vide à l'index → null", async () => {
    const d = decoder({ [T110]: pixels({ "0,0": [40, 0, 0] }) });
    const r = createTileReader({ source: () => source(), decode: d.decode });
    const p = r.read(-89, 89);
    await d.flush();
    expect(await p).toEqual({ cover: 40, lossYear: null, level: 1 });
    expect(await r.read(10, 10)).toBeNull(); // 1/2/0 absent
  });

  it("part nulle : pas de perte même si l'année est posée (R4) ; canaux permutés", async () => {
    const ch = { cover: 2, year: 0, share: 1 };
    const d = decoder({ [T200]: pixels({ "2,1": [7, 0, 90], "3,1": [24, 200, 70] }) });
    const r = createTileReader({ source: () => source(ch), decode: d.decode });
    const p = r.read(-153, 76.5);
    await d.flush();
    expect(await p).toEqual({ cover: 90, lossYear: null, level: 2 });
    expect(await r.read(-144, 76.5)).toEqual({ cover: 70, lossYear: 2024, level: 2 });
  });

  it("peek : undefined tant que la tuile n'est pas décodée, la valeur ensuite", async () => {
    const d = decoder({ [T200]: pixels({ "2,1": [85, 0, 0] }) });
    const r = createTileReader({ source: () => source(), decode: d.decode });
    expect(r.peek(-153, 76.5)).toBeUndefined();
    expect(d.calls).toEqual([]); // peek ne télécharge rien
    const p = r.read(-153, 76.5);
    expect(r.peek(-153, 76.5)).toBeUndefined(); // en cours
    await d.flush();
    await p;
    expect(r.peek(-153, 76.5)).toEqual({ cover: 85, lossYear: null, level: 2 });
  });

  it("lectures simultanées : un seul décodage", async () => {
    const d = decoder({ [T200]: pixels({}) });
    const r = createTileReader({ source: () => source(), decode: d.decode });
    const a = r.read(-153, 76.5);
    const b = r.read(-150, 80);
    await d.flush();
    expect(await a).toEqual({ cover: 0, lossYear: null, level: 2 });
    expect(await b).toEqual({ cover: 0, lossYear: null, level: 2 });
    expect(d.calls).toEqual([T200]);
  });

  it("échec du décodage : rejet, rien en cache, nouvel essai à la lecture suivante", async () => {
    const d = decoder({});
    const r = createTileReader({ source: () => source(), decode: d.decode });
    const rejected = expect(r.read(-153, 76.5)).rejects.toThrow();
    await d.flush();
    await rejected;
    expect(r.peek(-153, 76.5)).toBeUndefined();
    void r.read(-153, 76.5).catch(() => {});
    expect(d.calls).toEqual([T200, T200]);
    await d.flush();
  });

  it("cache LRU borné : la tuile la moins récemment lue est évincée", async () => {
    const d = decoder({ [T200]: pixels({}), [T110]: pixels({}) });
    const r = createTileReader({ source: () => source(), decode: d.decode, cacheSize: 1 });
    const a = r.read(-153, 76.5);
    await d.flush();
    await a;
    const b = r.read(-89, 89);
    await d.flush();
    await b;
    expect(r.peek(-153, 76.5)).toBeUndefined();
    expect(r.peek(-89, 89)).toEqual({ cover: 0, lossYear: null, level: 1 });
  });

  it("sans jeu forêt : null ; jeu remplacé (autre racine) : nouvelle tuile", async () => {
    let src: ForestSource | null = null;
    const d = decoder({ [T200]: pixels({ "2,1": [85, 0, 0] }), [`https://t.test/v2/forest/2/0/0.png`]: pixels({ "2,1": [95, 0, 0] }) });
    const r = createTileReader({ source: () => src, decode: d.decode });
    expect(await r.read(-153, 76.5)).toBeNull();
    src = source();
    let p = r.read(-153, 76.5);
    await d.flush();
    expect((await p)!.cover).toBe(85);
    src = { ...source(), baseUrl: "https://t.test/v2" };
    expect(r.peek(-153, 76.5)).toBeUndefined();
    p = r.read(-153, 76.5);
    await d.flush();
    expect((await p)!.cover).toBe(95);
  });
});
