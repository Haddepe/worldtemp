import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { TileIndex } from "../src/tiles/index";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ByteRange, DeepCatalog, DeepLookup } from "../src/tiles/deep";
import { TileLoader, forestTileFor, forestTileRequest, textureBytes, type ForestSource, type TileLoaderDeps } from "../src/tiles/loader";
import { parseForestManifest, parseManifest } from "../src/tiles/manifest";
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
  calls: { url: string; signal: AbortSignal; range: ByteRange | null | undefined; resolve: (b: ImageBitmap) => void; reject: (e: Error) => void }[];
  timers: { fn: () => void; ms: number }[];
}

function harness(): Harness {
  const h: Harness = { calls: [], timers: [], deps: undefined as unknown as TileLoaderDeps };
  h.deps = {
    fetchBitmap: (url, signal, range) =>
      new Promise<ImageBitmap>((resolve, reject) => h.calls.push({ url, signal, range, resolve, reject })),
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

  it("configure remplace manifeste et index", () => {
    const h = harness();
    const l = loader(h, { index: null, manifest: { ...MANIFEST, sat: { ext: "jpg", maxLevel: -1 }, map: { ...MANIFEST.map, maxLevel: -1 } } });
    l.update([{ z: 0, x: 0, y: 0 }], cam);
    expect(h.calls.length).toBe(0);
    l.configure(MANIFEST, index());
    l.update([{ z: 0, x: 0, y: 0 }], cam);
    expect(h.calls.length).toBe(2);
  });
});

/**
 * Jeu `forest` réduit : niveaux 0–2, niveau 2 seulement dans la « bande tropicale » alignée sur la
 * grille du niveau 1 (tuile 1/0/0 : lon −180…−90, lat 0…90), niveau 1 ailleurs (repli stockage).
 * Index : 0/0/0 ; 1/0/0 et 1/1/0 ; 2/0/0 seule (2/1/1, dans la bande, est vide).
 */
const FOREST_MANIFEST = parseForestManifest({
  schema_version: 1, version: "v1.12", tile_size: 512, ext: "png", index: "index.bin", max_level: 2, max_level_outside: 1,
  tropics: { lon_min: -180, lon_max: -90, lat_min: 0, lat_max: 90 }, tropics_requested: { lon_min: -170, lon_max: -100, lat_min: 10, lat_max: 80 },
  channels: { cover: 0, year: 1, share: 2 }, year_base: 2000, threshold: 30, source: "Hansen", license: "CC BY 4.0",
  generated_at: "2026-10-31T00:00:00Z", lossyear_fallback: {},
});

function forestIndex(): TileIndex {
  const b = new Uint8Array(6 + 1 + 1 + 4);
  b.set([0x57, 0x54, 0x49, 0x58, 1, 2, 0b01, 0b11, 0b1, 0, 0, 0]);
  return TileIndex.parse(b.buffer);
}

const FOREST_BASE = "https://t.test/tiles/forest/v1.12";
const forestSource = (): ForestSource => ({ baseUrl: FOREST_BASE, manifest: FOREST_MANIFEST, index: forestIndex(), deep: null, deepMaxLevel: 2 });
const forestUrls = (h: Harness) => h.calls.map((c) => c.url).filter((u) => u.startsWith(FOREST_BASE));

describe("forestTileFor — tuile forêt à lire pour une tuile du globe (Review Focus 3)", () => {
  const src = forestSource();
  const at = (z: number, x: number, y: number) => forestTileFor({ z, x, y }, src);
  it("dans la bande : la tuile elle-même si elle est à l'index, null si elle est vide", () => {
    expect(at(2, 0, 0)).toEqual({ z: 2, x: 0, y: 0 });
    expect(at(2, 1, 1)).toBeNull();
    expect(at(3, 0, 0)).toEqual({ z: 2, x: 0, y: 0 }); // au-delà du niveau max : son ancêtre de niveau max
  });
  it("hors bande, au-delà de max_level_outside : l'ancêtre de niveau max_level_outside, jamais la tuile absente", () => {
    expect(at(2, 2, 0)).toEqual({ z: 1, x: 1, y: 0 });
    expect(at(2, 3, 1)).toEqual({ z: 1, x: 1, y: 0 });
    expect(at(2, 4, 0)).toBeNull(); // ancêtre 1/2/0 absent : pas de forêt
  });
  it("niveaux grossiers : l'index fait foi", () => {
    expect(at(1, 1, 0)).toEqual({ z: 1, x: 1, y: 0 });
    expect(at(0, 0, 0)).toEqual({ z: 0, x: 0, y: 0 });
    expect(at(0, 1, 0)).toBeNull();
  });
});

