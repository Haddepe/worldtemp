import { describe, expect, it } from "vitest";
import { captureFileName, captureRun, captureWhen } from "../src/capture/naming";

const T = Date.UTC(2026, 9, 3, 13, 24, 59); // samedi 3 octobre 2026, 13:24:59 UTC

describe("captureWhen — heure exacte du curseur, à la minute, en UTC", () => {
  it("jour, date, mois, année, HH:MM UTC (secondes tronquées)", () => {
    expect(captureWhen(T)).toBe("Sat 3 Oct 2026, 13:24 UTC");
  });
  it("minuit et heure à un chiffre complétés à deux", () => {
    expect(captureWhen(Date.UTC(2026, 0, 1, 0, 5))).toBe("Thu 1 Jan 2026, 00:05 UTC");
  });
});

describe("captureRun — source et run", () => {
  it("GFS et GEFS-Aerosols, crédit NOAA", () => {
    expect(captureRun("gfs_0p25", "2026-10-03T06:00:00Z")).toBe("NOAA GFS run 3 Oct 06Z");
    expect(captureRun("gefs_chem_0p25", "2026-10-02T18:00:00Z")).toBe("NOAA GEFS-Aerosols run 2 Oct 18Z");
  });
  it("modèle inconnu : identifiant brut", () => {
    expect(captureRun("ecmwf", "2026-10-03T00:00:00Z")).toBe("ecmwf run 3 Oct 00Z");
  });
});

describe("captureFileName", () => {
  it("avec couche", () => {
    expect(captureFileName("dust", T)).toBe("globelayers-dust-2026-10-03-13UTC.png");
  });
  it("sans couche (null ou none)", () => {
    expect(captureFileName(null, Date.UTC(2026, 8, 5, 7))).toBe("globelayers-2026-09-05-07UTC.png");
    expect(captureFileName("none", T)).toBe("globelayers-2026-10-03-13UTC.png");
  });
});
