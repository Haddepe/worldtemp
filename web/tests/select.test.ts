import { describe, expect, it } from "vitest";
import { parseForecast } from "../src/data/manifest";
import { LAYERS } from "../src/layers/registry";
import { DEFAULT_LAYER, availableLayerIds, availableModes, layerIdsBeforeManifest, failureFallback, layerModes, menuEntries, menuKey, menuLayers, menuTarget, orderedLayers, parseLayerParam, withLayerParam } from "../src/layers/select";
import { FORECAST } from "./fixtures";

const M = parseForecast(FORECAST);

describe("orderedLayers", () => {
  it("ordre du registre, filtré par le manifeste", () => {
    expect(orderedLayers(LAYERS, M).map((d) => d.id)).toEqual(["temp", "clouds", "rain", "pressure", "humidity", "pm25", "dust"]);
    const partial = { ...M, layers: { dust: M.layers.dust!, rain: M.layers.rain! } };
    expect(orderedLayers(LAYERS, partial).map((d) => d.id)).toEqual(["rain", "dust"]);
  });
  it("couche tuiles : ajoutée quand son manifeste de tuiles est chargé, sans entrée de forecast.json", () => {
    expect(orderedLayers(LAYERS, M, ["forest"]).map((d) => d.id)).toEqual(["temp", "clouds", "rain", "pressure", "humidity", "pm25", "dust", "forest"]);
    expect(orderedLayers(LAYERS, M).map((d) => d.id)).not.toContain("forest");
    // une entrée « forest » égarée dans forecast.json ne suffit pas : c'est le jeu de tuiles qui fait foi
    const stray = { ...M, layers: { ...M.layers, forest: M.layers.temp! } };
    expect(orderedLayers(LAYERS, stray).map((d) => d.id)).not.toContain("forest");
    // et une couche grille n'est jamais rendue disponible par la liste des tuiles
    expect(orderedLayers(LAYERS, { layers: {} }, ["temp", "forest"]).map((d) => d.id)).toEqual(["forest"]);
  });
  it("availableLayerIds : Forest joignable sans manifeste météo ; couches en échec retirées", () => {
    expect(availableLayerIds(LAYERS, null, ["forest"], new Set())).toEqual(["forest"]);
    expect(availableLayerIds(LAYERS, null, [], new Set())).toEqual([]);
    expect(availableLayerIds(LAYERS, M, ["forest"], new Map([["rain", 1]]))).toEqual(["temp", "clouds", "pressure", "humidity", "pm25", "dust", "forest"]);
  });
  it("layerIdsBeforeManifest : toutes les grilles, une couche tuiles seulement si son jeu est chargé", () => {
    expect(layerIdsBeforeManifest(LAYERS, [])).not.toContain("forest");
    expect(layerIdsBeforeManifest(LAYERS, [])).toContain("snow_depth");
    expect(layerIdsBeforeManifest(LAYERS, ["forest"])).toContain("forest");
    expect(parseLayerParam("?layer=forest", layerIdsBeforeManifest(LAYERS, []))).toBe("temp"); // pas de globe nu
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
  it("menuEntries : une entrée par base, ordre du registre, présente si la base ou un mode est au manifeste", () => {
    const only = (ids: string[]) => ({ layers: Object.fromEntries(ids.map((id) => [id, M.layers.temp!])) });
    expect(menuEntries(LAYERS, only(["temp", "snow_depth", "rain"])).map((d) => d.id)).toEqual(["temp", "rain", "snowfall"]);
    expect(menuEntries(LAYERS, only(["snowfall", "snow_depth"])).map((d) => d.id)).toEqual(["snowfall"]);
    expect(menuEntries(LAYERS, only(["temp"])).map((d) => d.id)).toEqual(["temp"]);
  });
  it("menuEntries : Forest dès que le manifeste forêt est chargé, sans couche météo correspondante", () => {
    const only = (ids: string[]) => ({ layers: Object.fromEntries(ids.map((id) => [id, M.layers.temp!])) });
    expect(menuEntries(LAYERS, only(["temp", "snowfall"]), ["forest"]).map((d) => d.id)).toEqual(["temp", "snowfall", "forest"]);
    expect(menuEntries(LAYERS, only([]), ["forest"]).map((d) => d.id)).toEqual(["forest"]);
    expect(menuEntries(LAYERS, only(["temp"]), []).map((d) => d.id)).toEqual(["temp"]);
  });
  it("failureFallback : le mode voisin disponible d'abord, sinon la couche précédente, sinon aucune", () => {
    expect(failureFallback("snowfall", "temp", ["temp", "snow_depth"], LAYERS)).toBe("snow_depth");
    expect(failureFallback("snow_depth", "snowfall", ["temp", "snowfall"], LAYERS)).toBe("snowfall");
    expect(failureFallback("snowfall", "temp", ["temp"], LAYERS)).toBe("temp");
    expect(failureFallback("rain", "temp", ["temp"], LAYERS)).toBe("temp");
    expect(failureFallback("rain", "temp", [], LAYERS)).toBeNull(); // précédente en échec
    expect(failureFallback("rain", "rain", ["temp"], LAYERS)).toBeNull();
    expect(failureFallback("rain", null, ["temp"], LAYERS)).toBeNull();
  });
  it("parseLayerParam accepte un mode", () => {
    expect(parseLayerParam("?layer=snow_depth", [...LAYERS.map((d) => d.id)])).toBe("snow_depth");
    expect(parseLayerParam("?layer=forest", orderedLayers(LAYERS, M, ["forest"]).map((d) => d.id))).toBe("forest");
    expect(parseLayerParam("?layer=forest", orderedLayers(LAYERS, M).map((d) => d.id))).toBe("temp"); // manifeste forêt absent
  });
});
