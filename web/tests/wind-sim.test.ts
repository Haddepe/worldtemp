import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { viewStateFrom } from "../src/tiles/lod";
import { lonLatToVec3 } from "../src/tiles/patch";
import {
  MAX_LAT, PX_PER_S_PER_MS, SPAWN_TRIES, WIND_PROFILE, isVisible, spawnOnScreen, speedScale, type PickFn,
} from "../src/wind/sim";

/** Caméra à la distance d sur +z, viewport carré, fov 45°. */
export function view(d: number, height = 800) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10);
  camera.position.set(0, 0, d);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return viewStateFrom(camera, height);
}

describe("WIND_PROFILE", () => {
  it("budgets de la spec §7", () => {
    expect(WIND_PROFILE.high).toEqual({ particles: 12000, trail: 12 });
    expect(WIND_PROFILE.low).toEqual({ particles: 3000, trail: 8 });
    expect(MAX_LAT).toBe(85);
  });
});

describe("speedScale — vitesse apparente constante", () => {
  for (const d of [4, 1.1]) {
    it(`20 m/s → 40 px/s à d = ${d}`, () => {
      const v = view(d);
      const worldPerPx = (2 * (d - 1) * Math.tan(v.fovYRad / 2)) / v.viewportHeight;
      const degPerS = speedScale(v) * 20;
      const pxPerS = ((degPerS * Math.PI) / 180) / worldPerPx;
      expect(pxPerS).toBeCloseTo(20 * PX_PER_S_PER_MS, 6);
    });
  }
  it("P injectable", () => {
    expect(speedScale(view(4), 4)).toBeCloseTo(2 * speedScale(view(4)), 9);
  });
});

describe("isVisible", () => {
  const v = view(3);
  it("point face caméra visible, face cachée invisible", () => {
    expect(isVisible(new THREE.Vector3(0, 0, 1.002), v)).toBe(true);
    expect(isVisible(new THREE.Vector3(0, 0, -1.002), v)).toBe(false);
  });
  it("point derrière l'horizon (dot < 1/d) invisible même dans le frustum", () => {
    // d = 3 : horizon à cos θ = 1/3 ; z = 0.3 est devant le limbe géométrique mais derrière l'horizon
    expect(isVisible(new THREE.Vector3(Math.sqrt(1 - 0.09), 0, 0.3), v)).toBe(false);
  });
  it("point devant l'horizon mais hors frustum invisible", () => {
    // d = 1,05 : demi-hauteur visible à la surface ≈ 0,05·tan(22,5°) = 0,021 ; y = 0,1 sort du champ, dot = 0,995 > 1/1,05
    expect(isVisible(new THREE.Vector3(0, 0.1, Math.sqrt(1 - 0.01)), view(1.05))).toBe(false);
    expect(isVisible(new THREE.Vector3(0, 0.01, Math.sqrt(1 - 0.0001)), view(1.05))).toBe(true);
  });
});

describe("spawnOnScreen", () => {
  it("tire en NDC dans [-1, 1] et accepte le premier point trouvé", () => {
    const calls: [number, number][] = [];
    const pick: PickFn = (x, y, t) => { calls.push([x, y]); return t.set(x, y, 0); };
    const seq = [0.25, 0.75];
    let i = 0;
    const rng = () => seq[i++ % 2]!;
    const target = new THREE.Vector3();
    expect(spawnOnScreen(pick, rng, target)).toBe(true);
    expect(calls).toEqual([[-0.5, 0.5]]);
    expect(target.x).toBeCloseTo(-0.5, 9);
  });
  it("8 essais puis abandon", () => {
    const pick = vi.fn<PickFn>(() => null);
    expect(spawnOnScreen(pick, Math.random, new THREE.Vector3())).toBe(false);
    expect(pick).toHaveBeenCalledTimes(SPAWN_TRIES);
  });
  it("réussit au dernier essai", () => {
    let n = 0;
    const pick: PickFn = (_x, _y, t) => (++n < SPAWN_TRIES ? null : t.set(0, 0, 1));
    expect(spawnOnScreen(pick, Math.random, new THREE.Vector3())).toBe(true);
    expect(n).toBe(SPAWN_TRIES);
  });
});
