import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { STAR_COUNT, buildStarfield, createStarsLayer } from "../src/render/stars";

describe("buildStarfield — ciel procédural déterministe", () => {
  it("même graine, même ciel ; graine différente, ciel différent", () => {
    const a = buildStarfield(500, 42);
    const b = buildStarfield(500, 42);
    const c = buildStarfield(500, 43);
    expect(Array.from(a.directions)).toEqual(Array.from(b.directions));
    expect(Array.from(a.sizes)).toEqual(Array.from(b.sizes));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.directions)).not.toEqual(Array.from(c.directions));
  });

  it("directions unité, réparties sur toute la sphère", () => {
    const s = buildStarfield(4000, 7);
    expect(s.count).toBe(4000);
    expect(s.directions.length).toBe(12000);
    const octants = new Array<number>(8).fill(0);
    for (let i = 0; i < s.count; i++) {
      const x = s.directions[i * 3]!, y = s.directions[i * 3 + 1]!, z = s.directions[i * 3 + 2]!;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      octants[(x > 0 ? 1 : 0) + (y > 0 ? 2 : 0) + (z > 0 ? 4 : 0)]!++;
    }
    // 500 attendues par octant : une répartition uniforme reste largement entre 400 et 600.
    for (const n of octants) {
      expect(n).toBeGreaterThan(400);
      expect(n).toBeLessThan(600);
    }
  });

  it("tailles de 1,2 à 3 px, couleurs dans [0, 1], beaucoup d'étoiles faibles et peu de brillantes", () => {
    const s = buildStarfield(4000, 7);
    let bright = 0;
    let faint = 0;
    for (let i = 0; i < s.count; i++) {
      const size = s.sizes[i]!;
      expect(size).toBeGreaterThanOrEqual(1.2);
      expect(size).toBeLessThanOrEqual(3);
      const peak = Math.max(s.colors[i * 3]!, s.colors[i * 3 + 1]!, s.colors[i * 3 + 2]!);
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThanOrEqual(1);
      if (peak > 0.8) bright++;
      if (peak < 0.45) faint++;
    }
    expect(faint).toBeGreaterThan(s.count * 0.5);
    expect(bright).toBeLessThan(s.count * 0.12);
    expect(bright).toBeGreaterThan(0);
  });
});

describe("createStarsLayer", () => {
  it("moins d'étoiles sur le profil modeste", () => {
    expect(STAR_COUNT.low).toBeLessThan(STAR_COUNT.high);
    const layer = createStarsLayer("low");
    expect(layer.object.geometry.getAttribute("position").count).toBe(STAR_COUNT.low);
    expect(layer.object.geometry.getAttribute("aSize").count).toBe(STAR_COUNT.low);
    expect(layer.object.geometry.getAttribute("aColor").count).toBe(STAR_COUNT.low);
  });

  it("dessiné avant le globe, sans profondeur, jamais écarté par le frustum", () => {
    const { object } = createStarsLayer("high");
    const material = object.material as THREE.ShaderMaterial;
    expect(object.renderOrder).toBeLessThan(0);
    expect(object.frustumCulled).toBe(false);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    // `transparent: true` enverrait les étoiles dans la passe transparente, APRÈS le globe opaque :
    // sans test de profondeur, elles se dessineraient par-dessus lui.
    expect(material.transparent).toBe(false);
    expect(material.blending).toBe(THREE.AdditiveBlending);
  });

  it("la taille des points suit le pixel ratio du moteur de rendu", () => {
    const { object } = createStarsLayer("high");
    const material = object.material as THREE.ShaderMaterial;
    const fakeRenderer = { getPixelRatio: () => 1.5 } as unknown as THREE.WebGLRenderer;
    object.onBeforeRender(fakeRenderer, new THREE.Scene(), new THREE.PerspectiveCamera(), object.geometry, material, null as never);
    expect(material.uniforms.uPixelRatio!.value).toBe(1.5);
  });

  it("les shaders nettoyés gardent leur point d'entrée et placent les étoiles à l'infini", () => {
    const material = createStarsLayer("high").object.material as THREE.ShaderMaterial;
    expect(material.vertexShader).toContain("void main()");
    expect(material.fragmentShader).toContain("void main()");
    expect(material.vertexShader).toContain("mat3(viewMatrix)"); // rotation seule : pas de parallaxe au zoom
  });
});
