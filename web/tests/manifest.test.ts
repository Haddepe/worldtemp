import { describe, expect, it } from "vitest";
import { MetadataError, parseManifest } from "../src/data/manifest";
import { MANIFEST } from "./fixtures";

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

describe("parseManifest — spec couches §7", () => {
  it("accepte l'exemple et le renvoie typé, couches dans l'ordre reçu", () => {
    const m = parseManifest(clone(MANIFEST));
    expect(m.schema_version).toBe(2);
    expect(Object.keys(m.layers)).toEqual(["temp", "clouds", "rain", "pressure", "humidity", "pm25", "dust"]);
    expect(m.layers.rain!.encoding).toEqual({ bits: 8, min: 0, max: 50, scale: "sqrt" });
    expect(m.layers.pm25!.model).toBe("gefs_chem_0p25");
    expect(m.grid.width).toBe(1440);
    expect(m.layers.temp!.stats).toEqual({ min: -61.3, max: 47.8 });
  });

  it("accepte un manifeste à couches partielles (chem omises)", () => {
    const raw = clone(MANIFEST);
    delete (raw.layers as Record<string, unknown>).pm25;
    delete (raw.layers as Record<string, unknown>).dust;
    expect(Object.keys(parseManifest(raw).layers)).toHaveLength(5);
  });

  it("refuse schema_version 1", () => {
    const raw = clone(MANIFEST);
    raw.schema_version = 1;
    expect(() => parseManifest(raw)).toThrowError(MetadataError);
    expect(() => parseManifest(raw)).toThrowError(/schema_version/);
  });

  it("refuse une couche sans encoding.scale ou avec un scale inconnu", () => {
    const raw = clone(MANIFEST);
    (raw.layers.temp.encoding as { scale?: string }).scale = "log";
    expect(() => parseManifest(raw)).toThrowError(/layers\.temp\.encoding\.scale/);
  });

  it("refuse min >= max, bits ≠ 8, texture vide, date mal formée", () => {
    let raw = clone(MANIFEST);
    raw.layers.clouds.encoding.min = 100;
    expect(() => parseManifest(raw)).toThrowError(/layers\.clouds\.encoding\.min/);
    raw = clone(MANIFEST);
    raw.layers.clouds.encoding.bits = 16;
    expect(() => parseManifest(raw)).toThrowError(/encoding\.bits/);
    raw = clone(MANIFEST);
    raw.layers.clouds.texture = "";
    expect(() => parseManifest(raw)).toThrowError(/texture/);
    raw = clone(MANIFEST);
    raw.layers.clouds.valid_time_utc = "2026-09-12 14:00";
    expect(() => parseManifest(raw)).toThrowError(/valid_time_utc/);
  });

  it("refuse grid absent et layers absent", () => {
    const a = clone(MANIFEST) as Record<string, unknown>;
    delete a.grid;
    expect(() => parseManifest(a)).toThrowError(/grid/);
    const b = clone(MANIFEST) as Record<string, unknown>;
    delete b.layers;
    expect(() => parseManifest(b)).toThrowError(/layers/);
  });

  it("refuse un manifeste sans aucune couche", () => {
    const raw = clone(MANIFEST) as { layers: Record<string, unknown> };
    raw.layers = {};
    expect(() => parseManifest(raw)).toThrowError(/layers/);
  });
});
