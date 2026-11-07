import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { FLY_MS, Flight, climbTarget, easeInOut, flyPosition } from "../src/render/fly";
import { lonLatToVec3 } from "../src/tiles/patch";

describe("easeInOut", () => {
  it("0 → 0, 0,5 → 0,5, 1 → 1, borné hors de [0, 1]", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });
});

describe("flyPosition", () => {
  const from = lonLatToVec3(0, 0).multiplyScalar(3);
  const to = lonLatToVec3(6.45, 48.17);

  it("t = 0 : position de départ ; t = 1 : au-dessus de la cible à la distance voulue", () => {
    const out = new THREE.Vector3();
    expect(flyPosition(from, to, 1.15, 0, out).distanceTo(from)).toBeLessThan(1e-9);
    flyPosition(from, to, 1.15, 1, out);
    expect(out.length()).toBeCloseTo(1.15, 9);
    expect(out.clone().normalize().distanceTo(to)).toBeLessThan(1e-9);
  });
  it("antipodes : trajectoire définie, qui monte en chemin sans dépasser 4", () => {
    const start = lonLatToVec3(0, 0).multiplyScalar(1.2);
    const target = lonLatToVec3(180, 0);
    const out = new THREE.Vector3();
    flyPosition(start, target, 1.15, 0.5, out);
    expect(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z)).toBe(true);
    expect(out.length()).toBeGreaterThan(1.5);
    expect(out.length()).toBeLessThanOrEqual(4);
    flyPosition(start, target, 1.15, 1, out);
    expect(out.clone().normalize().distanceTo(target)).toBeLessThan(1e-6);
  });
});

function fakeDeps(reduced = false) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 3);
  let frame: ((now: number) => boolean) | null = null;
  const unsubscribe = vi.fn(() => {
    frame = null;
  });
  const deps = {
    camera,
    controls: { enableDamping: true, update: vi.fn(() => false) },
    onFrame: vi.fn((cb: (now: number) => boolean) => {
      frame = cb;
      return unsubscribe;
    }),
    requestRender: vi.fn(),
    reducedMotion: () => reduced,
  };
  return { deps, tick: (now: number) => frame?.(now), unsubscribe, hasFrame: () => frame !== null };
}

describe("Flight", () => {
  it("anime sur FLY_MS puis arrive une fois, rend l'amortissement et se désinscrit", () => {
    const f = fakeDeps();
    const flight = new Flight(f.deps);
    const arrive = vi.fn();
    flight.start(6.45, 48.17, 1.15, arrive);
    expect(flight.active).toBe(true);
    expect(f.deps.controls.enableDamping).toBe(false);
    expect(f.tick(1000)).toBe(true);
    f.tick(1000 + FLY_MS / 2);
    expect(arrive).not.toHaveBeenCalled();
    f.tick(1000 + FLY_MS);
    expect(arrive).toHaveBeenCalledTimes(1);
    expect(f.deps.camera.position.length()).toBeCloseTo(1.15, 6);
    expect(flight.active).toBe(false);
    expect(f.unsubscribe).toHaveBeenCalled();
    expect(f.deps.controls.enableDamping).toBe(true);
  });
  it("cancel : s'arrête en place, sans arrivée", () => {
    const f = fakeDeps();
    const flight = new Flight(f.deps);
    const arrive = vi.fn();
    flight.start(6.45, 48.17, 1.15, arrive);
    f.tick(0);
    f.tick(FLY_MS / 3);
    const here = f.deps.camera.position.clone();
    flight.cancel();
    expect(f.hasFrame()).toBe(false);
    expect(arrive).not.toHaveBeenCalled();
    expect(f.deps.camera.position.equals(here)).toBe(true);
    expect(f.deps.controls.enableDamping).toBe(true);
  });
  it("un nouveau départ annule le vol en cours", () => {
    const f = fakeDeps();
    const flight = new Flight(f.deps);
    const first = vi.fn();
    flight.start(0, 0, 1.15, first);
    flight.start(10, 10, 1.15, vi.fn());
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    f.tick(0);
    f.tick(FLY_MS);
    expect(first).not.toHaveBeenCalled();
  });
  it("prefers-reduced-motion : saut direct, arrivée immédiate, aucune animation", () => {
    const f = fakeDeps(true);
    const flight = new Flight(f.deps);
    const arrive = vi.fn();
    flight.start(6.45, 48.17, 1.15, arrive);
    expect(f.deps.onFrame).not.toHaveBeenCalled();
    expect(arrive).toHaveBeenCalledTimes(1);
    expect(f.deps.camera.position.clone().normalize().distanceTo(lonLatToVec3(6.45, 48.17))).toBeLessThan(1e-9);
    expect(f.deps.requestRender).toHaveBeenCalled();
  });
  it("cancel pendant un vol : onCancel une fois, jamais onArrive (Review Focus 3)", () => {
    const f = fakeDeps();
    const flight = new Flight(f.deps);
    const arrive = vi.fn();
    const cancelled = vi.fn();
    flight.start(-60, -8, 1.042, arrive, cancelled);
    f.tick(0);
    f.tick(FLY_MS / 2);
    flight.cancel();
    flight.cancel(); // plus de vol : rien
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(arrive).not.toHaveBeenCalled();
  });
  it("arrivée : onArrive seul, onCancel jamais (même par un cancel ou un départ ultérieur)", () => {
    const f = fakeDeps();
    const flight = new Flight(f.deps);
    const arrive = vi.fn();
    const cancelled = vi.fn();
    flight.start(-60, -8, 1.042, arrive, cancelled);
    f.tick(0);
    f.tick(FLY_MS);
    flight.cancel();
    flight.start(0, 0, 1.15, vi.fn());
    expect(arrive).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });
  it("un nouveau départ pendant un vol appelle l'onCancel du vol remplacé", () => {
    const f = fakeDeps();
    const flight = new Flight(f.deps);
    const cancelled = vi.fn();
    flight.start(-60, -8, 1.042, vi.fn(), cancelled);
    flight.start(0, 0, 1.15, vi.fn());
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});

describe("climbTarget", () => {
  it("caméra sous la limite : point sous la caméra, à la limite", () => {
    const pos = lonLatToVec3(-60, -8).multiplyScalar(1.0105);
    const c = climbTarget(pos, 1.042)!;
    expect(c).not.toBeNull();
    expect(c.lon).toBeCloseTo(-60, 6);
    expect(c.lat).toBeCloseTo(-8, 6);
    expect(c.d).toBe(1.042);
  });
  it("caméra au-dessus (ou à) la limite : null", () => {
    expect(climbTarget(lonLatToVec3(-60, -8).multiplyScalar(1.3), 1.042)).toBeNull();
    expect(climbTarget(lonLatToVec3(-60, -8).multiplyScalar(1.042), 1.042)).toBeNull();
  });
});
