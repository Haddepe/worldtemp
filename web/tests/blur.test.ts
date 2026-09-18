import { describe, expect, it } from "vitest";
import { blurRedChannel } from "../src/data/blur";

/** RGBA nord en haut à partir d'une fonction (x, y) → octet du canal R. */
function rgba(W: number, H: number, r: (x: number, y: number) => number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[(y * W + x) * 4] = r(x, y);
  return px;
}

const sum = (a: Uint8Array) => a.reduce((s, v) => s + v, 0);

describe("blurRedChannel — adoucissement des couches à fronts raides (nuages)", () => {
  it("σ = 0 : copie exacte du canal R", () => {
    const out = blurRedChannel(rgba(4, 3, (x, y) => x * 10 + y), 4, 3, 0);
    expect(out).toBeInstanceOf(Uint8Array);
    expect([...out]).toEqual([0, 10, 20, 30, 1, 11, 21, 31, 2, 12, 22, 32]);
  });
  it("un champ uniforme reste uniforme, bords et pôles compris", () => {
    const out = blurRedChannel(rgba(16, 9, () => 200), 16, 9, 1.2);
    expect(new Set(out)).toEqual(new Set([200]));
  });
  it("étale une impulsion en conservant la masse, symétriquement", () => {
    const W = 21, H = 21;
    const out = blurRedChannel(rgba(W, H, (x, y) => (x === 10 && y === 10 ? 255 : 0)), W, H, 1.2);
    const c = 10 * W + 10;
    expect(out[c]!).toBeLessThan(60);
    expect(out[c]!).toBeGreaterThan(out[c + 1]!);
    expect(out[c + 1]).toBe(out[c - 1]);
    expect(out[c + W]).toBe(out[c - W]);
    expect(out[c + 1]).toBe(out[c + W]);
    expect(Math.abs(sum(out) - 255)).toBeLessThan(12); // arrondis à l'octet près
  });
  it("boucle en longitude : une impulsion en x = 0 déborde sur x = W−1", () => {
    const W = 16, H = 9;
    const out = blurRedChannel(rgba(W, H, (x, y) => (x === 0 && y === 4 ? 255 : 0)), W, H, 1.2);
    expect(out[4 * W + (W - 1)]).toBe(out[4 * W + 1]);
    expect(out[4 * W + (W - 1)]!).toBeGreaterThan(0);
  });
  it("flipRows livre les rangées sud en premier (ordre d'une texture flipY)", () => {
    const px = rgba(8, 6, (x, y) => (y < 3 ? 250 : 0));
    const north = blurRedChannel(px, 8, 6, 1.2);
    const south = blurRedChannel(px, 8, 6, 1.2, true);
    for (let y = 0; y < 6; y++) {
      expect([...south.slice(y * 8, y * 8 + 8)]).toEqual([...north.slice((5 - y) * 8, (5 - y) * 8 + 8)]);
    }
  });
});
