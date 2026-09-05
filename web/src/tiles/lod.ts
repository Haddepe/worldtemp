/** Sélection des feuilles à afficher pour une caméra (spec tuiles §5 « Sélection »). */
import * as THREE from "three";
import { TILE_SIZE, type TileId, children } from "./grid";
import { type PatchSphere, patchSphere } from "./patch";

export interface ViewState {
  cameraPosition: THREE.Vector3;
  frustum: THREE.Frustum;
  viewportHeight: number;
  fovYRad: number;
}

export interface LodOptions {
  maxLevel: number;
  /** Seuil de descente : on descend si la tuile projetée dépasse `TILE_SIZE · k` px. */
  k: number;
}

export function viewStateFrom(camera: THREE.PerspectiveCamera, viewportHeight: number): ViewState {
  const frustum = new THREE.Frustum();
  frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  return {
    cameraPosition: camera.position.clone(),
    frustum,
    viewportHeight,
    fovYRad: (camera.fov * Math.PI) / 180,
  };
}

/**
 * Sphère unité : un point P̂ est derrière l'horizon si dot(P̂, Ĉ) < 1 / |C|. La sphère
 * englobante entière est derrière si dot(centre, Ĉ) + rayon < 1 / |C|.
 */
export function isBeyondHorizon(sphere: PatchSphere, cameraPosition: THREE.Vector3): boolean {
  const dist = cameraPosition.length();
  const camDir = cameraPosition.clone().divideScalar(dist);
  return sphere.center.dot(camDir) + sphere.radius < 1 / dist;
}

/** Côté de la tuile projeté à l'écran (px), depuis le diamètre projeté de sa sphère englobante (÷ √2). */
export function projectedSidePx(sphere: PatchSphere, cameraPosition: THREE.Vector3, viewportHeight: number, fovYRad: number): number {
  const dist = Math.max(1e-6, cameraPosition.distanceTo(sphere.center));
  const diameterPx = (2 * sphere.radius * viewportHeight) / (2 * dist * Math.tan(fovYRad / 2));
  return diameterPx / Math.SQRT2;
}

const tmpSphere = new THREE.Sphere();

export function selectTiles(view: ViewState, opts: LodOptions): TileId[] {
  const out: TileId[] = [];
  const stack: TileId[] = [{ z: 0, x: 1, y: 0 }, { z: 0, x: 0, y: 0 }];
  while (stack.length) {
    const t = stack.pop()!;
    const s = patchSphere(t);
    tmpSphere.set(s.center, s.radius);
    if (!view.frustum.intersectsSphere(tmpSphere)) continue;
    if (isBeyondHorizon(s, view.cameraPosition)) continue;
    if (t.z < opts.maxLevel && projectedSidePx(s, view.cameraPosition, view.viewportHeight, view.fovYRad) > TILE_SIZE * opts.k) {
      stack.push(...children(t));
    } else {
      out.push(t);
    }
  }
  return out;
}

/** Fondu vers le style carte selon la distance caméra–centre (spec §6) : 0 au-delà de 1,25, 1 sous 1,12. */
export function mapStyleFor(distance: number): number {
  // Dénominateur dérivé de 1,25 et 1,12 (plutôt que le littéral 0,13) pour que la borne haute
  // retombe exactement sur 1 en double précision IEEE-754 (1,25 − 1,12 ≠ 0,13 en binaire).
  return Math.min(1, Math.max(0, (1.25 - distance) / (1.25 - 1.12)));
}
