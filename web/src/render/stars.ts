/**
 * Ciel étoilé derrière le globe : quelques milliers de points procéduraux, déterministes (même
 * ciel à chaque visite), dessinés à l'infini avant tout le reste. Aucun téléchargement, tampons
 * statiques envoyés une fois, pas de scintillement (le rendu reste à la demande).
 */
import * as THREE from "three";
import type { Tier } from "../gpu/tier";
import fragmentShader from "./shaders/stars.frag.glsl?raw";
import vertexShader from "./shaders/stars.vert.glsl?raw";

/** Réglables à l'œil : densité du ciel par profil. */
export const STAR_COUNT: Record<Tier, number> = { high: 4000, low: 2000 };
export const STAR_SEED = 20260919;

/** Taille des points en px CSS. */
const SIZE_MIN = 1.2;
const SIZE_MAX = 3;
/** Luminosité de l'étoile la plus faible ; la plus brillante vaut 1. */
const BRIGHTNESS_MIN = 0.18;
/** Exposant de la loi de luminosité : plus il est grand, plus les étoiles brillantes sont rares. */
const BRIGHTNESS_POWER = 3.2;

const WHITE = [1, 1, 1] as const;
const BLUISH = [0.72, 0.84, 1] as const;
const ORANGE = [1, 0.84, 0.68] as const;

export interface Starfield {
  count: number;
  /** Directions unité, `[3·i … 3·i+2]`. */
  directions: Float32Array;
  /** Taille en px CSS. */
  sizes: Float32Array;
  /** Teinte × luminosité, dans [0, 1]. */
  colors: Float32Array;
}

/** Générateur mulberry32 : petit, rapide, reproductible d'un navigateur à l'autre. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildStarfield(count: number, seed: number): Starfield {
  const random = mulberry32(seed);
  const directions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Uniforme sur la sphère : z uniforme dans [−1, 1], longitude uniforme.
    const z = 2 * random() - 1;
    const phi = 2 * Math.PI * random();
    const r = Math.sqrt(1 - z * z);
    directions[i * 3] = r * Math.cos(phi);
    directions[i * 3 + 1] = r * Math.sin(phi);
    directions[i * 3 + 2] = z;

    const k = Math.pow(random(), BRIGHTNESS_POWER); // beaucoup de faibles, peu de brillantes
    const brightness = BRIGHTNESS_MIN + (1 - BRIGHTNESS_MIN) * k;
    sizes[i] = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * k;

    const hue = random();
    const tint = hue < 0.12 ? BLUISH : hue < 0.22 ? ORANGE : WHITE;
    colors[i * 3] = tint[0] * brightness;
    colors[i * 3 + 1] = tint[1] * brightness;
    colors[i * 3 + 2] = tint[2] * brightness;
  }
  return { count, directions, sizes, colors };
}

export interface StarsLayer {
  object: THREE.Points;
  dispose(): void;
}

export function createStarsLayer(tier: Tier): StarsLayer {
  const field = buildStarfield(STAR_COUNT[tier], STAR_SEED);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(field.directions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(field.sizes, 1));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(field.colors, 3));
  const uniforms = { uPixelRatio: { value: 1 } };
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms,
    // Pas `transparent` : la passe transparente vient après le globe opaque, et sans test de
    // profondeur les étoiles se dessineraient par-dessus lui. Le mélange additif s'applique quand même.
    transparent: false, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  });
  const object = new THREE.Points(geometry, material);
  object.renderOrder = -1; // avant le globe (0), les fleuves (1) et le vent (2)
  object.frustumCulled = false; // les positions sont des directions, pas des points de la scène
  object.matrixAutoUpdate = false;
  // gl_PointSize est en pixels du framebuffer : suivre le pixel ratio plafonné par le tier.
  object.onBeforeRender = (renderer) => {
    uniforms.uPixelRatio.value = renderer.getPixelRatio();
  };
  return {
    object,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
