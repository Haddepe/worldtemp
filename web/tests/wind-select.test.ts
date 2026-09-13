import { describe, expect, it } from "vitest";
import { parseWindParam, withWindParam } from "../src/wind/select";

describe("parseWindParam — spec vent §9", () => {
  it("?wind=1 et ?wind=0 priment sur tout", () => {
    expect(parseWindParam("?wind=1", "low", true)).toBe(true);
    expect(parseWindParam("?wind=0", "high", false)).toBe(false);
  });
  it("reduced-motion désactive quand l'URL ne dit rien", () => {
    expect(parseWindParam("", "high", true)).toBe(false);
    expect(parseWindParam("?layer=temp", "high", true)).toBe(false);
  });
  it("sinon high → actif, low → inactif", () => {
    expect(parseWindParam("", "high", false)).toBe(true);
    expect(parseWindParam("?layer=rain", "low", false)).toBe(false);
  });
  it("valeur inconnue = absente", () => {
    expect(parseWindParam("?wind=yes", "high", false)).toBe(true);
    expect(parseWindParam("?wind=yes", "low", false)).toBe(false);
  });
});

describe("withWindParam", () => {
  it("réécrit seulement wind et préserve les autres paramètres", () => {
    expect(withWindParam("?layer=rain&lon=1.5&lat=48&d=1.3&wind=1", false)).toBe("?layer=rain&lon=1.5&lat=48&d=1.3&wind=0");
    expect(withWindParam("", true)).toBe("?wind=1");
  });
});
