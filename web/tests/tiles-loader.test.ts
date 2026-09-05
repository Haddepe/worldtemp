import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { TileIndex } from "../src/tiles/index";
import { TileLoader, textureBytes, type TileLoaderDeps } from "../src/tiles/loader";
import { parseManifest } from "../src/tiles/manifest";
import { tileKey } from "../src/tiles/grid";

const MANIFEST = parseManifest({
  schema_version: 1, tile_size: 512,
  sets: { sat: { ext: "jpg", max_level: 1 }, map: { ext: "png", max_level: 2, index: "index.bin" } },
});

/** Index : niveau 0 (0,0) et (1,0) ; niveau 1 seulement (0,0) ; niveau 2 seulement (0,0). */
function index(): TileIndex {
  const size = 6 + 1 + 1 + 4;
  const b = new Uint8Array(size);
  b.set([0x57, 0x54, 0x49, 0x58, 1, 2, 0b11, 0b1, 0b1, 0, 0, 0]);
  return TileIndex.parse(b.buffer);
}

function bitmap(): ImageBitmap {
  return { width: 512, height: 512, close: vi.fn() } as unknown as ImageBitmap;
}

interface Harness {
  deps: TileLoaderDeps;
  calls: { url: string; signal: AbortSignal; resolve: (b: ImageBitmap) => void; reject: (e: Error) => void }[];
  timers: { fn: () => void; ms: number }[];
}

function harness(): Harness {
  const h: Harness = { calls: [], timers: [], deps: undefined as unknown as TileLoaderDeps };
  h.deps = {
    fetchBitmap: (url, signal) =>
      new Promise<ImageBitmap>((resolve, reject) => h.calls.push({ url, signal, resolve, reject })),
    setTimeout: (fn, ms) => {
      h.timers.push({ fn: fn as () => void, ms });
      return h.timers.length;
    },
    clearTimeout: vi.fn(),
  };
  return h;
}

