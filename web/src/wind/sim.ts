/**
 * Simulation des particules de vent (spec vent §7). Logique pure : aucun DOM, aucun GPU.
 * Les positions vivent dans un tampon slot-major [K][N][xyz] consommé tel quel par
 * render/wind.ts (slot 0 = queue, slot K−1 = tête).
 */
import * as THREE from "three";
import { sampleValue } from "../data/sampling";
import type { Encoding } from "../data/encoding";
import type { Grid } from "../data/manifest";
import type { Tier } from "../gpu/tier";
import { vec3ToLonLat } from "../render/pick";
import { lonLatToVec3 } from "../tiles/patch";
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

export interface WindField {
  u: Uint8ClampedArray;
  v: Uint8ClampedArray;
  grid: Pick<Grid, "width" | "height">;
  encU: Encoding;
  encV: Encoding;
}

const tmp = new THREE.Vector3();

export class WindSim {
  /** Slot-major [K][N][xyz], rayon RADIUS. Lu par render/wind.ts sans copie. */
  readonly positions: Float32Array;
  readonly lon: Float32Array;
  readonly lat: Float32Array;
  readonly age: Uint16Array;
  readonly life: Uint16Array;

  constructor(readonly count: number, readonly trail: number) {
    if (!(count >= 1) || !(trail >= 2)) throw new Error("count ≥ 1 et trail ≥ 2 attendus");
    this.positions = new Float32Array(trail * count * 3);
    this.lon = new Float32Array(count);
    this.lat = new Float32Array(count);
    this.age = new Uint16Array(count).fill(1);   // age > life = 0 : toutes naissent au premier tick
    this.life = new Uint16Array(count);
  }

  private write(slot: number, i: number, p: THREE.Vector3): void {
    const o = (slot * this.count + i) * 3;
    this.positions[o] = p.x;
    this.positions[o + 1] = p.y;
    this.positions[o + 2] = p.z;
  }

  step(field: WindField, dtS: number, view: ViewState, pick: PickFn, rng: () => number = Math.random): void {
    const dt = Math.min(dtS, MAX_DT_S);
    const N = this.count;
    const K = this.trail;
    const head = K - 1;
    this.positions.copyWithin(0, N * 3); // slots 1…K−1 → 0…K−2
    const S = speedScale(view);
    for (let i = 0; i < N; i++) {
      let lon = this.lon[i]!;
      let lat = this.lat[i]!;
      let respawn = this.age[i]! > this.life[i]! || Math.abs(lat) > MAX_LAT;
      if (!respawn) {
        const u = sampleValue(field.u, field.grid, field.encU, lon, lat);
        const v = sampleValue(field.v, field.grid, field.encV, lon, lat);
        if (Math.hypot(u, v) < MIN_SPEED) {
          respawn = true;
        } else {
          lon += (u * S * dt) / Math.cos(lat * DEG);
          lat += v * S * dt;
          if (lon >= 180) lon -= 360;
          else if (lon < -180) lon += 360;
          lonLatToVec3(lon, lat, tmp).multiplyScalar(RADIUS);
          respawn = Math.abs(lat) > MAX_LAT || !isVisible(tmp, view);
        }
      }
      if (respawn) {
        this.age[i] = 0;
        if (spawnOnScreen(pick, rng, tmp)) {
          const ll = vec3ToLonLat(tmp);
          lon = ll.lon;
          lat = ll.lat;
          this.life[i] = LIFE_MIN + Math.floor(rng() * (LIFE_MAX - LIFE_MIN + 1));
          tmp.normalize().multiplyScalar(RADIUS);
          for (let k = 0; k < K; k++) this.write(k, i, tmp);
        } else {
          lonLatToVec3(lon, lat, tmp).multiplyScalar(RADIUS); // position conservée
          this.write(head, i, tmp);
        }
      } else {
        this.age[i] = this.age[i]! + 1;
        this.write(head, i, tmp);
      }
      this.lon[i] = lon;
      this.lat[i] = lat;
    }
  }
}
