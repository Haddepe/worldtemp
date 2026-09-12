import { describe, expect, it } from "vitest";
import { parseManifest } from "../src/data/manifest";
import { LAYERS } from "../src/layers/registry";
import { DEFAULT_LAYER, orderedLayers, parseLayerParam, withLayerParam } from "../src/layers/select";
import { MANIFEST } from "./fixtures";

const M = parseManifest(MANIFEST);

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
