import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { GEO_VERSION } from "../src/geo/loader";
import { unitVectors } from "../src/labels/data";
import { DETAIL_BUDGET, DETAIL_CACHE, DETAIL_CONCURRENCY, DetailLabels, detailTiles } from "../src/labels/detail";
import { tileAt } from "../src/tiles/grid";
import { viewStateFrom } from "../src/tiles/lod";
import { lonLatToVec3 } from "../src/tiles/patch";

/** Caméra au-dessus de (lon, lat) à la distance d, viewport 1280 × 800. */
function view(lon: number, lat: number, d: number) {
  const camera = new THREE.PerspectiveCamera(45, 1280 / 800, 0.01, 100);
  camera.position.copy(lonLatToVec3(lon, lat).multiplyScalar(d));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return viewStateFrom(camera, 800);
}

const EPINAL_TILE = tileAt(5, 6.45, 48.17);
const tile = (rows: unknown[][]) => ({ version: 1, places: rows });

/** Réseau factice : chaque URL demandée reste en attente jusqu'à `resolve(url, …)` ou `reject(url)`. */
function fakeNet() {
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void; signal: AbortSignal }>();
  const fetchJson = vi.fn((url: string, signal: AbortSignal) =>
    new Promise<unknown>((resolve, reject) => pending.set(url, { resolve, reject, signal })),
  );
  const urlOf = (t: { z: number; x: number; y: number }) => `/geo/cities/${t.z}/${t.x}/${t.y}.json?v=${GEO_VERSION}`;
  return { fetchJson, pending, urlOf };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("detailTiles — quelles tuiles de détail pour une vue (spec lot F §4.1)", () => {
  it("de loin (d ≥ 1,25) : aucune", () => {
    expect(detailTiles(view(6.45, 48.17, 1.3), true)).toEqual([]);
  });
  it("étiquettes éteintes : aucune", () => {
    expect(detailTiles(view(6.45, 48.17, 1.1), false)).toEqual([]);
  });
  it("de près : tuiles de niveau 5 autour du centre, dont celle d'Épinal", () => {
    const tiles = detailTiles(view(6.45, 48.17, 1.1), true);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThan(40);
    expect(tiles.every((t) => t.z === 5)).toBe(true);
    expect(tiles).toContainEqual(EPINAL_TILE);
  });
});

