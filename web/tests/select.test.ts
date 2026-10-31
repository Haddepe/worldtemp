import { describe, expect, it } from "vitest";
import { parseForecast } from "../src/data/manifest";
import { LAYERS } from "../src/layers/registry";
import { DEFAULT_LAYER, availableModes, layerModes, menuKey, menuLayers, menuTarget, orderedLayers, parseLayerParam, withLayerParam } from "../src/layers/select";
import { FORECAST } from "./fixtures";

const M = parseForecast(FORECAST);

describe("orderedLayers", () => {
  it("ordre du registre, filtré par le manifeste", () => {
    expect(orderedLayers(LAYERS, M).map((d) => d.id)).toEqual(["temp", "clouds", "rain", "pressure", "humidity", "pm25", "dust"]);
    const partial = { ...M, layers: { dust: M.layers.dust!, rain: M.layers.rain! } };
    expect(orderedLayers(LAYERS, partial).map((d) => d.id)).toEqual(["rain", "dust"]);
  });
  it("une couche du manifeste inconnue du registre est ignorée", () => {
    const extra = { ...M, layers: { ...M.layers, wind: M.layers.temp! } };
    expect(orderedLayers(LAYERS, extra)).toHaveLength(7);
  });
});

describe("parseLayerParam", () => {
  const all = LAYERS.map((d) => d.id);
  it("absent → temp ; none → null ; connu → lui-même", () => {
    expect(parseLayerParam("", all)).toBe(DEFAULT_LAYER);
    expect(parseLayerParam("?lon=1&lat=2", all)).toBe("temp");
    expect(parseLayerParam("?layer=none", all)).toBeNull();
    expect(parseLayerParam("?layer=rain", all)).toBe("rain");
  });
  it("inconnu ou indisponible → temp si disponible, sinon première disponible, sinon null", () => {
    expect(parseLayerParam("?layer=wind", all)).toBe("temp");
    expect(parseLayerParam("?layer=rain", ["clouds", "dust"])).toBe("clouds");
    expect(parseLayerParam("?layer=temp", [])).toBeNull();
    expect(parseLayerParam("", ["pm25"])).toBe("pm25");
  });
});

describe("withLayerParam", () => {
  it("ne touche que layer, conserve lon/lat/d", () => {
    expect(withLayerParam("?lon=1.5&lat=48&d=1.3", "rain")).toBe("?lon=1.5&lat=48&d=1.3&layer=rain");
    expect(withLayerParam("?layer=temp&lon=1", "dust")).toBe("?layer=dust&lon=1");
    expect(withLayerParam("?layer=temp", null)).toBe("?layer=none");
    expect(withLayerParam("", "temp")).toBe("?layer=temp");
  });
});

describe("modes de couche (neige)", () => {
  it("menuLayers écarte les modes", () => {
    const ids = menuLayers(LAYERS).map((d) => d.id);
    expect(ids).toContain("snowfall");
    expect(ids).not.toContain("snow_depth");
    expect(ids).toHaveLength(LAYERS.length - 1);
  });
  it("menuKey", () => {
    expect(menuKey("snow_depth", LAYERS)).toBe("snowfall");
    expect(menuKey("rain", LAYERS)).toBe("rain");
    expect(menuKey(null, LAYERS)).toBeNull();
  });
  it("layerModes : base puis modes ; vide sans mode", () => {
    expect(layerModes("snow_depth", LAYERS).map((d) => d.id)).toEqual(["snowfall", "snow_depth"]);
    expect(layerModes("snowfall", LAYERS).map((d) => d.id)).toEqual(["snowfall", "snow_depth"]);
    expect(layerModes("temp", LAYERS)).toEqual([]);
  });
  it("menuTarget : la base si disponible, sinon le premier mode disponible", () => {
    expect(menuTarget("snowfall", ["snowfall", "snow_depth"], LAYERS)).toBe("snowfall");
    expect(menuTarget("snowfall", ["snow_depth"], LAYERS)).toBe("snow_depth");
    expect(menuTarget("snowfall", [], LAYERS)).toBeNull();
    expect(menuTarget("rain", ["rain"], LAYERS)).toBe("rain");
    expect(menuTarget("rain", [], LAYERS)).toBeNull();
  });
  it("availableModes : modes disponibles de la couche ; moins de deux → aucun sélecteur", () => {
    expect(availableModes("snow_depth", ["snowfall", "snow_depth"], LAYERS).map((d) => d.id)).toEqual(["snowfall", "snow_depth"]);
    expect(availableModes("snowfall", ["snowfall"], LAYERS)).toEqual([]);
    expect(availableModes("temp", ["temp"], LAYERS)).toEqual([]);
    expect(availableModes(null, ["snowfall", "snow_depth"], LAYERS)).toEqual([]);
  });
  it("parseLayerParam accepte un mode", () => {
    expect(parseLayerParam("?layer=snow_depth", [...LAYERS.map((d) => d.id)])).toBe("snow_depth");
  });
});
