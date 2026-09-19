import { describe, expect, it, vi } from "vitest";
import { loadLabelSet, loadRivers, once } from "../src/geo/loader";
import { encodeRivers } from "./rivers-fixture";

const PLACES = { version: 1, places: [[2.35, 48.86, "Paris", 11000000, 1]] };
const COUNTRIES = { version: 1, countries: [[2.55, 46.7, "France", 2]] };

describe("once — un seul chargement par session (spec repères §6)", () => {
  it("partage la promesse, succès comme échec", async () => {
    const load = vi.fn(async () => 42);
    const get = once(load);
    expect(await Promise.all([get(), get()])).toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
    const bad = once(vi.fn(async () => { throw new Error("réseau"); }));
    await expect(bad()).rejects.toThrowError("réseau");
    await expect(bad()).rejects.toThrowError("réseau");
  });
});

describe("loadLabelSet", () => {
  it("charge villes et pays", async () => {
    const fetchJson = vi.fn(async (url: string) => (url.endsWith("places.json") ? PLACES : COUNTRIES));
    const set = await loadLabelSet("/geo", fetchJson);
    expect(set.items.map((i) => i.name)).toEqual(["France", "Paris"]);
    expect(fetchJson.mock.calls.map((c) => c[0]).sort()).toEqual(["/geo/countries.json", "/geo/places.json"]);
  });
  it("un seul fichier en échec : l'autre s'affiche quand même", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const set = await loadLabelSet("/geo", async (url) => {
      if (url.endsWith("countries.json")) throw new Error("404");
      return PLACES;
    });
    expect(set.items.map((i) => i.name)).toEqual(["Paris"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("fichier invalide compté comme un échec ; les deux en échec : rejet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(loadLabelSet("/geo", async () => ({ version: 9 }))).rejects.toThrowError();
    warn.mockRestore();
  });
});

describe("loadRivers", () => {
  it("charge et parse rivers.bin", async () => {
    const fetchBuffer = vi.fn(async () => encodeRivers([[1, [[0, 0], [100, 0]]]]));
    const seg = await loadRivers("/geo", fetchBuffer);
    expect(seg.count).toBe(1);
    expect(fetchBuffer).toHaveBeenCalledWith("/geo/rivers.bin");
  });
  it("binaire invalide : rejet", async () => {
    await expect(loadRivers("/geo", async () => new ArrayBuffer(3))).rejects.toThrowError();
  });
});
