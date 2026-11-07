import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTiledGlobe } from "../src/render/globe";
import { viewStateFrom } from "../src/tiles/lod";
import type { TileId } from "../src/tiles/grid";
import type { TileLoader } from "../src/tiles/loader";

const satTex = new THREE.Texture();
const mapTex = new THREE.Texture();
const forestTex = new THREE.Texture();

function fakeLoader(forestEnabled: boolean[] = [], leaves: TileId[][] = []): TileLoader {
  return {
    update: (l: TileId[]) => leaves.push(l),
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
    for (const name of ["uForest", "uForestRect", "uHasForest", "uForestOn", "uForestLut", "uForestChannels", "uForestSize"]) expect(frag).toContain(name);
    expect(u.uForestSize!.value).toBe(512);
    globe.setForestPalette(lut, { cover: 0, year: 1, share: 2 }, 256);
    expect(u.uForestSize!.value).toBe(256);
  });

  it("shader forêt : les lacs (satellite quasi noir, non bleu) sont relevés à la teinte d'océan, pas laissés noirs", () => {
    const globe = createTiledGlobe("high", fakeLoader(), 8);
    globe.update(frontView());
    const frag = ((globe.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).fragmentShader.replace(/\s+/g, " ");
    const branch = frag.slice(frag.indexOf("if (uForestOn > 0.5) {"), frag.indexOf("} else if (uHasLayer"));
    expect(branch).toContain("float lake = 1.0 - uMapStyle;"); // pas de masque terre/mer : OSM compte les lacs en terres
    expect(branch).toContain("lake *= 1.0 - smoothstep(0.003, 0.0045, sat.b - max(sat.r, sat.g));"); // non bleu seul
    expect(branch).toContain("lake *= 1.0 - smoothstep(0.006, 0.012, max(sat.r, max(sat.g, sat.b)));"); // très sombre seul
    expect(branch).toContain("vec3 deepWater = vec3(0.0016, 0.0055, 0.025) * (0.25 + 0.75 * lambert);"); // teinte océan Blue Marble
    expect(branch).toContain("color = mix(background, max(background, deepWater), lake);");
    expect(branch.indexOf("max(background, deepWater)")).toBeLessThan(branch.indexOf("if (uHasForest > 0.5)")); // avant la forêt
  });

  it("shader forêt : poids de lac sur des pixels Blue Marble mesurés (lacs relevés, océan et forêts intacts)", () => {
    // Miroir TS des deux lignes `lake *=` du shader, sur des pixels sRGB mesurés dans blue-marble-4k.jpg.
    const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const smooth = (a: number, b: number, x: number) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
    const weight = (srgb: [number, number, number]) => {
      const [r, g, b] = srgb.map(lin) as [number, number, number];
      return (1 - smooth(0.003, 0.0045, b - Math.max(r, g))) * (1 - smooth(0.006, 0.012, Math.max(r, g, b)));
    };
    for (const lakePx of [[1, 7, 3], [3, 2, 5], [0, 3, 6], [0, 8, 8]] as const) expect(weight([...lakePx])).toBeGreaterThan(0.99); // Victoria, Tanganyika, Supérieur, Baïkal
    for (const px of [[5, 15, 42], [9, 24, 58], [2, 5, 20], [28, 70, 128], [26, 53, 68], [60, 58, 30], [15, 35, 10], [81, 64, 44]] as const) expect(weight([...px])).toBeLessThan(0.01); // Pacifique, Guinée, océan très sombre, plateau, Bahamas, sédiments, forêt dense, savane
  });

  it("shader forêt : l'année (code) est lue au centre exact du texel le plus proche, niveau 0, jamais interpolée", () => {
    const globe = createTiledGlobe("high", fakeLoader(), 8);
    globe.update(frontView());
    const frag = ((globe.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).fragmentShader.replace(/\s+/g, " ");
    expect(frag).toContain("vec2 uvF = uForestRect.xy + vUv * uForestRect.zw;");
    expect(frag).toContain("vec2 centre = (floor(uvF * uForestSize) + 0.5) / uForestSize;");
    expect(frag).toContain("float year = (uForestChannels * textureLod(uForest, centre, 0.0).rgb).y;");
    expect(frag).toContain("vec2((year * 255.0 + 0.5) / 256.0, 0.75)"); // pertes indexées par l'année exacte
    expect(frag).not.toContain("f.y * 255.0");                           // jamais l'année filtrée
  });

  it("setForestMaxLevel : sous Forest, la sélection descend jusqu'au niveau forêt ; hors Forest, levelCap seul", () => {
    const leaves: TileId[][] = [];
    const globe = createTiledGlobe("high", fakeLoader([], leaves), 8);
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.001, 10);
    camera.position.set(0, 0, 1.0105);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const view = viewStateFrom(camera, 720);
    const maxZ = () => Math.max(...leaves[leaves.length - 1]!.map((t) => t.z));
    globe.setForestMaxLevel(9);
    globe.update(view);
    expect(maxZ()).toBe(8); // Forest éteinte : plafond inchangé
    globe.setForest(true);
    globe.update(view);
    expect(maxZ()).toBe(9);
    globe.setForestMaxLevel(6); // plus bas que levelCap : levelCap l'emporte
    globe.update(view);
    expect(maxZ()).toBe(8);
    globe.setForestMaxLevel(9);
    globe.setForest(false);
    globe.update(view);
    expect(maxZ()).toBe(8);
  });
});
