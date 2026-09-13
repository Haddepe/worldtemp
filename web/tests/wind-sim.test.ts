import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { encode } from "../src/data/encoding";
import { vec3ToLonLat } from "../src/render/pick";
import { viewStateFrom } from "../src/tiles/lod";
import { lonLatToVec3 } from "../src/tiles/patch";
import {
  LIFE_MAX, LIFE_MIN, MAX_LAT, MIN_SPEED, PX_PER_S_PER_MS, RADIUS, SPAWN_TRIES, WIND_PROFILE, WindSim,
  isVisible, spawnOnScreen, speedScale, type PickFn, type WindField,
} from "../src/wind/sim";

/** Caméra à la distance d sur +z, viewport carré, fov 45°. */
export function view(d: number, height = 800) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10);
  camera.position.set(0, 0, d);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return viewStateFrom(camera, height);
}

describe("WIND_PROFILE", () => {
  it("budgets de la spec §7", () => {
    expect(WIND_PROFILE.high).toEqual({ particles: 12000, trail: 12 });
    expect(WIND_PROFILE.low).toEqual({ particles: 3000, trail: 8 });
    expect(MAX_LAT).toBe(85);
  });
});

describe("speedScale — vitesse apparente constante", () => {
  for (const d of [4, 1.1]) {
    it(`20 m/s → 40 px/s à d = ${d}`, () => {
      const v = view(d);
      const worldPerPx = (2 * (d - 1) * Math.tan(v.fovYRad / 2)) / v.viewportHeight;
      const degPerS = speedScale(v) * 20;
      const pxPerS = ((degPerS * Math.PI) / 180) / worldPerPx;
      expect(pxPerS).toBeCloseTo(20 * PX_PER_S_PER_MS, 6);
    });
  }
  it("P injectable", () => {
    expect(speedScale(view(4), 4)).toBeCloseTo(2 * speedScale(view(4)), 9);
  });
});

describe("isVisible", () => {
  const v = view(3);
  it("point face caméra visible, face cachée invisible", () => {
    expect(isVisible(new THREE.Vector3(0, 0, 1.002), v)).toBe(true);
    expect(isVisible(new THREE.Vector3(0, 0, -1.002), v)).toBe(false);
  });
  it("point derrière l'horizon (dot < 1/d) invisible même dans le frustum", () => {
    // d = 3 : horizon à cos θ = 1/3 ; z = 0.3 est devant le limbe géométrique mais derrière l'horizon
    expect(isVisible(new THREE.Vector3(Math.sqrt(1 - 0.09), 0, 0.3), v)).toBe(false);
  });
  it("point devant l'horizon mais hors frustum invisible", () => {
    // d = 1,05 : demi-hauteur visible à la surface ≈ 0,05·tan(22,5°) = 0,021 ; y = 0,1 sort du champ, dot = 0,995 > 1/1,05
    expect(isVisible(new THREE.Vector3(0, 0.1, Math.sqrt(1 - 0.01)), view(1.05))).toBe(false);
    expect(isVisible(new THREE.Vector3(0, 0.01, Math.sqrt(1 - 0.0001)), view(1.05))).toBe(true);
  });
});

describe("spawnOnScreen", () => {
  it("tire en NDC dans [-1, 1] et accepte le premier point trouvé", () => {
    const calls: [number, number][] = [];
    const pick: PickFn = (x, y, t) => { calls.push([x, y]); return t.set(x, y, 0); };
    const seq = [0.25, 0.75];
    let i = 0;
    const rng = () => seq[i++ % 2]!;
    const target = new THREE.Vector3();
    expect(spawnOnScreen(pick, rng, target)).toBe(true);
    expect(calls).toEqual([[-0.5, 0.5]]);
    expect(target.x).toBeCloseTo(-0.5, 9);
  });
  it("8 essais puis abandon", () => {
    const pick = vi.fn<PickFn>(() => null);
    expect(spawnOnScreen(pick, Math.random, new THREE.Vector3())).toBe(false);
    expect(pick).toHaveBeenCalledTimes(SPAWN_TRIES);
  });
  it("réussit au dernier essai", () => {
    let n = 0;
    const pick: PickFn = (_x, _y, t) => (++n < SPAWN_TRIES ? null : t.set(0, 0, 1));
    expect(spawnOnScreen(pick, Math.random, new THREE.Vector3())).toBe(true);
    expect(n).toBe(SPAWN_TRIES);
  });
});

