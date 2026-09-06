import { describe, expect, it } from "vitest";
import { TapDetector, placeTooltip } from "../src/ui/tooltip";

describe("TapDetector — spec navigation §6", () => {
  it("tap valide : down puis up < 300 ms, < 8 px → position du down", () => {
    const d = new TapDetector();
    expect(d.feed({ type: "down", id: 1, x: 100, y: 100, t: 0 })).toBeNull();
    expect(d.feed({ type: "move", id: 1, x: 103, y: 102, t: 50 })).toBeNull();
    expect(d.feed({ type: "up", id: 1, x: 103, y: 102, t: 120 })).toEqual({ x: 100, y: 100 });
  });
  it("glisser > 8 px → pas de tap", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    d.feed({ type: "move", id: 1, x: 10, y: 0, t: 50 });
    expect(d.feed({ type: "up", id: 1, x: 10, y: 0, t: 100 })).toBeNull();
  });
  it("durée ≥ 300 ms → pas de tap", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    expect(d.feed({ type: "up", id: 1, x: 0, y: 0, t: 300 })).toBeNull();
  });
  it("second doigt pendant le geste → pas de tap, même après son retrait", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    d.feed({ type: "down", id: 2, x: 50, y: 50, t: 10 });
    d.feed({ type: "up", id: 2, x: 50, y: 50, t: 20 });
    expect(d.feed({ type: "up", id: 1, x: 0, y: 0, t: 30 })).toBeNull();
  });
  it("cancel réinitialise", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    d.feed({ type: "cancel", id: 1, x: 0, y: 0, t: 10 });
    expect(d.feed({ type: "up", id: 1, x: 0, y: 0, t: 20 })).toBeNull();
    d.feed({ type: "down", id: 1, x: 5, y: 5, t: 100 });
    expect(d.feed({ type: "up", id: 1, x: 5, y: 5, t: 150 })).toEqual({ x: 5, y: 5 });
  });
  it("le geste suivant repart de zéro après un tap", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    d.feed({ type: "up", id: 1, x: 0, y: 0, t: 10 });
    d.feed({ type: "down", id: 2, x: 9, y: 9, t: 500 });
    expect(d.feed({ type: "up", id: 2, x: 9, y: 9, t: 510 })).toEqual({ x: 9, y: 9 });
  });
});

describe("placeTooltip", () => {
  const tip = { w: 80, h: 30 };
  const vp = { w: 1000, h: 800 };
  it("au-dessus du point, centré, décalage 14 px", () => {
    expect(placeTooltip({ x: 500, y: 400 }, tip, vp)).toEqual({ left: 460, top: 356 });
  });
  it("en dessous si le point est à moins de 48 px du haut", () => {
    expect(placeTooltip({ x: 500, y: 40 }, tip, vp)).toEqual({ left: 460, top: 54 });
  });
  it("borné horizontalement dans le viewport (marge 4 px)", () => {
    expect(placeTooltip({ x: 10, y: 400 }, tip, vp).left).toBe(4);
    expect(placeTooltip({ x: 995, y: 400 }, tip, vp).left).toBe(1000 - 80 - 4);
  });
});
