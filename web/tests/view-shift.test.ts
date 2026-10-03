import { describe, expect, it } from "vitest";
import { globeShiftPx } from "../src/render/view-shift";

describe("globeShiftPx — globe centré dans l'espace libre entre bandeau et couches (mobile, 2026-10-03)", () => {
  it("412×915 : bandeau jusqu'à 115 px, couches dès 755 px → 22,5 arrondi à 23 px vers le haut", () => {
    expect(globeShiftPx(915, 115, 755)).toBe(23);
  });
  it("espace libre déjà centré : aucun décalage", () => {
    expect(globeShiftPx(800, 100, 700)).toBe(0);
  });
  it("interface du haut plus haute que celle du bas : décalage vers le bas (négatif)", () => {
    expect(globeShiftPx(800, 200, 760)).toBe(-80);
  });
  it("borné à 15 % de la hauteur ; entrées incohérentes → 0", () => {
    expect(globeShiftPx(800, 0, 400)).toBe(120);
    expect(globeShiftPx(800, 500, 400)).toBe(0);
    expect(globeShiftPx(0, 0, 0)).toBe(0);
    expect(globeShiftPx(Number.NaN, 10, 20)).toBe(0);
  });
});
