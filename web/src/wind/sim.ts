/**
 * Simulation des particules de vent (spec vent §7). Logique pure : aucun DOM, aucun GPU.
 * Les positions vivent dans un tampon slot-major [K][N][xyz] consommé tel quel par
 * render/wind.ts (slot 0 = queue, slot K−1 = tête).
 */
import * as THREE from "three";
import type { Tier } from "../gpu/tier";
import type { ViewState } from "../tiles/lod";

export const WIND_PROFILE: Record<Tier, { particles: number; trail: number }> = {
  high: { particles: 12_000, trail: 12 },
  low: { particles: 3_000, trail: 8 },
};

export const TICK_MS = 1000 / 30;
export const MAX_DT_S = 0.1;
/** Vitesse apparente : px CSS par seconde et par m/s (20 m/s → 40 px/s). */
export const PX_PER_S_PER_MS = 2;
export const RADIUS = 1.002;
export const MAX_LAT = 85;
export const MIN_SPEED = 0.5;
export const LIFE_MIN = 60;
export const LIFE_MAX = 120;
export const SPAWN_TRIES = 8;

const DEG = Math.PI / 180;

export type PickFn = (ndcX: number, ndcY: number, target: THREE.Vector3) => THREE.Vector3 | null;

/** Degrés par seconde par m/s tels que la vitesse à l'écran ne dépende pas de l'altitude. */
export function speedScale(
  view: Pick<ViewState, "cameraPosition" | "fovYRad" | "viewportHeight">,
  pxPerSecPerMs: number = PX_PER_S_PER_MS,
): number {
  const d = view.cameraPosition.length();
  const worldPerPx = (2 * (d - 1) * Math.tan(view.fovYRad / 2)) / view.viewportHeight;
  return pxPerSecPerMs * worldPerPx * (180 / Math.PI);
}

const camDir = new THREE.Vector3();

/** Devant l'horizon (dot(P̂, Ĉ) > 1/|C|, spec tuiles §5) et dans le frustum. */
export function isVisible(p: THREE.Vector3, view: Pick<ViewState, "cameraPosition" | "frustum">): boolean {
  const d = view.cameraPosition.length();
  camDir.copy(view.cameraPosition).divideScalar(d);
  if (p.dot(camDir) / (p.length() || 1) <= 1 / d) return false;
  return view.frustum.containsPoint(p);
}

/** Tirage uniforme à l'écran : (x, y) en NDC, projeté sur la sphère par `pick`. `false` après SPAWN_TRIES ratés. */
export function spawnOnScreen(pick: PickFn, rng: () => number, target: THREE.Vector3): boolean {
  for (let i = 0; i < SPAWN_TRIES; i++) {
    const x = rng() * 2 - 1;
    const y = rng() * 2 - 1;
    if (pick(x, y, target)) return true;
  }
  return false;
}