function loader(h: Harness, over: Partial<ConstructorParameters<typeof TileLoader>[0]> = {}) {
  return new TileLoader({
    baseUrl: "https://t.test/tiles/v1", manifest: MANIFEST, index: index(), budgetBytes: 100 * textureBytes(512, 512),
    concurrency: 8, anisotropy: 4, deps: h.deps, onLoad: vi.fn(), ...over,
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const cam = new THREE.Vector3(0, 0, 3);

describe("TileLoader", () => {
  it("demande les feuilles et leurs ancêtres, niveau grossier d'abord, jeux selon manifeste et index", () => {
    const h = harness();
    const l = loader(h);
    l.update([{ z: 2, x: 0, y: 0 }, { z: 1, x: 1, y: 0 }], cam);
    const urls = h.calls.map((c) => c.url);
    expect(urls[0]).toMatch(/\/(sat|map)\/0\/0\/0\.(jpg|png)$/);
    expect(urls).toContain("https://t.test/tiles/v1/sat/0/0/0.jpg");
    expect(urls).toContain("https://t.test/tiles/v1/map/0/0/0.png");
    expect(urls).toContain("https://t.test/tiles/v1/sat/1/0/0.jpg");
    expect(urls).toContain("https://t.test/tiles/v1/map/2/0/0.png");
    expect(urls).toContain("https://t.test/tiles/v1/sat/1/1/0.jpg");       // tuile sélectionnée : sat toujours demandé
    expect(urls).not.toContain("https://t.test/tiles/v1/sat/2/0/0.jpg"); // sat s'arrête au niveau 1
    expect(urls.filter((u) => u.includes("/map/1/1/"))).toEqual([]);      // absent de l'index
  });

  it("océan connu : isOcean vrai, aucune requête map", () => {
    const h = harness();
    const l = loader(h);
    expect(l.isOcean({ z: 1, x: 1, y: 0 })).toBe(true);
    expect(l.isOcean({ z: 1, x: 0, y: 0 })).toBe(false);
    expect(l.isOcean({ z: 4, x: 1, y: 1 })).toBe(false); // sous la profondeur de l'index : ancêtre 2/0/0 présent
    expect(l.isOcean({ z: 4, x: 4, y: 0 })).toBe(true);  // ancêtre 2/1/0 absent
    l.update([{ z: 1, x: 1, y: 0 }], cam);
    expect(h.calls.map((c) => c.url)).not.toContain("https://t.test/tiles/v1/map/1/1/0.png");
  });

  it("respecte la concurrence puis vide la file", async () => {
    const h = harness();
    const l = loader(h, { concurrency: 2 });
    l.update([{ z: 1, x: 0, y: 0 }], cam);   // 2 tuiles × 2 jeux = 4 requêtes
    expect(h.calls.length).toBe(2);
    h.calls[0]!.resolve(bitmap());
    await flush();
    expect(h.calls.length).toBe(3);
  });

  it("annule une requête dont la tuile n'est plus voulue", () => {
    const h = harness();
    const l = loader(h);
    l.update([{ z: 2, x: 0, y: 0 }], cam);
    const deep = h.calls.find((c) => c.url.includes("/map/2/0/0.png"))!;
    l.update([{ z: 0, x: 1, y: 0 }], cam);
    expect(deep.signal.aborted).toBe(true);
  });

  it("réessaie à 2 s puis 8 s, puis abandonne jusqu'à ce que la tuile ressorte de la sélection", async () => {
    const h = harness();
    const l = loader(h, { retryDelaysMs: [2000, 8000] });
    l.update([{ z: 0, x: 0, y: 0 }], cam);
    const first = h.calls[0]!;
    first.reject(new Error("HTTP 503"));
    await flush();
    expect(h.timers.at(-1)!.ms).toBe(2000);
    h.timers.at(-1)!.fn();
    expect(h.calls.filter((c) => c.url === first.url).length).toBe(2);
    h.calls.at(-1)!.reject(new Error("HTTP 503"));
    await flush();
    expect(h.timers.at(-1)!.ms).toBe(8000);
    h.timers.at(-1)!.fn();
    h.calls.at(-1)!.reject(new Error("HTTP 503"));
    await flush();
    const n = h.calls.filter((c) => c.url === first.url).length;
    l.update([{ z: 0, x: 0, y: 0 }], cam);
    expect(h.calls.filter((c) => c.url === first.url).length).toBe(n);   // en échec : pas de nouvelle requête
    l.update([{ z: 0, x: 1, y: 0 }], cam);                              // sort de la sélection
    l.update([{ z: 0, x: 0, y: 0 }], cam);                              // y revient
    expect(h.calls.filter((c) => c.url === first.url).length).toBe(n + 1);
  });

  it("textures : sat en sRGB avec mipmaps et anisotropie, map en NoColorSpace ; onLoad appelé", async () => {
    const h = harness();
    const onLoad = vi.fn();
    const l = loader(h, { onLoad });
    l.update([{ z: 0, x: 0, y: 0 }], cam);
    for (const c of h.calls) c.resolve(bitmap());
    await flush();
    const e = l.get({ z: 0, x: 0, y: 0 })!;
    expect(e.sat!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(e.sat!.generateMipmaps).toBe(true);
    expect(e.sat!.anisotropy).toBe(4);
    expect(e.sat!.flipY).toBe(false);
    expect(e.map!.colorSpace).toBe(THREE.NoColorSpace);
    expect(onLoad).toHaveBeenCalledWith({ z: 0, x: 0, y: 0 });
    expect(l.usedBytes).toBe(2 * textureBytes(512, 512));
  });

  it("resolve remonte à l'ancêtre chargé le plus proche", async () => {
    const h = harness();
    const l = loader(h);
    l.update([{ z: 2, x: 0, y: 0 }], cam);
    for (const c of h.calls) if (c.url.includes("/0/0/0.")) c.resolve(bitmap());
    await flush();
    const r = l.resolve({ z: 2, x: 0, y: 0 }, "sat")!;
    expect(tileKey(r.tile)).toBe("0/0/0");
    expect(l.resolve({ z: 2, x: 0, y: 0 }, "map")!.tile).toEqual({ z: 0, x: 0, y: 0 });
    expect(l.resolve({ z: 0, x: 1, y: 0 }, "sat")).toBeNull();
  });

  it("évince les tuiles non voulues les moins récentes quand le budget déborde, jamais les voulues", async () => {
    const h = harness();
    const l = loader(h, { budgetBytes: 3 * textureBytes(512, 512) });
    l.update([{ z: 0, x: 0, y: 0 }], cam);          // 2 textures
    for (const c of h.calls) c.resolve(bitmap());
    await flush();
    const old = l.get({ z: 0, x: 0, y: 0 })!;
    const disposeSat = vi.spyOn(old.sat!, "dispose");
    l.update([{ z: 0, x: 1, y: 0 }], cam);          // + 2 textures voulues
    h.calls.find((c) => c.url.includes("/sat/0/1/0."))!.resolve(bitmap());
    await flush();                                   // usedBytes = 3, pas encore d'éviction
    l.get({ z: 0, x: 0, y: 0 });                     // la tuile non voulue redevient la plus récente
    h.calls.find((c) => c.url.includes("/map/0/1/0."))!.resolve(bitmap());
    await flush();                                   // usedBytes 4 > 3 : évince 0/0/0 (non voulue), pas 0/1/0
    expect(l.get({ z: 0, x: 0, y: 0 })).toBeUndefined();
    expect(disposeSat).toHaveBeenCalled();
    expect((old.sat!.image as ImageBitmap).close).toHaveBeenCalled();
    expect(l.get({ z: 0, x: 1, y: 0 })).toBeDefined();
    expect(l.usedBytes).toBe(2 * textureBytes(512, 512));
  });
});
