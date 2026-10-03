import { describe, expect, it } from "vitest";
import { parseFlag, withFlag, withView, withoutView } from "../src/geo/params";

describe("parseFlag / withFlag — ?labels=, ?rivers= (spec repères §6)", () => {
  it("1 et 0 explicites, sinon le repli (actif par défaut)", () => {
    expect(parseFlag("?labels=1", "labels")).toBe(true);
    expect(parseFlag("?labels=0", "labels")).toBe(false);
    expect(parseFlag("", "labels")).toBe(true);
    expect(parseFlag("?labels=oui", "labels")).toBe(true);
    expect(parseFlag("?rivers=x", "rivers", false)).toBe(false);
  });
  it("withFlag ne réécrit que son paramètre", () => {
    expect(withFlag("?layer=temp&wind=1", "labels", false)).toBe("?layer=temp&wind=1&labels=0");
    expect(withFlag("?labels=0&d=2", "labels", true)).toBe("?labels=1&d=2");
  });
});

describe("withView — URL partageable après un vol", () => {
  it("réécrit lon, lat (2 décimales) et d (3 décimales), garde le reste", () => {
    expect(withView("?layer=temp&lon=1&d=3", 6.44976, 48.17264, 1.15)).toBe("?layer=temp&lon=6.45&d=1.150&lat=48.17");
  });
});

describe("withoutView — retrait de la vue après « ma position »", () => {
  it("retire lon, lat, d et garde le reste", () => {
    expect(withoutView("?layer=temp&lon=1&lat=2&d=1.300&wind=1")).toBe("?layer=temp&wind=1");
  });
  it("rien d'autre : « ? », jamais une chaîne vide", () => {
    expect(withoutView("?lon=1&lat=2&d=3")).toBe("?");
    expect(withoutView("")).toBe("?");
  });
});
