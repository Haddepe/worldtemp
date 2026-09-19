/**
 * Halo d'atmosphère sur le pourtour du globe : une coque vue par sa face arrière, masquée par
 * le globe sauf l'anneau qui dépasse du limbe, en lumière ajoutée sur le ciel. Statique : le
 * rendu reste à la demande. S'éteint de près, où le limbe sort de l'écran et où la caméra
 * finirait par entrer dans la coque.
 */
import * as THREE from "three";
import fragmentShader from "./shaders/halo.frag.glsl?raw";
import vertexShader from "./shaders/halo.vert.glsl?raw";

/** Rayon de la coque (globe = 1, vent = 1,002). Au-delà, la lueur est déjà nulle. */
export const HALO_RADIUS = 1.12;
/** Fondu selon la distance caméra–centre : plein au-delà de FAR, éteint en deçà de NEAR. */
export const HALO_FADE_FAR = 1.6;
export const HALO_FADE_NEAR = 1.15;

/** Réglables à l'œil. */
const HALO_COLOR = new THREE.Color(0.35, 0.62, 1.0);
const HALO_INTENSITY = 0.9;
/** Échelle de décroissance de la lueur, en rayons terrestres. */
const HALO_SCALE = 0.025;

export function haloOpacity(d: number): number {
  const t = (d - HALO_FADE_NEAR) / (HALO_FADE_FAR - HALO_FADE_NEAR);
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c); // smoothstep
}

export interface HaloLayer {
  object: THREE.Mesh;
  /** `d` = distance caméra–centre. */
  setView(d: number): void;
  dispose(): void;
}

export function createHaloLayer(): HaloLayer {
  const geometry = new THREE.SphereGeometry(HALO_RADIUS, 64, 32);
  const uniforms = {
    uColor: { value: HALO_COLOR },
    uIntensity: { value: HALO_INTENSITY },
    uOpacity: { value: 1 },
    uScale: { value: HALO_SCALE },
    uRadius: { value: HALO_RADIUS },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms,
    // Passe transparente : après le globe opaque, dont la profondeur masque la coque derrière lui.
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false,
  });
  const object = new THREE.Mesh(geometry, material);
  object.matrixAutoUpdate = false;
  return {
    object,
    setView(d) {
      const opacity = haloOpacity(d);
      uniforms.uOpacity.value = opacity;
      object.visible = opacity > 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
