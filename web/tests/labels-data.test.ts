import { describe, expect, it } from "vitest";
import { GeoDataError, buildLabelSet, parseCountries, parsePlaces } from "../src/labels/data";

describe("parsePlaces / parseCountries — spec repères §2", () => {
  it("lit les lignes [lon, lat, nom, pop, cap]", () => {
    expect(parsePlaces({ version: 1, places: [[2.35, 48.86, "Paris", 11000000, 1], [4.84, 45.77, "Lyon", 1700000, 0]] })).toEqual([
      { lon: 2.35, lat: 48.86, name: "Paris", pop: 11000000, capital: true },
      { lon: 4.84, lat: 45.77, name: "Lyon", pop: 1700000, capital: false },
    ]);
  });
  it("lit les lignes [lon, lat, nom, rang]", () => {
    expect(parseCountries({ version: 1, countries: [[2.55, 46.7, "France", 2]] })).toEqual([{ lon: 2.55, lat: 46.7, name: "France", rank: 2 }]);
  });
  it.each([
    ["pas un objet", null],
    ["version inconnue", { version: 2, places: [] }],
    ["places absent", { version: 1 }],
    ["ligne trop courte", { version: 1, places: [[2.35, 48.86, "Paris"]] }],
    ["longitude hors bornes", { version: 1, places: [[181, 0, "X", 1, 0]] }],
    ["latitude non finie", { version: 1, places: [[0, Number.NaN, "X", 1, 0]] }],
    ["nom vide", { version: 1, places: [[0, 0, "", 1, 0]] }],
    ["drapeau de capitale hors {0, 1}", { version: 1, places: [[0, 0, "X", 1, 2]] }],
    ["drapeau de capitale booléen", { version: 1, places: [[0, 0, "X", 1, true]] }],
  ])("parsePlaces refuse : %s", (_label, json) => {
    expect(() => parsePlaces(json)).toThrowError(GeoDataError);
  });
  it("parseCountries refuse un rang non numérique", () => {
    expect(() => parseCountries({ version: 1, countries: [[0, 0, "X", "2"]] })).toThrowError(GeoDataError);
  });
});

describe("buildLabelSet", () => {
  it("pays d'abord puis villes, ids = index, vecteurs unité précalculés", () => {
    const set = buildLabelSet(
      [{ lon: 0, lat: 0, name: "Zéro", pop: 5, capital: false }],
      [{ lon: 0, lat: 90, name: "Pôle", rank: 1 }],
    );
    expect(set.items.map((i) => [i.id, i.kind, i.name])).toEqual([[0, "country", "Pôle"], [1, "city", "Zéro"]]);
    expect(set.unit.length).toBe(6);
    expect(set.unit[1]).toBeCloseTo(1, 6);                       // pôle nord : y = 1
    expect(Math.hypot(set.unit[3]!, set.unit[4]!, set.unit[5]!)).toBeCloseTo(1, 6);
    expect(set.unit[4]).toBeCloseTo(0, 6);                       // équateur : y = 0
    expect(set.items[0]).toMatchObject({ pop: 0, capital: false, rank: 1 });
    expect(set.items[1]).toMatchObject({ pop: 5, rank: 0 });
  });
});
