import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { WindController } from "../src/wind/controller";
import { MAX_DT_S, TICK_MS, type WindField } from "../src/wind/sim";

const FIELD = { uv: new Uint8Array(2), grid: { width: 1, height: 1 }, encU: { bits: 8, min: -60, max: 60, scale: "linear" as const }, encV: { bits: 8, min: -60, max: 60, scale: "linear" as const } } satisfies WindField;

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
    // 40 ms accumulées : un tick de 33,33 ms est consommé, les 6,67 ms restantes sont reportées
    expect(sim.step.mock.calls[0]![1]).toBeCloseTo(TICK_MS / 1000, 9);
    expect(layer.markDirty).toHaveBeenCalledTimes(1);
    expect(layer.setMapStyle).toHaveBeenCalledWith(1); // d = 1,1 < MAP_FADE_END (1,14) → style carte
  });
  it("un seul tick par frame, dt borné à MAX_DT_S, reste borné à un tick", () => {
    const { ctl, sim } = make();
    ctl.setField(FIELD);
    ctl.frame(0);
    expect(ctl.frame(5000)).toBe(true);
    expect(sim.step).toHaveBeenCalledTimes(1);
    expect(sim.step.mock.calls[0]![1]).toBeCloseTo(MAX_DT_S, 9);
    // après 5 s de pause le reste est borné à TICK_MS : la frame suivante (+16,7 ms) atteint 50 ms → tick
    expect(ctl.frame(5000 + TICK_MS / 2)).toBe(true);
    expect(sim.step).toHaveBeenCalledTimes(2);
  });
  it("le reste est reporté : 40 ms puis 30 ms font deux ticks d'un tick chacun", () => {
    const { ctl, sim } = make();
    ctl.setField(FIELD);
    ctl.frame(0);
    expect(ctl.frame(40)).toBe(true); // acc 40 → tick de TICK_MS, reste 6,67 ms
    expect(ctl.frame(70)).toBe(true); // acc 36,67 ≥ 33,33 → tick malgré un intervalle de 30 ms
    expect(sim.step).toHaveBeenCalledTimes(2);
    // dt = temps consommé (un tick), pas l'accumulateur entier : le reste n'est pas advecté deux fois
    expect(sim.step.mock.calls[0]![1]).toBeCloseTo(TICK_MS / 1000, 9);
    expect(sim.step.mock.calls[1]![1]).toBeCloseTo(TICK_MS / 1000, 9);
  });
  it("la somme des dt ne dépasse jamais le temps écoulé (aucun double comptage)", () => {
    const { ctl, sim } = make();
    ctl.setField(FIELD);
    ctl.frame(0);
    for (const t of [40, 70, 100, 130]) ctl.frame(t);
    const total = sim.step.mock.calls.reduce((a, c) => a + (c[1] as number), 0);
    expect(total).toBeLessThanOrEqual(0.13 + 1e-9);
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
    expect(sim.step.mock.calls[0]![1]).toBeCloseTo(TICK_MS / 1000, 9);
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
