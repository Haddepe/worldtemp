import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTiledGlobe } from "../src/render/globe";
import { viewStateFrom } from "../src/tiles/lod";
import type { TileId } from "../src/tiles/grid";
import type { TileLoader } from "../src/tiles/loader";

const satTex = new THREE.Texture();
const mapTex = new THREE.Texture();
const forestTex = new THREE.Texture();

function fakeLoader(forestEnabled: boolean[] = []): TileLoader {
  return {
    update: () => {},
    isOcean: () => false,
    get: () => undefined,
    usedBytes: 0,
    dispose: () => {},
    setForestEnabled: (on: boolean) => forestEnabled.push(on),
    forestTile: (t: TileId) => t,
    resolve: (t: TileId, set: "sat" | "map" | "forest") => ({
      tile: { z: 0, x: t.x >> t.z, y: 0 },
      texture: set === "sat" ? satTex : set === "map" ? mapTex : forestTex,
    }),
  } as unknown as TileLoader;
}

function frontView() {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.01, 10);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return viewStateFrom(camera, 720);
}

const render = (mesh: THREE.Mesh) => (mesh.onBeforeRender as (...a: unknown[]) => void)({}, {}, {}, {}, {}, {});

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

  it("setLayer / setIsoStep / setLut posent les uniforms de couche (spec couches §10)", () => {
    const globe = createTiledGlobe("high", fakeLoader(), 8);
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.01, 10);
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    globe.update(viewStateFrom(camera, 720));
    const material = (globe.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    const u = material.uniforms;
    expect(u.uHasLayer!.value).toBe(0);
    expect(u.uIsoStep!.value).toBe(0);
    const tex = new THREE.Texture();
    globe.setLayer(tex, 1440, 721);
    expect(u.uLayerA!.value).toBe(tex);
    expect(u.uLayerB!.value).toBe(tex);
    expect(u.uMix!.value).toBe(0);
    expect(u.uHasLayer!.value).toBe(1);
    const next = new THREE.Texture();
    globe.setLayer(tex, 1440, 721, next, 0.25);
    expect(u.uLayerB!.value).toBe(next);
    expect(u.uMix!.value).toBe(0.25);
    globe.setLayer(tex, 1440, 721, null, 0.25);
    expect(u.uMix!.value).toBe(0); // pas de B : pas de mélange
    expect((u.uGridSize!.value as THREE.Vector2).x).toBe(1440);
    globe.setIsoStep(4 / 120);
    expect(u.uIsoStep!.value).toBeCloseTo(1 / 30, 12);
    const lut = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1);
    globe.setLut(lut);
    expect(u.uLut!.value).toBe(lut);
    globe.setLayer(null, 1440, 721);
    expect(u.uHasLayer!.value).toBe(0);
    expect(u.uLayerA!.value).toBeNull();
    expect(material.fragmentShader).toContain("uIsoStep");
    expect(material.fragmentShader).not.toContain("uFilter");
    expect(material.fragmentShader).toContain("uMix");
    expect(material.fragmentShader).not.toContain("uLayer;");
    // `step` est une fonction native GLSL : la masquer en paramètre casse la compilation sur certains pilotes.
    expect(material.fragmentShader).toContain("float isoline(float t, float spacing)");
  });

  it("setForest : jeu forest activé dans le loader, uniforms de patch posés, couche météo laissée telle quelle", () => {
    const enabled: boolean[] = [];
    const globe = createTiledGlobe("high", fakeLoader(enabled), 8);
    globe.update(frontView());
    const mesh = globe.group.children[0] as THREE.Mesh;
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    render(mesh);
    expect(u.uForestOn!.value).toBe(0);
    expect(u.uHasForest!.value).toBe(0);           // couche éteinte : le jeu forest n'est pas échantillonné
    const weather = new THREE.Texture();
    globe.setLayer(weather, 1440, 721);
    globe.setForest(true);
    expect(enabled).toEqual([true]);
    expect(u.uForestOn!.value).toBe(1);
    globe.update(frontView());
    render(mesh);
    expect(u.uHasForest!.value).toBe(1);
    expect(u.uForest!.value).toBe(forestTex);
    expect((u.uForestRect!.value as THREE.Vector4).z).toBeLessThan(1); // sous-rectangle de l'ancêtre
    globe.setForest(false);
    expect(enabled).toEqual([true, false]);
    expect(u.uForestOn!.value).toBe(0);
    globe.update(frontView());
    render(mesh);
    expect(u.uHasForest!.value).toBe(0);
    expect(u.uLayerA!.value).toBe(weather);       // Review Focus 2 : la couche météo revient intacte
    expect(u.uHasLayer!.value).toBe(1);
  });

  it("setForestPalette : LUT et matrice des canaux du manifeste", () => {
    const globe = createTiledGlobe("high", fakeLoader(), 8);
    globe.update(frontView());
    const u = ((globe.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
    const lut = new THREE.DataTexture(new Uint8Array(256 * 2 * 4), 256, 2);
    globe.setForestPalette(lut, { cover: 2, year: 0, share: 1 });
    expect(u.uForestLut!.value).toBe(lut);
    // ligne k = grandeur k (couvert, année, part) ; 1 dans la colonne de son canal. Matrix3 : colonnes d'abord.
    const e = (u.uForestChannels!.value as THREE.Matrix3).elements;
    const at = (row: number, col: number) => e[col * 3 + row];
    expect([at(0, 2), at(1, 0), at(2, 1)]).toEqual([1, 1, 1]);
    expect(e.reduce((a, b) => a + b, 0)).toBe(3);
    const frag = ((globe.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).fragmentShader;
    for (const name of ["uForest", "uForestRect", "uHasForest", "uForestOn", "uForestLut", "uForestChannels"]) expect(frag).toContain(name);
  });
});
