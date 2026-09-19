import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GEO_VERSION, loadLabelSet, loadRivers, once } from "../src/geo/loader";
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
    const fetchJson = vi.fn(async (url: string) => (url.includes("places.json") ? PLACES : COUNTRIES));
    const set = await loadLabelSet("/geo", fetchJson);
    expect(set.items.map((i) => i.name)).toEqual(["France", "Paris"]);
    expect(fetchJson.mock.calls.map((c) => c[0]).sort()).toEqual([`/geo/countries.json?v=${GEO_VERSION}`, `/geo/places.json?v=${GEO_VERSION}`]);
  });
  it("un seul fichier en échec : l'autre s'affiche quand même", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const set = await loadLabelSet("/geo", async (url) => {
      if (url.includes("countries.json")) throw new Error("404");
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
    expect(fetchBuffer).toHaveBeenCalledWith(`/geo/rivers.bin?v=${GEO_VERSION}`);
  });
  it("binaire invalide : rejet", async () => {
    await expect(loadRivers("/geo", async () => new ArrayBuffer(3))).rejects.toThrowError();
  });
});

describe("GEO_VERSION — invalide le cache navigateur d'un jour des fichiers geo/", () => {
  it("vaut l'empreinte FNV-1a des trois fichiers commités : à relever après chaque `tools/build_geo.py`", () => {
    // Sans cela, un visiteur déjà venu garde l'ancienne copie pendant 24 h (noms restés en
    // français après le passage du site à l'anglais, 2026-09-19).
    let h = 0x811c9dc5;
    for (const name of ["places.json", "countries.json", "rivers.bin"]) {
      for (const byte of readFileSync(join(__dirname, "..", "public", "geo", name))) {
        h = Math.imul(h ^ byte, 0x01000193) >>> 0;
      }
    }
    expect(GEO_VERSION).toBe(h.toString(16).padStart(8, "0"));
  });
});
