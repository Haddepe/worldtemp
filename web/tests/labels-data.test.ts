import { describe, expect, it } from "vitest";
import { GeoDataError, buildLabelSet, parseCountries, parsePlaces, extendLabelSet, itemKey, parseDetailPlaces, unitVectors } from "../src/labels/data";

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

describe("parseDetailPlaces — tuiles geo/cities/ (spec lot F §3.4)", () => {
  it("lit des lignes de 4 champs, sans drapeau capitale", () => {
    expect(parseDetailPlaces({ version: 1, places: [[6.45, 48.17, "Épinal", 32188]] })).toEqual([
      { lon: 6.45, lat: 48.17, name: "Épinal", pop: 32188, capital: false },
    ]);
  });
  it("rejette une ligne de 5 champs et une population non numérique", () => {
    expect(() => parseDetailPlaces({ version: 1, places: [[6.45, 48.17, "X", 1, 0]] })).toThrowError(GeoDataError);
    expect(() => parseDetailPlaces({ version: 1, places: [[6.45, 48.17, "X", "1"]] })).toThrowError(GeoDataError);
  });
});

describe("extendLabelSet — socle + villes de détail", () => {
  const base = buildLabelSet(
    [
      { lon: 2.35, lat: 48.86, name: "Paris", pop: 11_000_000, capital: true },
      { lon: 4.84, lat: 45.77, name: "Lyon", pop: 1_700_000, capital: false },
      { lon: 1, lat: 1, name: "Smallville", pop: 5_000, capital: false },
    ],
    [{ lon: 2, lat: 46, name: "France", rank: 2 }],
  );
  const extraPlaces = [
    { lon: 6.45, lat: 48.17, name: "Epinal", pop: 32_188, capital: false },
    { lon: 6, lat: 48, name: "Village", pop: 1_000, capital: false },
  ];
  const extra = { places: extraPlaces, unit: unitVectors(extraPlaces) };

  it("intercale les villes de détail par population, sans passer devant pays ni capitales", () => {
    const set = extendLabelSet(base, extra);
    expect(set.items.map((i) => i.name)).toEqual(["France", "Paris", "Lyon", "Epinal", "Smallville", "Village"]);
    expect(set.items.map((i) => i.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("vecteurs unité cohérents avec chaque item", () => {
    const set = extendLabelSet(base, extra);
    for (const it of set.items) {
      const expected = unitVectors([it]);
      expect(Array.from(set.unit.subarray(it.id * 3, it.id * 3 + 3))).toEqual(Array.from(expected));
    }
  });
  it("aucun détail : renvoie le socle tel quel", () => {
    expect(extendLabelSet(base, { places: [], unit: new Float32Array(0) })).toBe(base);
  });
  it("itemKey distingue le type, le nom et la position", () => {
    const set = extendLabelSet(base, extra);
    const keys = set.items.map(itemKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(itemKey(set.items[3]!)).toBe("city|Epinal|6.45|48.17");
  });
});
