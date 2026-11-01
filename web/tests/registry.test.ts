import { describe, expect, it } from "vitest";
import { LAYERS, formatSnow, formatTemperature, layerDef, layerKind } from "../src/layers/registry";

describe("registre des couches — spec couches §10", () => {
  it("dix entrées dans l'ordre du menu (neige : une couche + son mode ; forêt en dernier)", () => {
    expect(LAYERS.map((d) => d.id)).toEqual(["temp", "clouds", "rain", "pressure", "humidity", "pm25", "dust", "snowfall", "snow_depth", "forest"]);
  });
  it("forêt : seule couche « tiles », libellé Forest ; les autres sont des grilles (kind absent)", () => {
    expect(LAYERS.filter((d) => layerKind(d) === "tiles").map((d) => d.id)).toEqual(["forest"]);
    expect(LAYERS.filter((d) => d.id !== "forest").every((d) => d.kind === undefined)).toBe(true);
    const f = layerDef("forest")!;
    expect(f.label).toBe("Forest");
    expect(f.kind).toBe("tiles");
    expect(f.isoStep).toBeNull();
  });
  it("forêt : couvert transparent sous 30 %, opaque de 30 à 100 % ; pertes de 2001 (jaune) à 2024 (rouge)", () => {
    const f = layerDef("forest")!;
    for (const st of f.stops) expect(st.rgba[3] === 0).toBe(st.v < 30);
    expect(f.stops[f.stops.length - 1]!.v).toBe(100);
    const loss = f.lossStops!;
    expect(loss[0]!.v).toBe(2001);
    expect(loss[loss.length - 1]!.v).toBe(2024);
    for (let i = 1; i < loss.length; i++) expect(loss[i]!.v).toBeGreaterThan(loss[i - 1]!.v);
    const [r0, g0, b0] = loss[0]!.rgba;
    const [r1, g1, b1] = loss[loss.length - 1]!.rgba;
    expect(r0).toBeGreaterThan(200); expect(g0).toBeGreaterThan(180); expect(b0).toBeLessThan(100); // jaune
    expect(r1).toBeGreaterThan(200); expect(g1).toBeLessThan(40); expect(b1).toBeLessThan(40);      // rouge vif
    for (const st of loss) expect(st.rgba[3]).toBe(255); // l'opacité vient de la part perdue (canal share), pas de la palette
  });
  it("arrêts strictement croissants, alpha dans 0–255", () => {
    for (const d of LAYERS) {
      for (let i = 1; i < d.stops.length; i++) expect(d.stops[i]!.v).toBeGreaterThan(d.stops[i - 1]!.v);
      for (const s of d.stops) expect(s.rgba[3]).toBeGreaterThanOrEqual(0);
    }
  });
  it("couches transparentes : premier arrêt alpha 0 sous tooltipMin", () => {
    for (const id of ["rain", "pm25", "dust", "snowfall", "snow_depth"]) {
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
  it("nuages seuls adoucis (σ = 1,2 cellule) ; la pluie reste brute, sa structure fine est de l'information", () => {
    expect(LAYERS.filter((d) => d.soften !== undefined).map((d) => d.id)).toEqual(["clouds"]);
    expect(layerDef("clouds")!.soften).toBe(1.2);
  });
  it("formats", () => {
    expect(layerDef("temp")!.format(23.44)).toBe("23.4 °C");
    expect(layerDef("temp")!.format(-0.04)).toBe("0.0 °C");
    expect(layerDef("clouds")!.format(42.6)).toBe("43%");
    expect(layerDef("rain")!.format(0.44)).toBe("0.4 mm/h");
    expect(layerDef("pressure")!.format(1013.25)).toBe("1013 hPa");
    expect(layerDef("humidity")!.format(99.5)).toBe("100%");
    expect(layerDef("pm25")!.format(17.6)).toBe("18 µg/m³");
    expect(layerDef("dust")!.format(0)).toBe("0 µg/m³");
  });
  it("formatSnow : cm sous 1 m, m au-delà", () => {
    const cases: [number, string][] = [[0.4, "0.4 cm"], [9.5, "9.5 cm"], [12, "12 cm"], [99, "99 cm"], [100, "1.0 m"], [740, "7.4 m"], [3200, "32 m"]];
    for (const [v, out] of cases) expect(formatSnow(v)).toBe(out);
    expect(layerDef("snowfall")!.format(9.5)).toBe("9.5 cm");
    expect(layerDef("snow_depth")!.format(740)).toBe("7.4 m");
  });
  it("neige : modes, seuils et graduations dans l'encodage", () => {
    const f = layerDef("snowfall")!, d = layerDef("snow_depth")!;
    expect(f.modeOf).toBeUndefined();
    expect(d.modeOf).toBe("snowfall");
    expect([f.tooltipMin, d.tooltipMin]).toEqual([0.5, 1]);
    expect(f.ticks).toEqual([1, 5, 20, 50, 100, 300]);
    expect(d.ticks).toEqual([10, 50, 150, 300, 1000]);
    for (const [def, max] of [[f, 500], [d, 1000]] as const) {
      expect(def.stops[def.stops.length - 1]!.v).toBe(max);
      for (const v of def.ticks) expect(v).toBeLessThanOrEqual(max);
    }
    expect(d.tickLabel!(10)).toBe("10 cm");
    expect(d.tickLabel!(100)).toBe("1 m");
    expect(d.tickLabel!(150)).toBe("1.5 m");
    expect(d.tickLabel!(300)).toBe("3 m");
    expect(d.tickLabel!(1000)).toBe("10 m");
  });
  it("formatTemperature conserve la spec navigation §6", () => {
    expect(formatTemperature(-12.34)).toBe("−12.3 °C");
  });
  it("layerDef inconnu → undefined", () => expect(layerDef("wind")).toBeUndefined());
});