const GRID = { width: 8, height: 5 };
const ENC = { bits: 8, min: -60, max: 60, scale: "linear" as const };

/** Champ constant (u, v) en m/s sur une petite grille : sampleValue renvoie la constante partout. */
function field(u: number, v: number): WindField {
  const fill = (val: number) => {
    const px = new Uint8ClampedArray(GRID.width * GRID.height * 4);
    const b = encode(val, ENC);
    for (let i = 0; i < px.length; i += 4) { px[i] = b; px[i + 3] = 255; }
    return px;
  };
  return { u: fill(u), v: fill(v), grid: GRID, encU: ENC, encV: ENC };
}

/** Pick qui pose toujours la particule au même point (lon, lat) visible depuis +z. */
function pickAt(lon: number, lat: number): PickFn {
  return (_x, _y, t) => lonLatToVec3(lon, lat, t);
}
const DT = 1 / 30;
const rng0 = () => 0; // life = LIFE_MIN

function slot(sim: WindSim, k: number, i: number) {
  const o = (k * sim.count + i) * 3;
  return new THREE.Vector3(sim.positions[o], sim.positions[o + 1], sim.positions[o + 2]);
}

describe("WindSim.step — advection", () => {
  it("premier tick : toutes les particules naissent au point du pick, K slots égaux, rayon 1,002", () => {
    const sim = new WindSim(2, 3);
    sim.step(field(0, 0), DT, view(3), pickAt(-100, 20), rng0);
    for (let i = 0; i < 2; i++) {
      expect(sim.lon[i]).toBeCloseTo(-100, 5);
      expect(sim.lat[i]).toBeCloseTo(20, 5);
      // positions en Float32 : précision ≈ 1e-7
      for (let k = 0; k < 3; k++) expect(slot(sim, k, i).length()).toBeCloseTo(RADIUS, 6);
      expect(slot(sim, 0, i).distanceTo(slot(sim, 2, i))).toBe(0);
      expect(sim.age[i]).toBe(0);
      expect(sim.life[i]).toBe(LIFE_MIN);
    }
  });
  // 12 m/s = octet 153, aller-retour 8 bits exact (10 ne l'est pas)
  it("v > 0 fait croître la latitude de v·S·dt ; u = 0 laisse la longitude", () => {
    const sim = new WindSim(1, 3);
    const v = view(3);
    sim.step(field(0, 0), DT, v, pickAt(-100, 20), rng0);
    sim.step(field(0, 12), DT, v, pickAt(-100, 20), rng0);
    expect(sim.lat[0]).toBeCloseTo(20 + 12 * speedScale(v) * DT, 5);
    // u = 0 non plus n'est pas représentable exactement en 8 bits (0 tombe pile
    // entre les octets 127 et 128) : décodé ≈ 0,235294, d'où une dérive de
    // longitude résiduelle (~2e-3°) non capturée par une tolérance à 1e-5.
    expect(sim.lon[0]).toBeCloseTo(-100, 1);
    expect(sim.age[0]).toBe(1);
  });
  it("dlon est divisé par cos(lat) : même u, déplacement double à 60° qu'à 0°", () => {
    const v = view(3);
    const at = (lat: number) => {
      const sim = new WindSim(1, 3);
      sim.step(field(0, 0), DT, v, pickAt(-100, lat), rng0);
      sim.step(field(10, 0), DT, v, pickAt(-100, lat), rng0);
      return sim.lon[0]! + 100;
    };
    expect(at(60) / at(0)).toBeCloseTo(2, 3);
  });
  it("bouclage antiméridien : 179,9° + est → −179,…", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10);
    camera.position.set(-3, 0, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const v = viewStateFrom(camera, 800);
    const sim = new WindSim(1, 3);
    sim.step(field(0, 0), DT, v, pickAt(179.9, 0), rng0);
    sim.step(field(60, 0), DT, v, pickAt(179.9, 0), rng0);
    expect(sim.lon[0]).toBeLessThan(-179);
    expect(sim.lon[0]).toBeGreaterThan(-180);
  });
  it("le tampon glisse : slot K−1 = position nouvelle, slots précédents = anciennes", () => {
    const sim = new WindSim(1, 3);
    const v = view(3);
    sim.step(field(0, 0), DT, v, pickAt(-100, 20), rng0);
    const p0 = slot(sim, 2, 0);
    sim.step(field(0, 10), DT, v, pickAt(-100, 20), rng0);
    const p1 = slot(sim, 2, 0);
    expect(p1.distanceTo(p0)).toBeGreaterThan(0);
    expect(slot(sim, 1, 0).distanceTo(p0)).toBe(0);
    expect(slot(sim, 0, 0).distanceTo(p0)).toBe(0);
    sim.step(field(0, 10), DT, v, pickAt(-100, 20), rng0);
    expect(slot(sim, 0, 0).distanceTo(p0)).toBe(0);
    expect(slot(sim, 1, 0).distanceTo(p1)).toBe(0);
    expect(slot(sim, 2, 0).distanceTo(p1)).toBeGreaterThan(0);
  });
  it("dt borné à 0,1 s", () => {
    const sim = new WindSim(1, 3);
    const v = view(3);
    sim.step(field(0, 0), DT, v, pickAt(-100, 20), rng0);
    sim.step(field(0, 12), 5, v, pickAt(-100, 20), rng0);
    expect(sim.lat[0]).toBeCloseTo(20 + 12 * speedScale(v) * 0.1, 5);
  });
});

