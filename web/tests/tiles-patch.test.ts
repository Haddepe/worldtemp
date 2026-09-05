import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildPatchGeometry, lonLatToVec3, patchSphere } from "../src/tiles/patch";

function near(v: THREE.Vector3, x: number, y: number, z: number) {
  expect(v.x).toBeCloseTo(x, 6);
  expect(v.y).toBeCloseTo(y, 6);
  expect(v.z).toBeCloseTo(z, 6);
}

describe("lonLatToVec3 (convention SphereGeometry de Three.js)", () => {
  it("points cardinaux", () => {
    near(lonLatToVec3(-180, 0), -1, 0, 0);
    near(lonLatToVec3(-90, 0), 0, 0, 1);
    near(lonLatToVec3(0, 0), 1, 0, 0);
    near(lonLatToVec3(90, 0), 0, 0, -1);
    near(lonLatToVec3(0, 90), 0, 1, 0);
    near(lonLatToVec3(0, -90), 0, -1, 0);
  });
});

describe("patchSphere", () => {
  it("englobe les coins et les milieux d'arêtes", () => {
    const t = { z: 3, x: 5, y: 2 };
    const s = patchSphere(t);
    expect(s.center.length()).toBeCloseTo(1, 6);
    for (const [lon, lat] of [[-67.5, 45], [-45, 45], [-67.5, 22.5], [-45, 22.5], [-56.25, 45], [-56.25, 22.5], [-67.5, 33.75], [-45, 33.75]]) {
      expect(lonLatToVec3(lon!, lat!).distanceTo(s.center)).toBeLessThanOrEqual(s.radius + 1e-9);
    }
  });

  it("le rayon décroît avec le niveau", () => {
    expect(patchSphere({ z: 8, x: 253, y: 57 }).radius).toBeLessThan(patchSphere({ z: 3, x: 5, y: 2 }).radius);
    expect(patchSphere({ z: 8, x: 253, y: 57 }).radius).toBeLessThan(0.02);
  });
});

describe("buildPatchGeometry", () => {
  it("compte de sommets, attributs, coins et jupe", () => {
    const g = buildPatchGeometry({ z: 1, x: 0, y: 0 }, 4, 0.005);
    const n = 25 + 4 * 5;
    expect(g.getAttribute("position").count).toBe(n);
    expect(g.getAttribute("normal").count).toBe(n);
    expect(g.getAttribute("uv").count).toBe(n);
    expect(g.getAttribute("lonlat").count).toBe(n);
    expect(g.getIndex()!.count).toBe(3 * (2 * 16 + 8 * 4));
    const pos = g.getAttribute("position");
    const ll = g.getAttribute("lonlat");
    const uv = g.getAttribute("uv");
    // sommet 0 = coin (lonMin, latMin) = (−180, 0) ; uv (0, 0)
    expect([ll.getX(0), ll.getY(0)]).toEqual([-180, 0]);
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 0]);
    near(new THREE.Vector3().fromBufferAttribute(pos, 0), -1, 0, 0);
    // dernier sommet de surface = coin (lonMax, latMax) = (−90, 90) ; uv (1, 1)
    expect([ll.getX(24), ll.getY(24)]).toEqual([-90, 90]);
    expect([uv.getX(24), uv.getY(24)]).toEqual([1, 1]);
    // la jupe est sous la surface
    const skirt = new THREE.Vector3().fromBufferAttribute(pos, 25);
    expect(skirt.length()).toBeLessThan(1);
    expect(skirt.length()).toBeGreaterThan(0.98);
  });
});
