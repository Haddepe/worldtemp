import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { GEO_VERSION } from "../src/geo/loader";
import { DETAIL_CACHE, DETAIL_CONCURRENCY, DetailLabels, detailTiles } from "../src/labels/detail";
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