describe("WindSim.step — respawn", () => {
  const spawnThenExpectRespawn = (mutate: (sim: WindSim) => void, f: WindField = field(0, 10)) => {
    const sim = new WindSim(1, 3);
    const v = view(3);
    sim.step(field(0, 0), DT, v, pickAt(-100, 20), rng0);
    mutate(sim);
    const pick = vi.fn<PickFn>(pickAt(-100, 20));
    sim.step(f, DT, v, pick, rng0);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(sim.lon[0]).toBeCloseTo(-100, 5);
    expect(sim.lat[0]).toBeCloseTo(20, 5);
    expect(sim.age[0]).toBe(0);
    for (let k = 0; k < 3; k++) expect(slot(sim, k, 0).distanceTo(slot(sim, 2, 0))).toBe(0);
  };
  it("age > life", () => spawnThenExpectRespawn((s) => { s.age[0] = 200; }));
  it("|lat| > 85°", () => spawnThenExpectRespawn((s) => { s.lat[0] = 86; }));
  it("sortie de la vue (face cachée)", () => spawnThenExpectRespawn((s) => { s.lon[0] = 80; }));
  it("vent < 0,5 m/s (figée)", () => spawnThenExpectRespawn(() => {}, field(0.2, 0.2)));
  it("pick raté 8 fois : position conservée, age remis à 0", () => {
    const sim = new WindSim(1, 3);
    const v = view(3);
    sim.step(field(0, 0), DT, v, pickAt(-100, 20), rng0);
    sim.age[0] = 200;
    const pick = vi.fn<PickFn>(() => null);
    sim.step(field(0, 10), DT, v, pick, rng0);
    expect(pick).toHaveBeenCalledTimes(SPAWN_TRIES);
    expect(sim.lon[0]).toBeCloseTo(-100, 5);
    expect(sim.lat[0]).toBeCloseTo(20, 5);
    expect(sim.age[0]).toBe(0);
    expect(slot(sim, 2, 0).length()).toBeCloseTo(RADIUS, 6);
  });
  it("life tirée dans [60, 120]", () => {
    const sim = new WindSim(1, 3);
    sim.step(field(0, 0), DT, view(3), pickAt(-100, 20), () => 0.999999);
    expect(sim.life[0]).toBe(LIFE_MAX);
  });
  it("vitesse inférieure à MIN_SPEED constatée", () => {
    expect(Math.hypot(0.2, 0.2)).toBeLessThan(MIN_SPEED);
  });
});