describe("DetailLabels — chargement, cache, annulation", () => {
  it("charge au plus DETAIL_CONCURRENCY tuiles à la fois, avec la version dans l'URL", () => {
    const net = fakeNet();
    const detail = new DetailLabels("/geo", net, () => {});
    detail.update(view(6.45, 48.17, 1.1), true);
    expect(net.fetchJson).toHaveBeenCalledTimes(Math.min(DETAIL_CONCURRENCY, detailTiles(view(6.45, 48.17, 1.1), true).length));
    expect(net.fetchJson.mock.calls.every(([url]) => url.startsWith("/geo/cities/5/") && url.endsWith(`.json?v=${GEO_VERSION}`))).toBe(true);
  });

  it("une tuile arrivée : onChange, version incrémentée, villes dans current()", async () => {
    const net = fakeNet();
    const onChange = vi.fn();
    const detail = new DetailLabels("/geo", net, onChange);
    const v = view(6.45, 48.17, 1.05);
    detail.update(v, true);
    const url = net.urlOf(EPINAL_TILE);
    // la tuile d'Épinal peut attendre son tour : on libère les autres jusqu'à ce qu'elle parte
    for (let i = 0; i < 20 && !net.pending.has(url); i++) {
      for (const [u, p] of net.pending) if (u !== url) { p.resolve(null); net.pending.delete(u); }
      await flush();
    }
    const before = detail.version;
    net.pending.get(url)!.resolve(tile([[6.45, 48.17, "Epinal", 32188], [6.4, 48.2, "Golbey", 8000]]));
    await flush();
    expect(onChange).toHaveBeenCalled();
    expect(detail.version).toBeGreaterThan(before);
    const batch = detail.current();
    expect(batch.places.map((p) => p.name)).toEqual(expect.arrayContaining(["Epinal", "Golbey"]));
    expect(batch.unit.length).toBe(batch.places.length * 3);
    const pops = batch.places.map((p) => p.pop);
    expect(pops).toEqual([...pops].sort((a, b) => b - a));
  });

  it("404 (null) = tuile vide mémorisée : pas de second téléchargement", async () => {
    const net = fakeNet();
    const detail = new DetailLabels("/geo", net, () => {});
    const v = view(6.45, 48.17, 1.05);
    detail.update(v, true);
    const first = [...net.pending.keys()];
    for (const u of first) net.pending.get(u)!.resolve(null);
    net.pending.clear();
    await flush();
    const calls = net.fetchJson.mock.calls.length;
    detail.update(view(6.46, 48.17, 1.05), true);
    const again = net.fetchJson.mock.calls.slice(calls).map(([u]) => u);
    for (const u of first) expect(again).not.toContain(u);
  });

  it("une tuile sortie de la vue en cours de chargement est annulée", () => {
    const net = fakeNet();
    const detail = new DetailLabels("/geo", net, () => {});
    detail.update(view(6.45, 48.17, 1.1), true);
    const signals = [...net.pending.values()].map((p) => p.signal);
    detail.update(view(6.45, 48.17, 2), true); // de loin : plus aucune tuile voulue
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it("échec réseau : réessai seulement après un mouvement et DETAIL_RETRY_MS", async () => {
    const net = fakeNet();
    let t = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const detail = new DetailLabels("/geo", { fetchJson: net.fetchJson, now: () => t }, () => {});
    const v = view(6.45, 48.17, 1.05);
    detail.update(v, true);
    const [url, p] = [...net.pending.entries()][0]!;
    net.pending.clear();
    p.reject(new Error("HTTP 500"));
    await flush();
    const count = () => net.fetchJson.mock.calls.filter(([u]) => u === url).length;
    detail.update(v, true); // pas bougé
    expect(count()).toBe(1);
    detail.update(view(6.46, 48.17, 1.05), true); // bougé, mais trop tôt
    expect(count()).toBe(1);
    t = 2500;
    detail.update(view(6.47, 48.17, 1.05), true);
    expect(count()).toBe(2);
    warn.mockRestore();
  });

  it("vue et bouton inchangés : deux update identiques → une seule sélection de tuiles (relecture finale F4)", () => {
    const net = fakeNet();
    const select = vi.fn(detailTiles);
    const detail = new DetailLabels("/geo", { fetchJson: net.fetchJson, select }, () => {});
    const v = view(6.45, 48.17, 1.1);
    detail.update(v, true);
    detail.update(v, true);
    expect(select).toHaveBeenCalledTimes(1);
    detail.update(view(6.45, 48.17, 1.1), true); // même pose, autre objet : toujours rien à faire
    expect(select).toHaveBeenCalledTimes(1);
    detail.update(v, false); // bouton Labels éteint
    expect(select).toHaveBeenCalledTimes(2);
    detail.update(view(6.5, 48.17, 1.1), false); // caméra bougée
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("un échec en attente de réessai désactive le raccourci", async () => {
    const net = fakeNet();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const select = vi.fn(detailTiles);
    const detail = new DetailLabels("/geo", { fetchJson: net.fetchJson, select }, () => {});
    const v = view(6.45, 48.17, 1.05);
    detail.update(v, true);
    const [, p] = [...net.pending.entries()][0]!;
    p.reject(new Error("HTTP 500"));
    await flush();
    detail.update(v, true);
    expect(select).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("cache LRU borné à DETAIL_CACHE tuiles hors vue", async () => {
    const net = fakeNet();
    const detail = new DetailLabels("/geo", net, () => {});
    // survol d'une bande de longitudes : chaque étape charge de nouvelles tuiles
    for (let lon = -170; lon <= 170; lon += 4) {
      detail.update(view(lon, 0, 1.1), true);
      for (const [u, p] of net.pending) { p.resolve(tile([[lon, 0, `C${lon}`, 2000]])); net.pending.delete(u); }
      await flush();
    }
    expect((detail as unknown as { entries: Map<string, unknown> }).entries.size).toBeLessThanOrEqual(DETAIL_CACHE + 40);
  });
});

describe("DetailLabels — budget de candidats (validation T11, V1)", () => {
  /** `n` villes triées par population décroissante, noms préfixés par `tag`. */
  const rowsOf = (tag: string, n: number, base: number) =>
    Array.from({ length: n }, (_, i) => [((base + i) % 350) - 175 + 0.001 * i, 10, `${tag}${i}`, 1_000_000 - 7 * i - base]);
  const T = (x: number) => ({ z: 5, x, y: 10 });

  /** Tuiles voulues pilotées par `wanted` ; toutes les requêtes sont servies par `serve`. */
  async function setup(tiles: Record<number, unknown[][]>) {
    const net = fakeNet();
    let wanted = [T(1), T(2), T(3)];
    const select = vi.fn(() => wanted);
    const vectors = vi.fn(unitVectors);
    const detail = new DetailLabels("/geo", { fetchJson: net.fetchJson, select, vectors }, () => {});
    let lon = 0;
    const serve = async (list: typeof wanted) => {
      wanted = list;
      detail.update(view((lon += 1), 0, 1.1), true); // caméra bougée : nouvelle sélection
      for (let i = 0; i < 5; i++) {
        for (const [u, p] of net.pending) {
          const x = Number(u.split("/")[4]);
          p.resolve(tile(tiles[x] ?? []));
          net.pending.delete(u);
        }
        await flush();
      }
    };
    await serve(wanted);
    return { detail, vectors, serve };
  }

  it("chaque tuile voulue et prête donne au plus floor(DETAIL_BUDGET / tuiles voulues) villes, ses plus peuplées", async () => {
    const big = Math.floor(DETAIL_BUDGET / 3) + 500;
    const { detail } = await setup({ 1: rowsOf("A", big, 0), 2: rowsOf("B", big, 3), 3: rowsOf("C", 10, 5) });
    const k = Math.floor(DETAIL_BUDGET / 3);
    const names = detail.current().places.map((p) => p.name);
    expect(names.length).toBe(k + k + 10);
    expect(names.length).toBeLessThanOrEqual(DETAIL_BUDGET);
    for (const tag of ["A", "B"]) {
      const got = names.filter((n) => n.startsWith(tag));
      expect(got.length).toBe(k);
      expect(got).toContain(`${tag}0`);
      expect(got).toContain(`${tag}${k - 1}`);
      expect(got).not.toContain(`${tag}${k}`);
    }
  });

  it("ordre par population décroissante puis nom, vecteurs alignés sur les villes", async () => {
    const { detail } = await setup({ 1: rowsOf("A", 50, 0), 2: [[1, 2, "Zed", 999_993], [1, 3, "Abc", 999_993]], 3: rowsOf("C", 50, 1) });
    const batch = detail.current();
    const sorted = [...batch.places].sort((a, b) => b.pop - a.pop || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    expect(batch.places).toEqual(sorted);
    expect(batch.places.findIndex((p) => p.name === "Abc")).toBeLessThan(batch.places.findIndex((p) => p.name === "Zed"));
    expect(Array.from(batch.unit)).toEqual(Array.from(unitVectors(batch.places)));
  });

  it("vecteurs calculés une fois par tuile, pas à chaque version ; plus de tuiles voulues = part réduite", async () => {
    const big = DETAIL_BUDGET;
    const { detail, vectors, serve } = await setup({ 1: rowsOf("A", big, 0), 2: rowsOf("B", big, 3), 3: rowsOf("C", big, 5), 4: rowsOf("D", big, 7) });
    expect(vectors).toHaveBeenCalledTimes(3);
    const v1 = detail.version;
    expect(detail.current().places.length).toBe(3 * Math.floor(DETAIL_BUDGET / 3));
    await serve([T(1), T(2), T(3), T(4)]);
    expect(detail.version).toBeGreaterThan(v1);
    expect(detail.current().places.length).toBe(4 * Math.floor(DETAIL_BUDGET / 4));
    expect(vectors).toHaveBeenCalledTimes(4); // seule la nouvelle tuile
    await serve([T(1), T(2)]); // tuiles déjà prêtes : aucun recalcul
    expect(detail.current().places.length).toBe(2 * Math.floor(DETAIL_BUDGET / 2));
    expect(vectors).toHaveBeenCalledTimes(4);
  });
});
