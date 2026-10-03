import { describe, expect, it } from "vitest";
import { PRIVACY_RADIUS_DEG, ViewGuard, angularDistanceDeg } from "../src/capture/privacy";

describe("angularDistanceDeg", () => {
  it("équateur, antiméridien, pôle", () => {
    expect(angularDistanceDeg(0, 0, 5, 0)).toBeCloseTo(5, 9);
    expect(angularDistanceDeg(179.5, 0, -179.5, 0)).toBeCloseTo(1, 9);
    expect(angularDistanceDeg(0, 89, 180, 89)).toBeCloseTo(2, 9);
  });
});

describe("ViewGuard — « ma position » jamais écrite dans l'URL (spec capture §2)", () => {
  it("rayon de 5°", () => {
    expect(PRIVACY_RADIUS_DEG).toBe(5);
  });
  it("sans localisation : écriture permise", () => {
    expect(new ViewGuard().mayWrite(2.35, 48.86)).toBe(true);
  });
  it("après localisation : refusée à 0° et 4,9°, permise à 5,1°", () => {
    const g = new ViewGuard();
    g.located(0, 0);
    expect(g.mayWrite(0, 0)).toBe(false);
    expect(g.mayWrite(4.9, 0)).toBe(false);
    expect(g.mayWrite(5.1, 0)).toBe(true);
  });
  it("une fois sortie du rayon, l'écriture reste permise en revenant", () => {
    const g = new ViewGuard();
    g.located(0, 0);
    expect(g.mayWrite(10, 0)).toBe(true);
    expect(g.mayWrite(0, 0)).toBe(true);
  });
  it("choix d'une ville : levée immédiate", () => {
    const g = new ViewGuard();
    g.located(6.45, 48.17);
    g.cityChosen();
    expect(g.mayWrite(6.45, 48.17)).toBe(true);
  });
  it("antiméridien et pôle : la proximité se mesure sur la sphère", () => {
    const a = new ViewGuard();
    a.located(179.5, 0);
    expect(a.mayWrite(-179.5, 0)).toBe(false);
    const b = new ViewGuard();
    b.located(0, 89);
    expect(b.mayWrite(180, 89)).toBe(false);
  });
});
