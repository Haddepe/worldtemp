import { describe, expect, it } from "vitest";
import { parseMetadata } from "../src/data/metadata";
import { formatAgo, formatBanner, legendTicks } from "../src/ui/format";
import { SAMPLE } from "./fixtures";

const META = parseMetadata(SAMPLE);
const NOW = Date.parse("2026-08-30T14:19:42Z"); // 12 min après generated_at

describe("formatAgo", () => {
  it("minutes", () => expect(formatAgo(META.generated_at, NOW)).toBe("il y a 12 min"));
  it("à l'instant sous 1 min", () => expect(formatAgo(META.generated_at, Date.parse(META.generated_at) + 30_000)).toBe("à l'instant"));
  it("heures et minutes au-delà de 60 min", () =>
    expect(formatAgo(META.generated_at, Date.parse(META.generated_at) + 95 * 60_000)).toBe("il y a 1 h 35"));
});

describe("formatBanner", () => {
  it("run, validité UTC et locale, fraîcheur", () => {
    const s = formatBanner(META, NOW, "fr-FR", "Europe/Paris");
    expect(s).toBe("NOAA GFS 0,25° · run 06:00 UTC · valide 14:00 UTC (16:00 locale) · il y a 12 min");
  });
  it("sans fuseau : la partie locale est omise si identique à UTC", () => {
    const s = formatBanner(META, NOW, "fr-FR", "UTC");
    expect(s).toBe("NOAA GFS 0,25° · run 06:00 UTC · valide 14:00 UTC · il y a 12 min");
  });
});

describe("legendTicks", () => {
  it("tous les 10 °C de -40 à +40 en pourcentage de [-90, 60]", () => {
    const ticks = legendTicks(-90, 60);
    expect(ticks.map((t) => t.c)).toEqual([-40, -30, -20, -10, 0, 10, 20, 30, 40]);
    expect(ticks[0]?.pct).toBeCloseTo(((-40 + 90) / 150) * 100, 6);
    expect(ticks[4]?.pct).toBeCloseTo(60, 6);
  });
});
