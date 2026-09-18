import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RIVER_WIDTH_PX, createRiversLayer, riverMaxRank } from "../src/render/rivers";
import type { RiverSegments } from "../src/rivers/data";

/** 2 segments de rang 1, 3 de rang 4, 5 de rang 9. */
const SEG: RiverSegments = {
  count: 10,
  starts: new Float32Array(30),
  ends: new Float32Array(30),
  ranks: new Float32Array([1, 1, 4, 4, 4, 9, 9, 9, 9, 9]),
  countByRank: new Uint32Array([0, 2, 2, 2, 5, 5, 5, 5, 5, 10]),
};

describe("riverMaxRank — apparition selon le zoom (spec repères §5)", () => {
  it("3 de loin, 5 à d = 1,6, 7 à d = 1,25, tout au plus près, interpolé entre", () => {
    expect(riverMaxRank(4, 12)).toBe(3);
    expect(riverMaxRank(2.5, 12)).toBe(3);
    expect(riverMaxRank(1.6, 12)).toBe(5);
    expect(riverMaxRank(2.05, 12)).toBeCloseTo(4, 6);
    expect(riverMaxRank(1.25, 12)).toBe(7);
    expect(riverMaxRank(1.05, 12)).toBe(12);
  });
  it("jamais au-delà du rang maximal des données", () => {
    expect(riverMaxRank(1.25, 4)).toBe(4);
  });
});

describe("createRiversLayer", () => {
  const layer = createRiversLayer(SEG);
  const geometry = layer.object.geometry as THREE.InstancedBufferGeometry;
  const material = layer.object.material as THREE.ShaderMaterial;

  it("Mesh transparent sans écriture de profondeur, sous le vent, jamais cullé, caché au départ", () => {
    expect(layer.object).toBeInstanceOf(THREE.Mesh);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(layer.object.renderOrder).toBe(1);
    expect(layer.object.frustumCulled).toBe(false);
    expect(layer.object.visible).toBe(false);
  });
  it("tampons statiques, un par attribut d'instance", () => {
    for (const [name, size] of [["aStart", 3], ["aEnd", 3], ["aRank", 1]] as const) {
      const attr = geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      expect(attr).toBeInstanceOf(THREE.InstancedBufferAttribute);
      expect(attr.itemSize).toBe(size);
      expect(attr.count).toBe(10);
      expect(attr.usage).toBe(THREE.StaticDrawUsage);
    }
    expect((geometry.getAttribute("aStart") as THREE.InstancedBufferAttribute).array).toBe(SEG.starts);
  });
  it("setView : instanceCount = préfixe des rangs admis, uMaxRank flottant, uMapStyle", () => {
    layer.setView(4, 0);
    expect(geometry.instanceCount).toBe(2);           // rang ≤ 3
    expect(material.uniforms.uMaxRank!.value).toBe(3);
    layer.setView(2.05, 0.5);
    expect(material.uniforms.uMaxRank!.value).toBeCloseTo(4, 6);
    expect(geometry.instanceCount).toBe(5);           // rang ≤ 4
    expect(material.uniforms.uMapStyle!.value).toBe(0.5);
    layer.setView(1.05, 1);
    expect(geometry.instanceCount).toBe(10);
  });
  it("rang fractionnaire : le rang suivant est déjà dessiné, en fondu", () => {
    layer.setView(1.9, 0); // entre 3 (d = 2,5) et 5 (d = 1,6) : ≈ 4,33 → rang 5 admis pour le fondu
    expect(material.uniforms.uMaxRank!.value).toBeGreaterThan(4);
    expect(geometry.instanceCount).toBe(5);           // countByRank[5]
  });
  it("avant chaque rendu : viewport et largeur × pixel ratio", () => {
    const renderer = { getDrawingBufferSize: (v: THREE.Vector2) => v.set(1600, 1200), getPixelRatio: () => 2 } as unknown as THREE.WebGLRenderer;
    (layer.object.onBeforeRender as (r: THREE.WebGLRenderer) => void)(renderer);
    expect(material.uniforms.uViewport!.value).toEqual(new THREE.Vector2(1600, 1200));
    expect(RIVER_WIDTH_PX).toBe(1.5);
    expect(material.uniforms.uWidthPx!.value).toBe(3);
  });
  it("le vertex shader embarque le fragment partagé", () => {
    expect(material.vertexShader).toContain("vec4 screenQuad(");
    expect(material.vertexShader.indexOf("vec4 screenQuad(")).toBeLessThan(material.vertexShader.indexOf("void main()"));
  });
  it("données vides : rien à dessiner, pas d'exception", () => {
    const empty = createRiversLayer({ count: 0, starts: new Float32Array(0), ends: new Float32Array(0), ranks: new Float32Array(0), countByRank: new Uint32Array([0]) });
    empty.setView(2, 0);
    expect((empty.object.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
  });
});
