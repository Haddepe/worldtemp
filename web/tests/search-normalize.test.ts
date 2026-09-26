import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeName, prefixOf } from "../src/search/normalize";

/** Mêmes cas que tests/test_geonames.py : le miroir Python/TS est garanti par ce fichier commun. */
const CASES = JSON.parse(readFileSync(join(__dirname, "..", "..", "tests", "fixtures", "geo_normalize_cases.json"), "utf8")) as {
  normalize: [string, string][];
  prefix: [string, string][];
};

describe("normalizeName — miroir de tools/geonames.py::normalize", () => {
  it.each(CASES.normalize)("%s → %s", (raw, expected) => {
    expect(normalizeName(raw)).toBe(expected);
  });
});

describe("prefixOf — miroir de tools/geonames.py::prefix_of", () => {
  it.each(CASES.prefix)("%s → %s", (key, expected) => {
    expect(prefixOf(key)).toBe(expected);
  });
});
