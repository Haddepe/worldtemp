import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ndcFromCanvas, pickSphere, projectToScreen, vec3ToLonLat } from "../src/render/pick";
import { lonLatToVec3 } from "../src/tiles/patch";

function camera(position: THREE.Vector3, aspect = 1000 / 800): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, aspect, 0.01, 10);
  cam.position.copy(position);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

describe("pickSphere", () => {
  it("rayon central depuis (0,0,3) touche (0,0,1)", () => {
    const p = pickSphere(0, 0, camera(new THREE.Vector3(0, 0, 3)));
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(0, 9);
    expect(p!.y).toBeCloseTo(0, 9);
    expect(p!.z).toBeCloseTo(1, 9);
  });

  it("renvoie le point le plus proche de la caméra (face visible)", () => {
    const p = pickSphere(0, 0, camera(new THREE.Vector3(3, 0, 0)))!;
    expect(p.x).toBeCloseTo(1, 9);
  });

  it("rayon hors du globe → null", () => {
    // en (0,0,3), FOV 45°, le globe couvre ≈ ±19,5° : le coin NDC (1, 1) est dans le vide
    expect(pickSphere(1, 1, camera(new THREE.Vector3(0, 0, 3)))).toBeNull();
  });

  it("le point rendu est sur la sphère unité", () => {
    const p = pickSphere(0.3, -0.2, camera(new THREE.Vector3(1, 2, 2)))!;
    expect(p.length()).toBeCloseTo(1, 9);
  });

  it("réutilise `target` s'il est fourni", () => {
    const t = new THREE.Vector3();
    expect(pickSphere(0, 0, camera(new THREE.Vector3(0, 0, 3)), t)).toBe(t);
  });
});

describe("vec3ToLonLat", () => {
  it("inverse de lonLatToVec3 sur une grille (hors pôles)", () => {
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = -80; lat <= 80; lat += 40) {
        const r = vec3ToLonLat(lonLatToVec3(lon, lat));
        expect(r.lon).toBeCloseTo(lon, 9);
        expect(r.lat).toBeCloseTo(lat, 9);
      }
    }
  });
  it("lon 180 est ramené à -180", () => {
    expect(vec3ToLonLat(lonLatToVec3(180, 10)).lon).toBeCloseTo(-180, 9);
  });
  it("pôles : lat ±90, lon fini", () => {
    expect(vec3ToLonLat(new THREE.Vector3(0, 1, 0)).lat).toBeCloseTo(90, 9);
    expect(vec3ToLonLat(new THREE.Vector3(0, -1, 0)).lat).toBeCloseTo(-90, 9);
    expect(Number.isFinite(vec3ToLonLat(new THREE.Vector3(0, 1, 0)).lon)).toBe(true);
  });
  it("tolère un vecteur légèrement hors sphère (y = 1,0000001)", () => {
    expect(vec3ToLonLat(new THREE.Vector3(0, 1.0000001, 0)).lat).toBeCloseTo(90, 6);
  });
});

describe("projectToScreen", () => {
  it("point face caméra → centre du viewport, visible", () => {
    const s = projectToScreen(new THREE.Vector3(0, 0, 1), camera(new THREE.Vector3(0, 0, 3)), 1000, 800);
    expect(s.x).toBeCloseTo(500, 6);
    expect(s.y).toBeCloseTo(400, 6);
    expect(s.visible).toBe(true);
  });
  it("point derrière l'horizon → visible = false", () => {
    // (0,0,-1) est la face cachée depuis (0,0,3)
    expect(projectToScreen(new THREE.Vector3(0, 0, -1), camera(new THREE.Vector3(0, 0, 3)), 1000, 800).visible).toBe(false);
  });
  it("point sur le limbe mais hors viewport → visible = false", () => {
    // caméra très près : (0,0,1) visible, un point à 60° de longitude est devant l'horizon mais hors champ
    const p = lonLatToVec3(60, 0);
    const cam = camera(lonLatToVec3(0, 0).multiplyScalar(1.05));
    expect(projectToScreen(p, cam, 1000, 800).visible).toBe(false);
  });
  it("y croît vers le bas (point au nord → y < centre)", () => {
    const s = projectToScreen(lonLatToVec3(-90, 10), camera(lonLatToVec3(-90, 0).multiplyScalar(3)), 1000, 800);
    expect(s.y).toBeLessThan(400);
    expect(s.x).toBeCloseTo(500, 6);
  });
});

describe("ndcFromCanvas", () => {
  it("coin haut-gauche → (-1, 1), centre → (0, 0)", () => {
    expect(ndcFromCanvas(0, 0, 1000, 800)).toEqual({ x: -1, y: 1 });
    expect(ndcFromCanvas(500, 400, 1000, 800)).toEqual({ x: 0, y: 0 });
  });
});
