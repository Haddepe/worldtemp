/**
 * Rendu des traînées de vent (spec vent §8) : un seul LineSegments sur le tampon slot-major
 * [K][N][xyz] de wind/sim.ts. Index et alpha sont statiques ; seules les positions changent,
 * envoyées entières à chaque tick (markDirty).
 */
import * as THREE from "three";
import fragmentShader from "./shaders/wind.frag.glsl?raw";
import vertexShader from "./shaders/wind.vert.glsl?raw";

export interface WindLayer {
  object: THREE.LineSegments;
  /** 0 = satellite (blanc), 1 = carte (gris foncé) ; même valeur que le globe. */
  setMapStyle(v: number): void;
  /** À appeler après chaque tick de simulation. */
  markDirty(): void;
  dispose(): void;
}

/** Segments (k, i) → (k+1, i) pour k < K−1 ; sommet (k, i) = k·N + i. */
export function buildTrailIndex(count: number, trail: number): Uint32Array {
  const idx = new Uint32Array(count * (trail - 1) * 2);
  let o = 0;
  for (let k = 0; k < trail - 1; k++) {
    for (let i = 0; i < count; i++) {
      idx[o++] = k * count + i;
      idx[o++] = (k + 1) * count + i;
    }
  }
  return idx;
}

/** Alpha du sommet (k, i) = k / (K−1) : 0 à la queue, 1 à la tête. */
export function buildTrailAlpha(count: number, trail: number): Float32Array {
  const a = new Float32Array(count * trail);
  for (let k = 0; k < trail; k++) a.fill(k / (trail - 1), k * count, (k + 1) * count);
  return a;
}

export function createWindLayer(positions: Float32Array, count: number, trail: number): WindLayer {
  if (positions.length !== count * trail * 3) throw new Error("tampon de positions de taille inattendue");
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("aAlpha", new THREE.BufferAttribute(buildTrailAlpha(count, trail), 1));
  geometry.setIndex(new THREE.BufferAttribute(buildTrailIndex(count, trail), 1));
  const uniforms = { uMapStyle: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, depthTest: true,
  });
  const object = new THREE.LineSegments(geometry, material);
  object.frustumCulled = false;
  object.matrixAutoUpdate = false;
  object.renderOrder = 1;
  object.visible = false;
  return {
    object,
    setMapStyle(v) {
      uniforms.uMapStyle.value = v;
    },
    markDirty() {
      position.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
