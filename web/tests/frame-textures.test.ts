import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FrameTextures } from "../src/render/frame-textures";

const W = 3;
const H = 2;
const img = (key: string, first: number) => ({ key, data: Uint8Array.from({ length: W * H }, (_, i) => first + i) });
const bytes = (t: THREE.Texture) => [...((t.image as { data: Uint8Array }).data)];

describe("FrameTextures — spec lot E §5.3", () => {
  it("deux textures R8 à données brutes, mêmes réglages que les couches", () => {
    const ft = new FrameTextures(W, H);
    const { a } = ft.show(img("a", 1), null);
    const t = a as THREE.DataTexture;
    expect(t.format).toBe(THREE.RedFormat);
    expect(t.colorSpace).toBe(THREE.NoColorSpace);
    expect(t.minFilter).toBe(THREE.LinearFilter);
    expect(t.wrapS).toBe(THREE.RepeatWrapping);
    expect(t.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(t.flipY).toBe(false);
  });
  it("recopie nord en haut → sud en premier (ordre attendu par le shader)", () => {
    const ft = new FrameTextures(W, H);
    const { a, b } = ft.show(img("a", 1), null);
    expect(bytes(a)).toEqual([4, 5, 6, 1, 2, 3]);
    expect(b).toBeNull();
  });
  it("paire : deux textures distinctes", () => {
    const ft = new FrameTextures(W, H);
    const { a, b } = ft.show(img("a", 1), img("b", 10));
    expect(b).not.toBeNull();
    expect(b).not.toBe(a);
    expect(bytes(b!)).toEqual([13, 14, 15, 10, 11, 12]);
  });
  it("lecture en avant : l'ancienne B devient A sans recopie, C va dans l'autre texture", () => {
    const ft = new FrameTextures(W, H);
    const first = ft.show(img("a", 1), img("b", 10));
    const vb = first.b!.version;
    const second = ft.show(img("b", 10), img("c", 20));
    expect(second.a).toBe(first.b);
    expect(second.a.version).toBe(vb);
    expect(second.b).toBe(first.a);
    expect(bytes(second.b!)).toEqual([23, 24, 25, 20, 21, 22]);
  });
  it("même clé : aucune recopie ; b de même clé que a : ignorée", () => {
    const ft = new FrameTextures(W, H);
    const { a } = ft.show(img("a", 1), null);
    const v = a.version;
    expect(ft.show(img("a", 1), null).a.version).toBe(v);
    expect(ft.show(img("a", 1), img("a", 1)).b).toBeNull();
  });
  it("taille inattendue : erreur", () => {
    expect(() => new FrameTextures(W, H).show({ key: "x", data: new Uint8Array(5) }, null)).toThrowError(/expected 6/);
  });
});
