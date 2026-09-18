import { describe, expect, it } from "vitest";
import { MAX_SEGMENT_DEG, RIVER_RADIUS, RiversError, parseRivers } from "../src/rivers/data";
import { encodeRivers } from "./rivers-fixture";

const len = (a: Float32Array, i: number) => Math.hypot(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!);
const angleDeg = (s: Float32Array, e: Float32Array, i: number) => {
  const dot = (s[i * 3]! * e[i * 3]! + s[i * 3 + 1]! * e[i * 3 + 1]! + s[i * 3 + 2]! * e[i * 3 + 2]!) / (RIVER_RADIUS * RIVER_RADIUS);
  return (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
};

describe("parseRivers — spec repères §5", () => {
  it("segments au rayon 1,001, un par paire de points consécutifs", () => {
    const r = parseRivers(encodeRivers([[1, [[0, 0], [100, 0], [100, 100]]]]));
    expect(r.count).toBe(2);
    expect(len(r.starts, 0)).toBeCloseTo(RIVER_RADIUS, 6);
    expect(len(r.ends, 1)).toBeCloseTo(RIVER_RADIUS, 6);
    expect([r.ends[0], r.ends[1], r.ends[2]]).toEqual([r.starts[3], r.starts[4], r.starts[5]]);
    expect([...r.ranks]).toEqual([1, 1]);
  });
  it("subdivise au-delà de 2° : 5° → 3 segments contigus de moins de 2°", () => {
    const r = parseRivers(encodeRivers([[2, [[0, 0], [500, 0]]]]));
    expect(r.count).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(angleDeg(r.starts, r.ends, i)).toBeLessThanOrEqual(MAX_SEGMENT_DEG + 1e-6);
      expect(len(r.ends, i)).toBeCloseTo(RIVER_RADIUS, 6);
    }
    expect(r.ends[3]).toBeCloseTo(r.starts[6]!, 6);
  });
  it("countByRank cumule par rang, y compris les rangs sans segment", () => {
    const r = parseRivers(encodeRivers([[1, [[0, 0], [100, 0]]], [1, [[0, 0], [0, 100]]], [4, [[0, 0], [100, 100], [200, 100]]]]));
    expect([...r.countByRank]).toEqual([0, 2, 2, 2, 4]);
  });
  it("traverse l'antiméridien sans segment géant", () => {
    const r = parseRivers(encodeRivers([[1, [[17990, 0], [-17990, 0]]]]));
    expect(r.count).toBe(1);
    expect(angleDeg(r.starts, r.ends, 0)).toBeCloseTo(0.2, 3);
  });
  it.each([
    ["magic", encodeRivers([], "XXXX")],
    ["version", encodeRivers([], "WTRV", 2)],
    ["tampon tronqué", encodeRivers([[1, [[0, 0], [100, 0]]]]).slice(0, 16)],
    ["trop court pour un en-tête", new ArrayBuffer(6)],
    ["longitude hors bornes", encodeRivers([[1, [[18001, 0], [0, 0]]]])],
    ["latitude hors bornes", encodeRivers([[1, [[0, 9001], [0, 0]]]])],
    ["ligne d'un seul point", encodeRivers([[1, [[0, 0]]]])],
    ["rangs non triés", encodeRivers([[3, [[0, 0], [100, 0]]], [1, [[0, 0], [0, 100]]]])],
  ])("refuse : %s", (_label, buf) => {
    expect(() => parseRivers(buf)).toThrowError(RiversError);
  });
  it("octets en trop après la dernière ligne : refusé", () => {
    const ok = new Uint8Array(encodeRivers([[1, [[0, 0], [100, 0]]]]));
    const padded = new Uint8Array(ok.length + 2);
    padded.set(ok);
    expect(() => parseRivers(padded.buffer)).toThrowError(RiversError);
  });
});
