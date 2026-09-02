import { describe, expect, it } from "vitest";
import { MetadataError, parseMetadata } from "../src/data/metadata";
import { SAMPLE } from "./fixtures";

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

describe("parseMetadata", () => {
  it("accepte l'exemple de la spec et le renvoie typé", () => {
    const m = parseMetadata(clone(SAMPLE));
    expect(m.schema_version).toBe(1);
    expect(m.encoding).toEqual({ bits: 8, min_c: -90, max_c: 60 });
    expect(m.grid.width).toBe(1440);
    expect(m.texture).toBe("latest.png");
    expect(m.stats.max_c).toBe(48.9);
  });

  it("refuse schema_version 2", () => {
    const raw = clone(SAMPLE);
    raw.schema_version = 2;
    expect(() => parseMetadata(raw)).toThrowError(MetadataError);
    expect(() => parseMetadata(raw)).toThrowError(/schema_version/);
  });

  it("refuse encoding.bits 16", () => {
    const raw = clone(SAMPLE);
    raw.encoding.bits = 16;
    expect(() => parseMetadata(raw)).toThrowError(/encoding\.bits/);
  });

  it("refuse min_c >= max_c", () => {
    const raw = clone(SAMPLE);
    raw.encoding.min_c = 60;
    expect(() => parseMetadata(raw)).toThrowError(/encoding\.min_c/);
  });

  it("refuse grid absent", () => {
    const raw = clone(SAMPLE) as Record<string, unknown>;
    delete raw.grid;
    expect(() => parseMetadata(raw)).toThrowError(/grid/);
  });

  it("refuse une largeur de grille non entière", () => {
    const raw = clone(SAMPLE);
    raw.grid.width = 1440.5;
    expect(() => parseMetadata(raw)).toThrowError(/grid\.width/);
  });

  it("refuse generated_at non ISO", () => {
    const raw = clone(SAMPLE);
    raw.generated_at = "hier";
    expect(() => parseMetadata(raw)).toThrowError(/generated_at/);
  });

  it("refuse texture vide", () => {
    const raw = clone(SAMPLE);
    raw.texture = "";
    expect(() => parseMetadata(raw)).toThrowError(/texture/);
  });

  it("refuse une entrée qui n'est pas un objet", () => {
    expect(() => parseMetadata(null)).toThrowError(MetadataError);
    expect(() => parseMetadata("{}")).toThrowError(MetadataError);
  });

  it("expose le champ fautif", () => {
    const raw = clone(SAMPLE);
    raw.schema_version = 3;
    try {
      parseMetadata(raw);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MetadataError);
      expect((e as MetadataError).field).toBe("schema_version");
    }
  });
});
