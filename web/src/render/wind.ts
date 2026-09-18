/**
 * Rendu des traînées de vent (spec vent §8, révisé le 2026-09-18) : un quad instancié par segment
 * de traînée, élargi en espace écran — `gl.lineWidth` est ignoré par ANGLE, un LineSegments
 * reste à 1 px et se perd sur les couches claires. Les deux extrémités d'un segment lisent le
 * **même** tampon slot-major [K][N][xyz] de wind/sim.ts, décalées d'un slot (N sommets) : aucune
 * copie CPU, un seul upload par tick (markDirty). L'alpha vient de gl_InstanceID.
 */
import * as THREE from "three";
import fragmentShader from "./shaders/wind.frag.glsl?raw";
import vertexShader from "./shaders/wind.vert.glsl?raw";
import screenQuad from "./shaders/screen-quad.glsl?raw";

/** Largeur du trait en px CSS, hors liseré. */
export const WIND_WIDTH_PX = 2;

export interface WindLayer {
  object: THREE.Mesh;
  /** 0 = satellite (blanc), 1 = carte (gris foncé) ; même valeur que le globe. */
  setMapStyle(v: number): void;
  /** À appeler après chaque tick de simulation. */
  markDirty(): void;
  dispose(): void;
}

export function createWindLayer(positions: Float32Array, count: number, trail: number): WindLayer {
  if (positions.length !== count * trail * 3) throw new Error("tampon de positions de taille inattendue");
  const geometry = new THREE.InstancedBufferGeometry();
  // Coin du quad : x = 0 (début) ou 1 (fin) le long du segment, y = −1 / +1 en travers.
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]), 3));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  // Instance j = segment (k, i) → (k+1, i) avec j = k·N + i : aEnd est aStart décalé de N sommets.
  // L'offset dépasse le stride — three ne le borne pas, et vertexAttribPointer prend un offset en octets.
  const buffer = new THREE.InstancedInterleavedBuffer(positions, 3, 1);
  buffer.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aStart", new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  geometry.setAttribute("aEnd", new THREE.InterleavedBufferAttribute(buffer, 3, count * 3));
  geometry.instanceCount = count * (trail - 1);
  const uniforms = {
    uMapStyle: { value: 0 },
    uCount: { value: count },
    uTrail: { value: trail },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uWidthPx: { value: WIND_WIDTH_PX },
    uPixelRatio: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: `${screenQuad}\n${vertexShader}`, fragmentShader,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
  });
  const object = new THREE.Mesh(geometry, material);
  object.frustumCulled = false;
  object.matrixAutoUpdate = false;
  object.renderOrder = 2; // au-dessus des fleuves (render/rivers.ts, 1)
  object.visible = false;
  object.onBeforeRender = (renderer) => {
    const ratio = renderer.getPixelRatio();
    renderer.getDrawingBufferSize(uniforms.uViewport.value);
    uniforms.uWidthPx.value = WIND_WIDTH_PX * ratio;
    uniforms.uPixelRatio.value = ratio;
  };
  return {
    object,
    setMapStyle(v) {
      uniforms.uMapStyle.value = v;
    },
    markDirty() {
      buffer.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
