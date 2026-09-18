import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { WIND_WIDTH_PX, createWindLayer } from "../src/render/wind";

const N = 3;
const K = 4;

describe("createWindLayer — quads instanciés, un par segment de traînée", () => {
  const positions = new Float32Array(K * N * 3);
  const layer = createWindLayer(positions, N, K);
  const geometry = layer.object.geometry as THREE.InstancedBufferGeometry;
  const material = layer.object.material as THREE.ShaderMaterial;

  it("Mesh transparent, sans écriture de profondeur, dessiné après le globe, jamais cullé", () => {
    expect(layer.object).toBeInstanceOf(THREE.Mesh);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(layer.object.renderOrder).toBe(1);
    expect(layer.object.frustumCulled).toBe(false);
    expect(layer.object.visible).toBe(false);
  });
  it("N·(K−1) instances d'un quad de 4 sommets, aucun segment de bouclage", () => {
    expect(geometry).toBeInstanceOf(THREE.InstancedBufferGeometry);
    expect(geometry.instanceCount).toBe(N * (K - 1));
    expect(geometry.getAttribute("position").count).toBe(4);
    expect(geometry.index!.count).toBe(6);
  });
  it("aStart et aEnd lisent le tampon de la simulation sans copie, décalés d'un slot (N sommets)", () => {
    const start = geometry.getAttribute("aStart") as THREE.InterleavedBufferAttribute;
    const end = geometry.getAttribute("aEnd") as THREE.InterleavedBufferAttribute;
    expect(start.data).toBe(end.data);
    expect(start.data).toBeInstanceOf(THREE.InstancedInterleavedBuffer);
    expect(start.data.array).toBe(positions);
    expect(start.data.stride).toBe(3);
    expect(start.data.usage).toBe(THREE.DynamicDrawUsage);
    expect((start.data as THREE.InstancedInterleavedBuffer).meshPerAttribute).toBe(1);
    expect(start.itemSize).toBe(3);
    expect(start.offset).toBe(0);
    expect(end.offset).toBe(N * 3);
  });
  it("le shader reçoit N et K pour dériver l'alpha de gl_InstanceID", () => {
    expect(material.uniforms.uCount!.value).toBe(N);
    expect(material.uniforms.uTrail!.value).toBe(K);
  });
  it("markDirty signale le tampon partagé ; setMapStyle pose l'uniform", () => {
    const data = (geometry.getAttribute("aStart") as THREE.InterleavedBufferAttribute).data;
    const before = data.version;
    layer.markDirty();
    expect(data.version).toBe(before + 1);
    layer.setMapStyle(0.5);
    expect(material.uniforms.uMapStyle!.value).toBe(0.5);
  });
  it("avant chaque rendu : viewport en pixels du tampon, largeur en px CSS × pixel ratio", () => {
    const renderer = {
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(1600, 1200),
      getPixelRatio: () => 1.5,
    } as unknown as THREE.WebGLRenderer;
    (layer.object.onBeforeRender as (r: THREE.WebGLRenderer) => void)(renderer);
    expect(material.uniforms.uViewport!.value).toEqual(new THREE.Vector2(1600, 1200));
    expect(WIND_WIDTH_PX).toBe(2);
    expect(material.uniforms.uWidthPx!.value).toBe(3);
    expect(material.uniforms.uPixelRatio!.value).toBe(1.5);
  });
  it("refuse un tampon de taille inattendue", () => {
    expect(() => createWindLayer(new Float32Array(5), N, K)).toThrowError(/taille/);
  });
});
