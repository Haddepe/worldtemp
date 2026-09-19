/**
 * Rendu des fleuves (spec repères §5) : un quad instancié par segment, tampons statiques envoyés
 * une fois. Les segments sont triés par rang : `instanceCount` = préfixe des rangs admis au zoom
 * courant, le dernier rang entrant en fondu (uMaxRank flottant).
 */
import * as THREE from "three";
import type { RiverSegments } from "../rivers/data";
import fragmentShader from "./shaders/rivers.frag.glsl?raw";
import vertexShader from "./shaders/rivers.vert.glsl?raw";
import screenQuad from "./shaders/screen-quad.glsl?raw";

/** Largeur du trait en px CSS. */
export const RIVER_WIDTH_PX = 1.5;

/** Points de contrôle (d décroissant) du rang maximal admis ; interpolation linéaire entre eux. `rank: Infinity` = tous. */
export const RIVER_TIERS: readonly { d: number; rank: number }[] = [
  { d: 2.5, rank: 3 },
  { d: 1.6, rank: 5 },
  { d: 1.25, rank: 7 },
  { d: 1.05, rank: Number.POSITIVE_INFINITY },
];

export function riverMaxRank(d: number, topRank: number): number {
  const first = RIVER_TIERS[0]!;
  if (d >= first.d) return Math.min(first.rank, topRank);
  for (let i = 1; i < RIVER_TIERS.length; i++) {
    const hi = RIVER_TIERS[i - 1]!;
    const lo = RIVER_TIERS[i]!;
    if (d >= lo.d) {
      const loRank = Math.min(lo.rank, topRank);
      const hiRank = Math.min(hi.rank, topRank);
      return hiRank + ((hi.d - d) / (hi.d - lo.d)) * (loRank - hiRank);
    }
  }
  return topRank;
}

export interface RiversLayer {
  object: THREE.Mesh;
  /** `d` = distance caméra–centre ; `mapStyle` = même valeur que le globe (0 satellite, 1 carte). */
  setView(d: number, mapStyle: number): void;
  dispose(): void;
}

export function createRiversLayer(seg: RiverSegments): RiversLayer {
  const geometry = new THREE.InstancedBufferGeometry();
  // Coin du quad : x = 0 (début) ou 1 (fin) le long du segment, y = −1 / +1 en travers.
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]), 3));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  geometry.setAttribute("aStart", new THREE.InstancedBufferAttribute(seg.starts, 3));
  geometry.setAttribute("aEnd", new THREE.InstancedBufferAttribute(seg.ends, 3));
  geometry.setAttribute("aRank", new THREE.InstancedBufferAttribute(seg.ranks, 1));
  geometry.instanceCount = 0;
  const topRank = seg.countByRank.length - 1;
  const uniforms = {
    uMapStyle: { value: 0 },
    uMaxRank: { value: 0 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uWidthPx: { value: RIVER_WIDTH_PX },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: `${screenQuad}\n${vertexShader}`, fragmentShader,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
  });
  const object = new THREE.Mesh(geometry, material);
  object.frustumCulled = false;
  object.matrixAutoUpdate = false;
  object.renderOrder = 1; // au-dessus du globe, sous le vent (2)
  object.visible = false;
  object.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(uniforms.uViewport.value);
    uniforms.uWidthPx.value = RIVER_WIDTH_PX * renderer.getPixelRatio();
  };
  return {
    object,
    setView(d, mapStyle) {
      const max = riverMaxRank(d, topRank);
      uniforms.uMaxRank.value = max;
      uniforms.uMapStyle.value = mapStyle;
      // le rang suivant est déjà dessiné, avec un alpha < 1 (fondu)
      geometry.instanceCount = seg.count === 0 ? 0 : seg.countByRank[Math.min(topRank, Math.ceil(max))]!;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
