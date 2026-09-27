import { describe, expect, it } from "vitest";
import { MetadataError, parseForecast } from "../src/data/manifest";
import { FORECAST } from "./fixtures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v3 = (): any => JSON.parse(JSON.stringify(FORECAST));

describe("parseForecast — spec lot E §4.2", () => {
  it("accepte le manifeste v3 et calcule valid_ms", () => {
    const f = parseForecast(v3());
    expect(f.schema_version).toBe(3);
    expect(Object.keys(f.layers)).toHaveLength(7);
    const temp = f.layers.temp!;
    expect(temp.frames).toHaveLength(20);
    expect(temp.frames[0]).toEqual({
      forecast_hour: 3, valid_time_utc: "2026-09-12T09:00:00Z", valid_ms: Date.parse("2026-09-12T09:00:00Z"),
      texture: "20260912T06Z/temp_f003.png", stats: { min: -61.3, max: 47.8 },
    });
    expect(temp.encoding).toEqual({ bits: 8, min: -90, max: 60, scale: "linear" });
    expect(f.layers.pm25!.frames.at(-1)!.valid_time_utc).toBe("2026-09-14T12:00:00Z");
  });
  it("rejette un autre schéma", () => {
    const raw = v3();
    raw.schema_version = 2;
    expect(() => parseForecast(raw)).toThrowError(/schema_version/);
  });
  it("rejette une frise vide, désordonnée ou à pas irrégulier", () => {
    const empty = v3();
    empty.layers.temp.frames = [];
    expect(() => parseForecast(empty)).toThrowError(/layers\.temp\.frames/);
    const swapped = v3();
    [swapped.layers.temp.frames[0], swapped.layers.temp.frames[1]] = [swapped.layers.temp.frames[1], swapped.layers.temp.frames[0]];
    expect(() => parseForecast(swapped)).toThrowError(/layers\.temp\.frames/);
    const gap = v3();
    gap.layers.temp.frames.splice(5, 1);
    expect(() => parseForecast(gap)).toThrowError(/layers\.temp\.frames/);
  });
  it("rejette une échéance dont la validité n'est pas run + forecast_hour", () => {
    const raw = v3();
    raw.layers.clouds.frames[2].valid_time_utc = "2026-09-12T16:00:00Z";
    expect(() => parseForecast(raw)).toThrowError(/layers\.clouds\.frames\[2\]\.valid_time_utc/);
  });
  it("rejette une texture qui n'est pas un chemin relatif <run>/<nom>.png", () => {
    for (const bad of ["../x/temp_f003.png", "/20260912T06Z/temp_f003.png", "https://evil.test/a.png", "20260912T06Z/temp_f003.jpg", "temp_f003.png"]) {
      const raw = v3();
      raw.layers.temp.frames[0].texture = bad;
      expect(() => parseForecast(raw)).toThrowError(/texture/);
    }
  });
  it("rejette un encodage invalide et une liste de couches vide", () => {
    const enc = v3();
    enc.layers.rain.encoding.scale = "log";
    expect(() => parseForecast(enc)).toThrowError(/layers\.rain\.encoding\.scale/);
    const none = v3();
    none.layers = {};
    expect(() => parseForecast(none)).toThrowError(/layers/);
  });
});
