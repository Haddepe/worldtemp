import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HALO_FADE_FAR, HALO_FADE_NEAR, HALO_RADIUS, createHaloLayer, haloOpacity } from "../src/render/halo";

describe("haloOpacity — fondu du halo selon la distance caméra–centre", () => {
  it("plein de loin, éteint de près, monotone entre les deux", () => {
    expect(haloOpacity(4)).toBe(1);
    expect(haloOpacity(HALO_FADE_FAR)).toBe(1);
    expect(haloOpacity(HALO_FADE_NEAR)).toBe(0);
    expect(haloOpacity(1.05)).toBe(0);
    let last = 0;
    for (let d = HALO_FADE_NEAR; d <= HALO_FADE_FAR; d += 0.05) {
      const o = haloOpacity(d);
      expect(o).toBeGreaterThanOrEqual(last);
      expect(o).toBeLessThanOrEqual(1);
      last = o;
    }
  });

  it("éteint avant que la caméra n'entre dans la coque (sinon elle voilerait la carte)", () => {
    expect(HALO_FADE_NEAR).toBeGreaterThan(HALO_RADIUS);
  });
});

describe("createHaloLayer", () => {
  it("coque plus grande que le globe, vue par sa face arrière", () => {
    const { object } = createHaloLayer();
    const material = object.material as THREE.ShaderMaterial;
    object.geometry.computeBoundingSphere();
    expect(object.geometry.boundingSphere!.radius).toBeCloseTo(HALO_RADIUS, 5);
    expect(HALO_RADIUS).toBeGreaterThan(1.002); // au-dessus des traînées de vent
    expect(material.side).toBe(THREE.BackSide);
  });

  it("dessiné après le globe, masqué par lui, en lumière ajoutée", () => {
    const material = createHaloLayer().object.material as THREE.ShaderMaterial;
    // Passe transparente : après le globe opaque, dont la profondeur masque ce qui passe derrière lui.
    expect(material.transparent).toBe(true);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.blending).toBe(THREE.AdditiveBlending);
  });

  it("setView règle l'opacité et masque l'objet quand elle est nulle", () => {
    const layer = createHaloLayer();
    const material = layer.object.material as THREE.ShaderMaterial;
    layer.setView(3);
    expect(material.uniforms.uOpacity!.value).toBe(1);
    expect(layer.object.visible).toBe(true);
    layer.setView(1.05);
    expect(material.uniforms.uOpacity!.value).toBe(0);
    expect(layer.object.visible).toBe(false); // aucun draw call de près
  });

  it("les shaders nettoyés gardent leur point d'entrée", () => {
    const material = createHaloLayer().object.material as THREE.ShaderMaterial;
    expect(material.vertexShader).toContain("void main()");
    expect(material.fragmentShader).toContain("void main()");
    expect(material.fragmentShader).toContain("cameraPosition");
  });
});
