/**
 * Vol animé de la caméra vers un lieu (spec lot F §5.3) : direction interpolée sur l'arc de sphère,
 * distance interpolée avec une montée proportionnelle à l'angle parcouru, accélération puis
 * freinage. Le vol passe par `SceneHandle.onFrame` ; toute interaction l'annule (câblage `main.ts`).
 */
import * as THREE from "three";
import { lonLatToVec3 } from "../tiles/patch";

export const FLY_MS = 1500;
export const FLY_DISTANCE = 1.15;
/** Miroir de MAX_DISTANCE (`render/scene.ts`), recopié pour ne pas tirer OrbitControls dans les tests. */
const MAX_D = 4;
/** Montée ajoutée au milieu d'un vol aux antipodes (proportionnelle à l'angle parcouru). */
const HUMP = 1;

export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const axis = new THREE.Vector3();
const q = new THREE.Quaternion();

export function flyPosition(from: THREE.Vector3, toDir: THREE.Vector3, toD: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  const e = easeInOut(t);
  const d0 = from.length();
  a.copy(from).divideScalar(d0);
  b.copy(toDir).normalize();
  const omega = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
  axis.crossVectors(a, b);
  // Antipodes (ou départ déjà au-dessus de la cible) : n'importe quel axe perpendiculaire convient.
  if (axis.lengthSq() < 1e-18) axis.crossVectors(a, Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
  q.setFromAxisAngle(axis.normalize(), omega * e);
  const d = Math.min(MAX_D, d0 + (toD - d0) * e + HUMP * (omega / Math.PI) * Math.sin(Math.PI * e));
  return out.copy(a).applyQuaternion(q).multiplyScalar(d);
}

export interface FlightDeps {
  camera: { position: THREE.Vector3; lookAt(x: number, y: number, z: number): void };
  controls: { enableDamping: boolean; update(): boolean };
  onFrame(cb: (nowMs: number) => boolean): () => void;
  requestRender(): void;
  reducedMotion(): boolean;
}

export class Flight {
  private unsub: (() => void) | null = null;
  private damping = true;

  constructor(private readonly deps: FlightDeps) {}

  get active(): boolean {
    return this.unsub !== null;
  }

  start(lon: number, lat: number, distance: number, onArrive: () => void): void {
    this.cancel();
    const { camera, controls } = this.deps;
    const toDir = lonLatToVec3(lon, lat);
    if (this.deps.reducedMotion()) {
      camera.position.copy(toDir).multiplyScalar(distance);
      camera.lookAt(0, 0, 0);
      controls.update();
      this.deps.requestRender();
      onArrive();
      return;
    }
    // Sans amortissement pendant le vol : l'inertie d'un glisser précédent est purgée tout de suite
    // et `controls.update()` de la boucle ne tire plus la caméra hors de la trajectoire.
    this.damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    const from = camera.position.clone();
    let t0: number | null = null;
    this.unsub = this.deps.onFrame((now) => {
      t0 ??= now;
      const t = Math.min(1, (now - t0) / FLY_MS);
      flyPosition(from, toDir, distance, t, camera.position);
      camera.lookAt(0, 0, 0);
      if (t >= 1) {
        this.finish();
        onArrive();
      }
      return true;
    });
    this.deps.requestRender();
  }

  cancel(): void {
    if (this.unsub) this.finish();
  }

  private finish(): void {
    this.unsub?.();
    this.unsub = null;
    this.deps.controls.enableDamping = this.damping;
    this.deps.controls.update();
  }
}
