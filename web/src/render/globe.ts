import * as THREE from "three";
import type { Tier } from "../gpu/tier";
import fragmentShader from "./shaders/globe.frag.glsl?raw";
import vertexShader from "./shaders/globe.vert.glsl?raw";

/** Subdivisions (largeur, hauteur) par tier — spec §4 « Profils ». */
export const SEGMENTS: Record<Tier, [number, number]> = {
  high: [768, 384],
  low: [256, 128],
};

export interface Globe {
  mesh: THREE.Mesh;
  /** `null` retire la heatmap (le globe redevient Blue Marble seule). */
  setHeatmap(texture: THREE.Texture | null, width: number, height: number): void;
  setLut(lut: THREE.DataTexture): void;
  setOpacity(opacity: number): void;
}

/**
 * Un seul ShaderMaterial (approche A de la spec) : la géométrie est créée une
 * fois selon le tier ; tout ce qui bouge passe par les uniforms.
 */
export function createGlobe(tier: Tier, baseMap: THREE.Texture): Globe {
  const [widthSegments, heightSegments] = SEGMENTS[tier];
  const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);

  const uniforms = {
    uBaseMap: { value: baseMap },
    uHeatmap: { value: null as THREE.Texture | null },
    uLut: { value: null as THREE.DataTexture | null },
    uGridSize: { value: new THREE.Vector2(1440, 721) },
    uHeatmapOpacity: { value: 0.85 },
    uHasHeatmap: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0.5, 0.4, 1).normalize() },
  };

  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  const mesh = new THREE.Mesh(geometry, material);

  return {
    mesh,
    setHeatmap(texture, width, height) {
      uniforms.uHeatmap.value = texture;
      uniforms.uGridSize.value.set(width, height);
      uniforms.uHasHeatmap.value = texture ? 1 : 0;
    },
    setLut(lut) {
      uniforms.uLut.value = lut;
    },
    setOpacity(opacity) {
      uniforms.uHeatmapOpacity.value = Math.min(1, Math.max(0, opacity));
    },
  };
}
