import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { decode, encode } from "../src/data/encoding";
import { sampleValue } from "../src/data/sampling";
import { viewStateFrom } from "../src/tiles/lod";
import { lonLatToVec3 } from "../src/tiles/patch";
import {
  LIFE_MAX, LIFE_MIN, MAX_LAT, MIN_SPEED, PX_PER_S_PER_MS, RADIUS, SPAWN_TRIES, WIND_PROFILE, WindSim,
  isVisible, sampleUV, spawnOnScreen, speedScale, type PickFn, type WindField,
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
  it("rayon 1,002 : seuil d'horizon exact (≈ 0,392 à d = 3), pas 1/d", () => {
    // (1 + √((9 − 1)(1,002² − 1))) / (3 · 1,002) ≈ 0,3922 : cos θ = 0,36 est au-delà de 1/3 mais
    // se projette encore hors du limbe de la sphère unité → invisible.
    const at = (cos: number) => new THREE.Vector3(Math.sqrt(1 - cos * cos) * 1.002, 0, cos * 1.002);
    expect(isVisible(at(0.36), v)).toBe(false);
    expect(isVisible(at(0.4), v)).toBe(true);
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

/** Champ constant (u, v) en m/s sur une petite grille : sampleUV renvoie la constante partout. */
function field(u: number, v: number): WindField {
  const bu = encode(u, ENC);
  const bv = encode(v, ENC);
  const uv = new Uint8Array(GRID.width * GRID.height * 2);
  for (let i = 0; i < uv.length; i += 2) { uv[i] = bu; uv[i + 1] = bv; }
  return { uv, grid: GRID, encU: ENC, encV: ENC };
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

describe("sampleUV — échantillonnage fusionné", () => {
  const out = { u: 0, v: 0 };
  /** Encodage identité : l'octet lu est la valeur décodée. */
  const ID = { bits: 8, min: 0, max: 255, scale: "linear" as const };

  it("champ constant : les deux constantes, partout", () => {
    const f = field(12, -8);
    for (const [lon, lat] of [[-180, 90], [0, 0], [179.9, -85], [-73.5, 45.2]] as const) {
      sampleUV(f, lon, lat, out);
      expect(out.u).toBeCloseTo(decode(encode(12, ENC), ENC), 9);
      expect(out.v).toBeCloseTo(decode(encode(-8, ENC), ENC), 9);
    }
  });

  it("deux colonnes : interpolation linéaire à une demi-cellule", () => {
    // W = 2 : centre de la colonne 0 à lon −180, colonne 1 à lon 0 ; lon −90 = mi-chemin
    const uv = new Uint8Array([10, 100, 50, 200, 10, 100, 50, 200]);
    const f: WindField = { uv, grid: { width: 2, height: 2 }, encU: ID, encV: ID };
    sampleUV(f, -180, 0, out);
    expect(out.u).toBeCloseTo(10, 9);
    expect(out.v).toBeCloseTo(100, 9);
    sampleUV(f, -90, 0, out);
    expect(out.u).toBeCloseTo(30, 9);
    expect(out.v).toBeCloseTo(150, 9);
    sampleUV(f, 0, 0, out);
    expect(out.u).toBeCloseTo(50, 9);
    expect(out.v).toBeCloseTo(200, 9);
  });

  it("bouclage en longitude : au-delà de la dernière colonne on revient sur la première", () => {
    const uv = new Uint8Array([10, 100, 50, 200, 10, 100, 50, 200]);
    const f: WindField = { uv, grid: { width: 2, height: 2 }, encU: ID, encV: ID };
    sampleUV(f, 90, 0, out); // mi-chemin entre la colonne 1 (lon 0) et la colonne 0 (lon 180 ≡ −180)
    expect(out.u).toBeCloseTo(30, 9);
    expect(out.v).toBeCloseTo(150, 9);
    const wrapped = { u: 0, v: 0 };
    sampleUV(f, 179.9 - 360, 0, out);
    sampleUV(f, 179.9, 0, wrapped);
    expect(out.u).toBeCloseTo(wrapped.u, 9);
  });

  it("accord avec sampleValue sur un champ RGBA aléatoire", () => {
    const W = 16;
    const H = 9;
    let seed = 42;
    const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    const pu = new Uint8ClampedArray(W * H * 4);
    const pv = new Uint8ClampedArray(W * H * 4);
    const uv = new Uint8Array(W * H * 2);
    for (let i = 0; i < W * H; i++) {
      pu[i * 4] = Math.floor(rnd() * 256);
      pv[i * 4] = Math.floor(rnd() * 256);
      uv[i * 2] = pu[i * 4]!;
      uv[i * 2 + 1] = pv[i * 4]!;
    }
    const grid = { width: W, height: H };
    const f: WindField = { uv, grid, encU: ENC, encV: ENC };
    for (let k = 0; k < 20; k++) {
      const lon = rnd() * 360 - 180;
      const lat = rnd() * 180 - 90;
      sampleUV(f, lon, lat, out);
      expect(out.u).toBeCloseTo(sampleValue(pu, grid, ENC, lon, lat), 9);
      expect(out.v).toBeCloseTo(sampleValue(pv, grid, ENC, lon, lat), 9);
    }
  });
});

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
    // u = 0 encode en octet 128 → décodé 0,235 m/s : la dérive en longitude attendue en découle
    const u0 = decode(encode(0, ENC), ENC);
    expect(sim.lon[0]).toBeCloseTo(-100 + (u0 * speedScale(v) * DT) / Math.cos(20 * (Math.PI / 180)), 5);
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
  it("vitesse inférieure à MIN_SPEED constatée (comparaison au carré)", () => {
    expect(0.2 * 0.2 + 0.2 * 0.2).toBeLessThan(MIN_SPEED * MIN_SPEED);
  });
});
