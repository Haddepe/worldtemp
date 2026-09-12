import { describe, expect, it } from "vitest";
import { LAYERS, formatTemperature, layerDef } from "../src/layers/registry";

describe("registre des couches — spec couches §10", () => {
  it("sept couches dans l'ordre du menu", () => {
    expect(LAYERS.map((d) => d.id)).toEqual(["temp", "clouds", "rain", "pressure", "humidity", "pm25", "dust"]);
  });
  it("arrêts strictement croissants, alpha dans 0–255", () => {
    for (const d of LAYERS) {
      for (let i = 1; i < d.stops.length; i++) expect(d.stops[i]!.v).toBeGreaterThan(d.stops[i - 1]!.v);
      for (const s of d.stops) expect(s.rgba[3]).toBeGreaterThanOrEqual(0);
    }
  });
  it("couches transparentes : premier arrêt alpha 0 sous tooltipMin", () => {
    for (const id of ["rain", "pm25", "dust"]) {
      const d = layerDef(id)!;
      expect(d.tooltipMin).not.toBeNull();
      expect(d.stops[0]!.rgba[3]).toBe(0);
    }
    expect(layerDef("temp")!.tooltipMin).toBeNull();
  });
  it("pression seule avec isolignes (4 hPa)", () => {
    expect(LAYERS.filter((d) => d.isoStep !== null).map((d) => d.id)).toEqual(["pressure"]);
    expect(layerDef("pressure")!.isoStep).toBe(4);
  });
  it("formats", () => {
    expect(layerDef("temp")!.format(23.44)).toBe("23,4 °C");
    expect(layerDef("temp")!.format(-0.04)).toBe("0,0 °C");
    expect(layerDef("clouds")!.format(42.6)).toBe("43 %");
    expect(layerDef("rain")!.format(0.44)).toBe("0,4 mm/h");
    expect(layerDef("pressure")!.format(1013.25)).toBe("1013 hPa");
    expect(layerDef("humidity")!.format(99.5)).toBe("100 %");
    expect(layerDef("pm25")!.format(17.6)).toBe("18 µg/m³");
    expect(layerDef("dust")!.format(0)).toBe("0 µg/m³");
  });
  it("formatTemperature conserve la spec navigation §6", () => {
    expect(formatTemperature(-12.34)).toBe("−12,3 °C");
  });
  it("layerDef inconnu → undefined", () => expect(layerDef("wind")).toBeUndefined());
});
