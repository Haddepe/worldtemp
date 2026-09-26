import { describe, expect, it, vi } from "vitest";
import { GEO_VERSION } from "../src/geo/loader";
import { GeoDataError } from "../src/labels/data";
import { CitySearch, MAX_RESULTS, parseSearchFile, resultLabel } from "../src/search/index";

const EP = {
  version: 1,
  entries: [
    ["Épinal", "Grand Est", "France", 6.45, 48.17, 32188, ["epinal"]],
    ["Epila", "Aragon", "Spain", -1.28, 41.6, 4500, ["epila"]],
    ["Epe", "Gelderland", "Netherlands", 5.98, 52.35, 3000, ["epe"]],
  ],
};

describe("parseSearchFile", () => {
  it("lit les entrées", () => {
    expect(parseSearchFile(EP)[0]).toEqual({
      result: { name: "Épinal", region: "Grand Est", country: "France", lon: 6.45, lat: 48.17, pop: 32188 },
      keys: ["epinal"],
    });
  });
  it("rejette une version inconnue ou une entrée mal formée", () => {
    expect(() => parseSearchFile({ version: 2, entries: [] })).toThrowError(GeoDataError);
    expect(() => parseSearchFile({ version: 1, entries: [["X", "", "", 0, 0, 1]] })).toThrowError(GeoDataError);
    expect(() => parseSearchFile({ version: 1, entries: [["X", "", "", 0, 0, 1, "x"]] })).toThrowError(GeoDataError);
  });
});

describe("resultLabel", () => {
  it("nom — région, pays ; région vide omise ; les deux vides → nom seul", () => {
    const r = { name: "Épinal", region: "Grand Est", country: "France", lon: 0, lat: 0, pop: 0 };
    expect(resultLabel(r)).toBe("Épinal — Grand Est, France");
    expect(resultLabel({ ...r, region: "" })).toBe("Épinal — France");
    expect(resultLabel({ ...r, region: "", country: "" })).toBe("Épinal");
  });
});

describe("CitySearch", () => {
  it("moins de 2 caractères normalisés : aucun fichier demandé", async () => {
    const fetchJson = vi.fn();
    const s = new CitySearch("/geo", fetchJson);
    expect(await s.query("É")).toEqual([]);
    expect(await s.query("  ")).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalled();
  });
  it("demande le fichier du préfixe normalisé, filtre par début de clé, garde l'ordre du fichier", async () => {
    const fetchJson = vi.fn(async () => EP);
    const s = new CitySearch("/geo", fetchJson);
    expect((await s.query("ÉPI")).map((r) => r.name)).toEqual(["Épinal", "Epila"]);
    expect(fetchJson).toHaveBeenCalledWith(`/geo/search/ep.json?v=${GEO_VERSION}`);
  });
  it("un fichier n'est téléchargé qu'une fois", async () => {
    const fetchJson = vi.fn(async () => EP);
    const s = new CitySearch("/geo", fetchJson);
    await s.query("ep");
    await s.query("epi");
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
  it("404 (null) : aucun résultat", async () => {
    const s = new CitySearch("/geo", async () => null);
    expect(await s.query("zz")).toEqual([]);
  });
  it("échec réseau : rejette, puis retente à la requête suivante", async () => {
    const fetchJson = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(EP);
    const s = new CitySearch("/geo", fetchJson);
    await expect(s.query("ep")).rejects.toThrowError("offline");
    expect((await s.query("ep")).length).toBe(3);
  });
  it(`au plus ${MAX_RESULTS} résultats`, async () => {
    const many = { version: 1, entries: Array.from({ length: 20 }, (_, i) => [`Ep${i}`, "", "", 0, 0, 1000 - i, [`ep${i}`]]) };
    const s = new CitySearch("/geo", async () => many);
    expect(await s.query("ep")).toHaveLength(MAX_RESULTS);
  });
});
