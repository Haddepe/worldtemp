import { describe, expect, it } from "vitest";
import { IndexError, TileIndex } from "../src/tiles/index";

function bytes(...b: number[]): ArrayBuffer {
  return Uint8Array.from(b).buffer;
}
const W = 0x57, T = 0x54, I = 0x49, X = 0x58;

describe("TileIndex.parse (même agencement que tiler/encode.py)", () => {
  it("lit les bits y-majeur, LSB en premier", () => {
    // niveau 0 : tuile (1,0) → bit 1 ; niveau 1 : tuile (0,1) → i = 1·4 + 0 = 4 → bit 4
    const idx = TileIndex.parse(bytes(W, T, I, X, 1, 1, 0b00000010, 0b00010000));
    expect(idx.maxLevel).toBe(1);
    expect(idx.has(0, 1, 0)).toBe(true);
    expect(idx.has(0, 0, 0)).toBe(false);
    expect(idx.has(1, 0, 1)).toBe(true);
    expect(idx.has(1, 3, 1)).toBe(false);
    expect(idx.has(2, 0, 0)).toBe(false);
  });

  it("rejette magic, version et troncature", () => {
    expect(() => TileIndex.parse(bytes(0, 0, 0, 0, 1, 0, 0))).toThrow(IndexError);
    expect(() => TileIndex.parse(bytes(W, T, I, X, 2, 0, 0))).toThrow(IndexError);
    expect(() => TileIndex.parse(bytes(W, T, I, X, 1, 1, 0))).toThrow(/tronqué/);
  });

  it("taille attendue au niveau 8", () => {
    let size = 6;
    for (let z = 0; z <= 8; z++) size += Math.ceil((2 ** (z + 1) * 2 ** z) / 8);
    const buf = new Uint8Array(size);
    buf.set([W, T, I, X, 1, 8]);
    const idx = TileIndex.parse(buf.buffer);
    expect(idx.maxLevel).toBe(8);
    expect(idx.has(8, 511, 255)).toBe(false);
  });
});
