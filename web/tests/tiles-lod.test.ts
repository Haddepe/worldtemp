import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TILE_SIZE, tileAt, tileKey } from "../src/tiles/grid";
import { isBeyondHorizon, mapStyleFor, projectedSidePx, selectTiles, viewStateFrom } from "../src/tiles/lod";
import { lonLatToVec3, patchSphere } from "../src/tiles/patch";

function camera(position: THREE.Vector3, viewportHeight = 900): ReturnType<typeof viewStateFrom> {
  const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.01, 10);
  cam.position.copy(position);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return viewStateFrom(cam, viewportHeight);
}

describe("horizon", () => {
  const cam = new THREE.Vector3(0, 0, 3); // regarde lon −90
  it("cache la face opposée, garde la face visible", () => {
    expect(isBeyondHorizon(patchSphere({ z: 3, x: 12, y: 3 }), cam)).toBe(true);  // lon 90..112
    expect(isBeyondHorizon(patchSphere({ z: 3, x: 4, y: 3 }), cam)).toBe(false);  // lon −90..−67
    expect(isBeyondHorizon(patchSphere({ z: 0, x: 0, y: 0 }), cam)).toBe(false);
  });
});

describe("taille projetée", () => {
  it("décroît avec la distance et le niveau", () => {
    const cam = new THREE.Vector3(0, 0, 3);
    const root = projectedSidePx(patchSphere({ z: 0, x: 0, y: 0 }), cam, 900, (45 * Math.PI) / 180);
    const child = projectedSidePx(patchSphere({ z: 1, x: 0, y: 0 }), cam, 900, (45 * Math.PI) / 180);
    expect(root).toBeGreaterThan(TILE_SIZE);
    expect(child).toBeLessThan(root);
    expect(projectedSidePx(patchSphere({ z: 1, x: 0, y: 0 }), new THREE.Vector3(0, 0, 4), 900, (45 * Math.PI) / 180)).toBeLessThan(child);
  });
});

describe("selectTiles", () => {
  it("vue globale : jamais au-delà du niveau 3, aucune tuile derrière l'horizon, niveau max respecté", () => {
    const view = camera(new THREE.Vector3(0, 0, 3));
    const tiles = selectTiles(view, { maxLevel: 8, k: 1 });
    expect(tiles.length).toBeGreaterThan(0);
    expect(Math.max(...tiles.map((t) => t.z))).toBeLessThanOrEqual(3);
    for (const t of tiles) expect(isBeyondHorizon(patchSphere(t), view.cameraPosition)).toBe(false);
    const coarse = selectTiles(view, { maxLevel: 0, k: 1 });
    expect(coarse.every((t) => t.z === 0)).toBe(true);
  });

  it("zoom Normandie : une feuille de niveau 8 contient le point visé", () => {
    const pos = lonLatToVec3(-1.62, 49.64).multiplyScalar(1.042);
    const view = camera(pos);
    const tiles = selectTiles(view, { maxLevel: 8, k: 1 });
    const keys = new Set(tiles.map(tileKey));
    expect(keys.has(tileKey(tileAt(8, -1.62, 49.64)))).toBe(true);
    expect(tiles.length).toBeLessThan(120);
  });

  it("tier low : niveau 7 max avec k = 1,5", () => {
    const view = camera(lonLatToVec3(-1.62, 49.64).multiplyScalar(1.042));
    const tiles = selectTiles(view, { maxLevel: 7, k: 1.5 });
    expect(Math.max(...tiles.map((t) => t.z))).toBe(7);
  });
});

describe("mapStyleFor", () => {
  it("0 loin, 1 près, linéaire entre 1,25 et 1,12", () => {
    expect(mapStyleFor(3)).toBe(0);
    expect(mapStyleFor(1.25)).toBe(0);
    expect(mapStyleFor(1.12)).toBe(1);
    expect(mapStyleFor(1.042)).toBe(1);
    expect(mapStyleFor(1.185)).toBeCloseTo(0.5, 6);
  });
});