describe("TileLoader — jeu forest", () => {
  it("rien n'est demandé tant que la couche n'est pas active, ni sans source", () => {
    const h = harness();
    const l = loader(h, { forest: forestSource() });
    l.update([{ z: 2, x: 0, y: 0 }], cam);
    expect(forestUrls(h)).toEqual([]);
    const h2 = harness();
    const l2 = loader(h2);
    l2.setForestEnabled(true);
    l2.update([{ z: 2, x: 0, y: 0 }], cam);
    expect(forestUrls(h2)).toEqual([]);
    expect(l2.forestTile({ z: 2, x: 0, y: 0 })).toBeNull();
  });

  it("active : seules les tuiles présentes à l'index, à leur racine ; niveau 2 jamais demandé hors bande", () => {
    const h = harness();
    const l = loader(h, { forest: forestSource(), concurrency: 32 });
    l.setForestEnabled(true);
    l.update([{ z: 2, x: 0, y: 0 }, { z: 2, x: 2, y: 0 }, { z: 2, x: 1, y: 1 }], cam);
    expect(forestUrls(h).sort()).toEqual([
      `${FOREST_BASE}/forest/0/0/0.png`,
      `${FOREST_BASE}/forest/1/0/0.png`,
      `${FOREST_BASE}/forest/1/1/0.png`,
      `${FOREST_BASE}/forest/2/0/0.png`,
    ]);
    // sat/map inchangés à côté
    expect(h.calls.map((c) => c.url)).toContain("https://t.test/tiles/v1/map/2/0/0.png");
    expect(h.calls.map((c) => c.url)).toContain("https://t.test/tiles/v1/sat/1/0/0.jpg");
  });

  it("hors bande, la feuille de niveau 2 se résout sur l'ancêtre 1/1/0 une fois chargé", async () => {
    const h = harness();
    const l = loader(h, { forest: forestSource() });
    l.setForestEnabled(true);
    const leaf = { z: 2, x: 2, y: 0 };
    l.update([leaf], cam);
    const q = l.forestTile(leaf)!;
    expect(q).toEqual({ z: 1, x: 1, y: 0 });
    expect(l.resolve(q, "forest")).toBeNull(); // pas encore chargée : rien (le shader ne dessine pas de forêt)
    h.calls.find((c) => c.url === `${FOREST_BASE}/forest/1/1/0.png`)!.resolve(bitmap());
    await flush();
    expect(l.resolve(q, "forest")!.tile).toEqual({ z: 1, x: 1, y: 0 });
  });

  it("une requête profonde qui lève compte comme un échec : pas de fuite de concurrence, update ne lève pas", async () => {
    const h = harness();
    // Présente au choix de la tuile (needs), absente à la requête : forestTileRequest lève.
    let n = 0;
    const deep = { lookup: () => (++n <= 1 ? { state: "present" as const, url: "https://t.test/a.wtpk", range: { start: 0, end: 9 } } : { state: "absent" as const }) } as unknown as DeepCatalog;
    const l = loader(h, { forest: { ...forestSource(), deep, deepMaxLevel: 3 }, concurrency: 1 });
    l.setForestEnabled(true);
    expect(() => l.update([{ z: 3, x: 0, y: 0 }], cam)).not.toThrow();
    // Concurrence 1 : on résout les jobs grossiers un à un jusqu'à ce que le job profond soit démarré (et échoue).
    for (let i = 0; i < 20 && h.timers.length === 0; i++) {
      for (const c of h.calls.splice(0)) c.resolve(bitmap());
      await flush();
    }
    expect(h.timers.length).toBe(1); // échec du job profond : nouvel essai différé programmé
    expect(h.calls.some((c) => c.range)).toBe(false); // jamais envoyé
    // Le créneau n'a pas fui : de nouveaux jobs démarrent encore.
    expect(() => l.update([{ z: 0, x: 1, y: 0 }], cam)).not.toThrow();
    await flush();
    expect(h.calls.length).toBeGreaterThan(0);
  });

  it("une requête forêt encore voulue n'est pas annulée à la sélection suivante", () => {
    const h = harness();
    const l = loader(h, { forest: forestSource() });
    l.setForestEnabled(true);
    l.update([{ z: 2, x: 0, y: 0 }], cam);
    const deep = h.calls.find((c) => c.url === `${FOREST_BASE}/forest/2/0/0.png`)!;
    l.update([{ z: 2, x: 0, y: 0 }], cam);
    expect(deep.signal.aborted).toBe(false);
    expect(forestUrls(h).filter((u) => u === deep.url)).toHaveLength(1);
    l.update([{ z: 0, x: 1, y: 0 }], cam);
    expect(deep.signal.aborted).toBe(true);
  });

  it("textures forêt : données brutes (NoColorSpace), mipmaps et filtrage linéaire (l'année est lue au centre du texel par le shader)", async () => {
    const h = harness();
    const l = loader(h, { forest: forestSource() });
    l.setForestEnabled(true);
    l.update([{ z: 0, x: 0, y: 0 }], cam);
    for (const c of h.calls) c.resolve(bitmap());
    await flush();
    const f = l.get({ z: 0, x: 0, y: 0 })!.forest!;
    expect(f.colorSpace).toBe(THREE.NoColorSpace);
    expect(f.generateMipmaps).toBe(true);
    expect(f.magFilter).toBe(THREE.LinearFilter);
    expect(f.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(f.flipY).toBe(false);
    expect(l.usedBytes).toBe(3 * textureBytes(512, 512));
  });

  it("désactivée : requêtes forêt annulées, textures forêt rendues, sat/map gardés", async () => {
    const h = harness();
    const l = loader(h, { forest: forestSource() });
    l.setForestEnabled(true);
    l.update([{ z: 1, x: 0, y: 0 }], cam);
    for (const c of h.calls.filter((c) => !c.url.endsWith("forest/1/0/0.png"))) c.resolve(bitmap());
    await flush();
    const pending = h.calls.find((c) => c.url.endsWith("forest/1/0/0.png"))!;
    const tex = l.get({ z: 0, x: 0, y: 0 })!.forest!;
    const dispose = vi.spyOn(tex, "dispose");
    const before = l.usedBytes;
    l.setForestEnabled(false);
    expect(pending.signal.aborted).toBe(true);
    expect(dispose).toHaveBeenCalled();
    expect(l.get({ z: 0, x: 0, y: 0 })!.forest).toBeUndefined();
    expect(l.get({ z: 0, x: 0, y: 0 })!.sat).toBeDefined();
    expect(l.usedBytes).toBe(before - textureBytes(512, 512));
    const n = forestUrls(h).length;
    l.update([{ z: 1, x: 0, y: 0 }], cam);
    expect(forestUrls(h).length).toBe(n); // plus rien de neuf
    expect(l.resolve({ z: 0, x: 0, y: 0 }, "forest")).toBeNull();
  });

  it("désactivée : un slot qui ne portait que la forêt est retiré", async () => {
    const h = harness();
    const l = loader(h, { forest: forestSource() });
    l.setForestEnabled(true);
    l.update([{ z: 2, x: 0, y: 0 }], cam);
    h.calls.find((c) => c.url === `${FOREST_BASE}/forest/2/0/0.png`)!.resolve(bitmap()); // sat s'arrête au niveau 1, map pas chargé
    await flush();
    expect(l.get({ z: 2, x: 0, y: 0 })!.forest).toBeDefined();
    l.setForestEnabled(false);
    expect(l.get({ z: 2, x: 0, y: 0 })).toBeUndefined();
    expect(l.usedBytes).toBe(0);
  });

  it("configureForest pose la source après coup (manifeste forêt arrivé plus tard)", () => {
    const h = harness();
    const l = loader(h);
    l.setForestEnabled(true);
    l.configureForest(forestSource());
    l.update([{ z: 0, x: 0, y: 0 }], cam);
    expect(forestUrls(h)).toEqual([`${FOREST_BASE}/forest/0/0/0.png`]);
  });
});

/**
 * Niveaux profonds (lot R5c) sur le manifeste R2 publié (max 8 dans la bande ±30,94°, 7 ailleurs),
 * index R2 plein (tout ancêtre existe) et catalogue profond factice.
 */
const R2_MANIFEST = parseForestManifest(JSON.parse(readFileSync(join(__dirname, "fixtures", "r2-forest-manifest.json"), "utf8")));

function fullIndex(maxLevel: number): TileIndex {
  let n = 6;
  for (let z = 0; z <= maxLevel; z++) n += Math.ceil((2 ** (z + 1) * 2 ** z) / 8);
  const b = new Uint8Array(n).fill(0xff);
  b.set([0x57, 0x54, 0x49, 0x58, 1, maxLevel]);
  return TileIndex.parse(b.buffer);
}

const HF = "https://hf.test/v1.12";
/** Catalogue factice : même état pour toute tuile, appels enregistrés. */
function fakeDeep(state: "present" | "absent" | "pending") {
  const lookups: string[] = [];
  const deep = {
    lookup: (t: { z: number; x: number; y: number }): DeepLookup => {
      lookups.push(tileKey(t));
      if (state === "present") return { state, range: { offset: 100 + t.z, length: 5000 }, url: `${HF}/21_2.wtpk` };
      return { state };
    },
  } as unknown as DeepCatalog;
  return { deep, lookups };
}

const deepSource = (state: "present" | "absent" | "pending", deepMaxLevel = 9) => {
  const f = fakeDeep(state);
  const src: ForestSource = { baseUrl: FOREST_BASE, manifest: R2_MANIFEST, index: fullIndex(8), deep: f.deep, deepMaxLevel };
  return { src, lookups: f.lookups };
};

// 9/600/80 : lon 31,1, lat 61,7 (tempéré, plafond R2 7) ; 9/600/256 : lat −0,2 (tropical, plafond R2 8).
const TEMPERATE = { z: 9, x: 600, y: 80 };
const TROPICAL = { z: 9, x: 600, y: 256 };

describe("forestTileFor — niveaux profonds (lot R5c)", () => {
  it("z 9 tempéré présent au répertoire → la tuile z 9", () => {
    const { src } = deepSource("present");
    expect(forestTileFor(TEMPERATE, src)).toEqual(TEMPERATE);
    expect(forestTileFor(TROPICAL, src)).toEqual(TROPICAL);
  });
  it("répertoire pas encore chargé (pending) → tuile R2 de niveau 7, sans trou (Review Focus 1)", () => {
    const { src } = deepSource("pending");
    expect(forestTileFor(TEMPERATE, src)).toEqual({ z: 7, x: 150, y: 20 });
    expect(forestTileFor(TROPICAL, src)).toEqual({ z: 8, x: 300, y: 128 });
  });
  it("absent du répertoire → null même si l'ancêtre R2 existe (Review Focus 5)", () => {
    const { src } = deepSource("absent");
    expect(src.index.has(7, 150, 20)).toBe(true);
    expect(forestTileFor(TEMPERATE, src)).toBeNull();
    expect(forestTileFor({ z: 8, x: 300, y: 40 }, src)).toBeNull();
  });
  it("deepMaxLevel 8 (profil low) → jamais de z 9", () => {
    const { src, lookups } = deepSource("present", 8);
    expect(forestTileFor(TEMPERATE, src)).toEqual({ z: 8, x: 300, y: 40 });
    expect(forestTileFor(TROPICAL, src)).toEqual({ z: 8, x: 300, y: 128 }); // R2 : rien de profond sous 9 en tropiques
    expect(lookups.every((k) => !k.startsWith("9/"))).toBe(true);
  });
  it("niveaux R2 : le catalogue profond n'est pas consulté", () => {
    const { src, lookups } = deepSource("present");
    expect(forestTileFor({ z: 7, x: 150, y: 20 }, src)).toEqual({ z: 7, x: 150, y: 20 });
    expect(forestTileFor({ z: 8, x: 300, y: 128 }, src)).toEqual({ z: 8, x: 300, y: 128 });
    expect(lookups).toEqual([]);
  });
});

describe("forestTileRequest et loader — lecture par plage", () => {
  it("tuile profonde : URL de l'archive et plage ; tuile R2 : chemin R2 et plage nulle", () => {
    const { src } = deepSource("present");
    expect(forestTileRequest(src, TEMPERATE)).toEqual({ url: `${HF}/21_2.wtpk`, range: { offset: 109, length: 5000 } });
    expect(forestTileRequest(src, { z: 7, x: 150, y: 20 })).toEqual({ url: `${FOREST_BASE}/forest/7/150/20.png`, range: null });
  });

  it("le loader passe la plage à fetchBitmap pour une tuile profonde, null pour une tuile R2", () => {
    const h = harness();
    const { src } = deepSource("present");
    const l = loader(h, { forest: src, concurrency: 64 });
    l.setForestEnabled(true);
    l.update([{ z: 8, x: 300, y: 40 }], cam);
    const forest = h.calls.filter((c) => c.url.startsWith(FOREST_BASE) || c.url.startsWith(HF));
    const deep = forest.filter((c) => c.url.startsWith(HF));
    expect(deep).toHaveLength(1);
    expect(deep[0]!.range).toEqual({ offset: 108, length: 5000 });
    const r2 = forest.filter((c) => c.url.startsWith(FOREST_BASE));
    expect(r2.map((c) => c.url)).toContain(`${FOREST_BASE}/forest/7/150/20.png`);
    expect(r2.every((c) => c.range === null)).toBe(true);
  });

  it("cellule pas encore chargée : rien de profond demandé, l'ancêtre R2 l'est", () => {
    const h = harness();
    const { src } = deepSource("pending");
    const l = loader(h, { forest: src, concurrency: 64 });
    l.setForestEnabled(true);
    l.update([{ z: 8, x: 300, y: 40 }], cam);
    expect(h.calls.some((c) => c.url.startsWith(HF))).toBe(false);
    expect(h.calls.map((c) => c.url)).toContain(`${FOREST_BASE}/forest/7/150/20.png`);
  });
});
