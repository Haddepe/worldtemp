import { describe, expect, it } from "vitest";
import { decode, encode, type Encoding } from "../src/data/encoding";

const LIN: Encoding = { bits: 8, min: -90, max: 60, scale: "linear" };
const SQRT: Encoding = { bits: 8, min: 0, max: 50, scale: "sqrt" };

// Table partagée avec tests/pipeline/test_texture.py::ROUNDTRIP_CASES — modifier les deux ensemble.
const CASES: [Encoding, number, number][] = [
  [LIN, -90, 0], [LIN, 60, 255], [LIN, 0, 153], [LIN, 20, 187], [LIN, -100, 0], [LIN, 70, 255],
  [SQRT, 0, 0], [SQRT, 50, 255], [SQRT, 0.5, 26], [SQRT, 2, 51], [SQRT, 12.5, 128], [SQRT, 60, 255],
];

describe("encode — miroir de pipeline/texture.py::quantize", () => {
  it.each(CASES)("%o : %f → %i", (enc, v, px) => expect(encode(v, enc)).toBe(px));
});

describe("decode", () => {
  it("linéaire : 0 → min, 255 → max, 153 → 0 °C", () => {
    expect(decode(0, LIN)).toBe(-90);
    expect(decode(255, LIN)).toBe(60);
    expect(decode(153, LIN)).toBeCloseTo(0, 6);
  });
  it("racine : quadratique en i/255", () => {
    expect(decode(255, SQRT)).toBe(50);
    expect(decode(128, SQRT)).toBeCloseTo(50 * (128 / 255) ** 2, 9);
  });
  it("encode ∘ decode est l'identité sur les 256 octets", () => {
    for (const enc of [LIN, SQRT]) for (let i = 0; i < 256; i++) expect(encode(decode(i, enc), enc)).toBe(i);
  });
});
