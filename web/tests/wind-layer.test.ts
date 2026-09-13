import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildTrailAlpha, buildTrailIndex, createWindLayer } from "../src/render/wind";

describe("buildTrailIndex / buildTrailAlpha — spec vent §8", () => {
  it("N·(K−1) segments (k, i) → (k+1, i), aucun segment de bouclage", () => {
    const idx = buildTrailIndex(3, 4);
    expect(idx).toBeInstanceOf(Uint32Array);
    expect(idx.length).toBe(3 * 3 * 2);
    expect([...idx.slice(0, 2)]).toEqual([0, 3]);           // slot 0 → slot 1, particule 0
    expect([...idx.slice(-2)]).toEqual([2 * 3 + 2, 3 * 3 + 2]); // slot 2 → slot 3, particule 2
    for (let s = 0; s < idx.length; s += 2) expect(idx[s + 1]! - idx[s]!).toBe(3);
  });
  it("alpha 0 à la queue, 1 à la tête, linéaire", () => {
    const a = buildTrailAlpha(2, 5);
    expect(a.length).toBe(10);
    expect(a[0]).toBe(0);
    expect(a[1]).toBe(0);
    expect(a[4]).toBeCloseTo(0.5, 9);
    expect(a[8]).toBe(1);
    expect(a[9]).toBe(1);
  });
});

describe("createWindLayer", () => {
  const positions = new Float32Array(4 * 3 * 3);
  const layer = createWindLayer(positions, 3, 4);
  it("LineSegments transparent, sans écriture de profondeur, dessiné après le globe, jamais cullé", () => {
    expect(layer.object).toBeInstanceOf(THREE.LineSegments);
    const m = layer.object.material as THREE.ShaderMaterial;
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(true);
    expect(layer.object.renderOrder).toBe(1);
    expect(layer.object.frustumCulled).toBe(false);
    expect(layer.object.visible).toBe(false);
  });
  it("partage le tampon de positions sans copie, usage dynamique", () => {
    const pos = layer.object.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(pos.array).toBe(positions);
    expect(pos.itemSize).toBe(3);
    expect(pos.usage).toBe(THREE.DynamicDrawUsage);
    expect(layer.object.geometry.getAttribute("aAlpha").count).toBe(12);
    expect(layer.object.geometry.index!.count).toBe(3 * 3 * 2);
  });
  it("markDirty signale l'attribut ; setMapStyle pose l'uniform", () => {
    const pos = layer.object.geometry.getAttribute("position") as THREE.BufferAttribute;
    const before = pos.version;
    layer.markDirty();
    expect(pos.version).toBe(before + 1);
    layer.setMapStyle(0.5);
    expect((layer.object.material as THREE.ShaderMaterial).uniforms.uMapStyle!.value).toBe(0.5);
  });
});
