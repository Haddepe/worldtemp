import { describe, expect, it } from "vitest";
import { parseManifest } from "../src/data/manifest";
import { layerDef } from "../src/layers/registry";
import { formatAgo, formatBanner, formatReading, legendTicks, sourceLabel } from "../src/ui/format";
import { MANIFEST } from "./fixtures";

const M = parseManifest(MANIFEST);
const TEMP = M.layers.temp!;
const PM = M.layers.pm25!;
const NOW = Date.parse("2026-09-12T14:24:40Z"); // 12 min après generated_at de temp

describe("formatAgo", () => {
  it("minutes", () => expect(formatAgo(TEMP.generated_at, NOW)).toBe("il y a 12 min"));
  it("à l'instant sous 1 min", () => expect(formatAgo(TEMP.generated_at, Date.parse(TEMP.generated_at) + 30_000)).toBe("à l'instant"));
  it("heures et minutes au-delà de 60 min", () =>
    expect(formatAgo(TEMP.generated_at, Date.parse(TEMP.generated_at) + 95 * 60_000)).toBe("il y a 1 h 35"));
});

describe("sourceLabel", () => {
  it("modèles connus et repli sur l'id", () => {
    expect(sourceLabel("gfs_0p25")).toBe("NOAA GFS 0,25°");
    expect(sourceLabel("gefs_chem_0p25")).toBe("NOAA GEFS-Aerosols 0,25°");
    expect(sourceLabel("icon_eu")).toBe("icon_eu");
  });
});

describe("formatBanner — spec couches §11", () => {
  it("GFS : run, validité UTC et locale, fraîcheur", () => {
    expect(formatBanner(TEMP, NOW, "Europe/Paris")).toBe(
      "NOAA GFS 0,25° · run 06:00 UTC · valide 14:00 UTC (16:00 locale) · il y a 12 min",
    );
  });
  it("GEFS-chem : libellé de sa source, sa propre échéance", () => {
    expect(formatBanner(PM, NOW, "UTC")).toBe(
      "NOAA GEFS-Aerosols 0,25° · run 06:00 UTC · valide 12:00 UTC · il y a 2 h 12",
    );
  });
});

describe("legendTicks", () => {
  it("température : graduations du registre en % de [-90, 60]", () => {
    const ticks = legendTicks(layerDef("temp")!, TEMP.encoding);
    expect(ticks.map((t) => t.v)).toEqual([-40, -30, -20, -10, 0, 10, 20, 30, 40]);
    expect(ticks[0]?.pct).toBeCloseTo(((-40 + 90) / 150) * 100, 6);
    expect(ticks[4]?.pct).toBeCloseTo(60, 6);
    expect(ticks[4]?.label).toBe("0");
  });
  it("pluie : positions en racine, libellés courts", () => {
    const ticks = legendTicks(layerDef("rain")!, M.layers.rain!.encoding);
    expect(ticks.map((t) => t.label)).toEqual(["0,5", "2", "8", "25", "50"]);
    expect(ticks[0]!.pct).toBeCloseTo((26 / 255) * 100, 6); // encode(0,5) = round(25,5) = 26
    expect(ticks[4]!.pct).toBeCloseTo(100, 6);
  });
});

describe("formatReading", () => {
  it("valeur formatée par la couche ; « — » sous tooltipMin", () => {
    expect(formatReading(layerDef("temp")!, 23.44)).toBe("23,4 °C");
    expect(formatReading(layerDef("rain")!, 0.05)).toBe("—");
    expect(formatReading(layerDef("rain")!, 0.1)).toBe("0,1 mm/h");
    expect(formatReading(layerDef("pm25")!, 4.9)).toBe("—");
  });
});
