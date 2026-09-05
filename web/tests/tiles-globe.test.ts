import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTiledGlobe } from "../src/render/globe";
import { viewStateFrom } from "../src/tiles/lod";
import type { TileId } from "../src/tiles/grid";
import type { TileLoader } from "../src/tiles/loader";

const satTex = new THREE.Texture();
const mapTex = new THREE.Texture();

function fakeLoader(): TileLoader {
  return {
    update: () => {},
    isOcean: () => false,
    get: () => undefined,
    usedBytes: 0,
    dispose: () => {},
    resolve: (t: TileId, set: "sat" | "map") => ({
      tile: { z: 0, x: t.x >> t.z, y: 0 },
      texture: set === "sat" ? satTex : mapTex,
    }),
  } as unknown as TileLoader;
}

describe("createTiledGlobe", () => {
  it("renvoie chaque uniform de tuile au GPU (uniformsNeedUpdate) avec des rects distincts par patch", () => {
    const globe = createTiledGlobe("high", fakeLoader(), 8);

    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.01, 10);
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const view = viewStateFrom(camera, 720);

    const count = globe.update(view);
    expect(count).toBeGreaterThanOrEqual(2);

    const [meshA, meshB] = globe.group.children as THREE.Mesh[];
    expect(meshA).toBeDefined();
    expect(meshB).toBeDefined();
    expect(meshA).not.toBe(meshB);

    const material = meshA!.material as THREE.ShaderMaterial;
    expect(meshB!.material as THREE.ShaderMaterial).toBe(material);

    const dummy = {
      renderer: {} as unknown,
      scene: {} as unknown,
      camera: {} as unknown,
      geometry: {} as unknown,
      material: {} as unknown,
      group: {} as unknown,
    };

    material.uniformsNeedUpdate = false;
    (meshA!.onBeforeRender as (...a: unknown[]) => void)(dummy.renderer, dummy.scene, dummy.camera, dummy.geometry, dummy.material, dummy.group);
    expect(material.uniformsNeedUpdate).toBe(true);
    const rectA = (material.uniforms.uSatRect!.value as THREE.Vector4).clone();

    material.uniformsNeedUpdate = false;
    (meshB!.onBeforeRender as (...a: unknown[]) => void)(dummy.renderer, dummy.scene, dummy.camera, dummy.geometry, dummy.material, dummy.group);
    expect(material.uniformsNeedUpdate).toBe(true);
    const rectB = (material.uniforms.uSatRect!.value as THREE.Vector4).clone();

    expect(rectA.equals(rectB)).toBe(false);
  });
});
