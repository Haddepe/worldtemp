import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { WindController } from "../src/wind/controller";
import { MAX_DT_S, TICK_MS, type WindField } from "../src/wind/sim";

const FIELD = { u: new Uint8ClampedArray(4), v: new Uint8ClampedArray(4), grid: { width: 1, height: 1 }, encU: { bits: 8, min: -60, max: 60, scale: "linear" as const }, encV: { bits: 8, min: -60, max: 60, scale: "linear" as const } } satisfies WindField;

function make() {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10);
  camera.position.set(0, 0, 1.1);
  camera.lookAt(0, 0, 0);
  const sim = { step: vi.fn() };
  const layer = { markDirty: vi.fn(), setMapStyle: vi.fn() };
  const ctl = new WindController({ sim, layer, camera, viewportHeight: () => 800, pick: () => null });
  return { ctl, sim, layer };
}

describe("WindController — spec vent §8", () => {
  it("sans champ : jamais de tick, false", () => {
    const { ctl, sim } = make();
    expect(ctl.frame(0)).toBe(false);
    expect(ctl.frame(100)).toBe(false);
    expect(sim.step).not.toHaveBeenCalled();
  });
  it("premier frame après setField amorce l'horloge sans tick ; tick une fois 33 ms écoulées", () => {
    const { ctl, sim, layer } = make();
    ctl.setField(FIELD);
    expect(ctl.frame(1000)).toBe(false);
    expect(ctl.frame(1020)).toBe(false);
    expect(ctl.frame(1040)).toBe(true);
    expect(sim.step).toHaveBeenCalledTimes(1);
    expect(sim.step.mock.calls[0]![1]).toBeCloseTo(0.04, 9);
    expect(layer.markDirty).toHaveBeenCalledTimes(1);
    expect(layer.setMapStyle).toHaveBeenCalledWith(1); // d = 1,1 < MAP_FADE_END (1,14) → style carte
  });
  it("un seul tick par frame, dt borné à MAX_DT_S", () => {
    const { ctl, sim } = make();
    ctl.setField(FIELD);
    ctl.frame(0);
    expect(ctl.frame(5000)).toBe(true);
    expect(sim.step).toHaveBeenCalledTimes(1);
    expect(sim.step.mock.calls[0]![1]).toBeCloseTo(MAX_DT_S, 9);
    expect(ctl.frame(5000 + TICK_MS / 2)).toBe(false);
  });
  it("setField(null) arrête et réamorce l'horloge au prochain champ", () => {
    const { ctl, sim } = make();
    ctl.setField(FIELD);
    ctl.frame(0);
    ctl.setField(null);
    expect(ctl.frame(1000)).toBe(false);
    ctl.setField(FIELD);
    expect(ctl.frame(2000)).toBe(false); // réamorçage : pas de tick de 1 s
    expect(ctl.frame(2040)).toBe(true);
    expect(sim.step).toHaveBeenCalledTimes(1);
    expect(sim.step.mock.calls[0]![1]).toBeCloseTo(0.04, 9);
  });
  it("la vue passée au step vient de la caméra courante", () => {
    const { ctl, sim } = make();
    ctl.setField(FIELD);
    ctl.frame(0);
    ctl.frame(40);
    const view = sim.step.mock.calls[0]![2];
    expect(view.cameraPosition.length()).toBeCloseTo(1.1, 9);
    expect(view.viewportHeight).toBe(800);
  });
});
