/**
 * Cadence de la simulation (spec vent §8) : un tick par frame au plus, quand ≥ TICK_MS se sont
 * écoulées, dt borné à MAX_DT_S. Inscrit sur SceneHandle.onFrame seulement quand le vent est actif.
 */
import type * as THREE from "three";
import type { WindLayer } from "../render/wind";
import { mapStyleFor, viewStateFrom } from "../tiles/lod";
import { MAX_DT_S, TICK_MS, type PickFn, type WindField, type WindSim } from "./sim";

export interface WindControllerDeps {
  sim: Pick<WindSim, "step">;
  layer: Pick<WindLayer, "markDirty" | "setMapStyle">;
  camera: THREE.PerspectiveCamera;
  viewportHeight(): number;
  pick: PickFn;
}

export class WindController {
  private current: WindField | null = null;
  private last: number | null = null;
  private acc = 0;

  constructor(private readonly deps: WindControllerDeps) {}

  get field(): WindField | null {
    return this.current;
  }

  setField(f: WindField | null): void {
    this.current = f;
    this.last = null;
    this.acc = 0;
  }

  /** Callback de `SceneHandle.onFrame` : `true` si un tick a eu lieu (rendu nécessaire). */
  frame(nowMs: number): boolean {
    if (!this.current) return false;
    if (this.last === null) {
      this.last = nowMs;
      return false;
    }
    this.acc += nowMs - this.last;
    this.last = nowMs;
    if (this.acc < TICK_MS) return false;
    // Le reste est reporté (30 Hz régulier sur un rAF à 60 Hz), borné à un tick après une longue
    // pause ; `dt` ne compte que le temps **consommé** par ce tick, jamais le reste reporté —
    // sinon le temps reporté serait advecté deux fois et la simulation accélérerait de 10 à 30 %.
    const carry = Math.min(this.acc - TICK_MS, TICK_MS);
    const dt = Math.min((this.acc - carry) / 1000, MAX_DT_S);
    this.acc = carry;
    const { camera, sim, layer } = this.deps;
    camera.updateMatrixWorld(true);
    const view = viewStateFrom(camera, this.deps.viewportHeight());
    sim.step(this.current, dt, view, this.deps.pick);
    layer.setMapStyle(mapStyleFor(view.cameraPosition.length()));
    layer.markDirty();
    return true;
  }
}
