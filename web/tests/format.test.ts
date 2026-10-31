import { describe, expect, it } from "vitest";
import { parseForecast } from "../src/data/manifest";
import { layerDef } from "../src/layers/registry";
import {
  formatAgo, formatBanner, legendNote, legendTitle, formatOffset, formatReading, formatWhen, legendTicks, sourceLabel, formatWind, timelineLabel,
  windDirection, compassPoint, forestLegend,
} from "../src/ui/format";
import { forestLegendHtml } from "../src/ui/overlay";
import { FORECAST } from "./fixtures";

const M = parseForecast(FORECAST);
const TEMP = M.layers.temp!;
const PM = M.layers.pm25!;
const NOW = Date.parse("2026-09-12T10:24:40Z"); // 12 min après generated_at de temp

describe("formatAgo", () => {
  it("minutes", () => expect(formatAgo(TEMP.generated_at, NOW)).toBe("12 min ago"));
  it("à l'instant sous 1 min", () => expect(formatAgo(TEMP.generated_at, Date.parse(TEMP.generated_at) + 30_000)).toBe("just now"));
  it("heures et minutes au-delà de 60 min", () =>
    expect(formatAgo(TEMP.generated_at, Date.parse(TEMP.generated_at) + 95 * 60_000)).toBe("1 h 35 min ago"));
});

describe("sourceLabel", () => {
  it("modèles connus et repli sur l'id", () => {
    expect(sourceLabel("gfs_0p25")).toBe("NOAA GFS 0.25°");
    expect(sourceLabel("gefs_chem_0p25")).toBe("NOAA GEFS-Aerosols 0.25°");
    expect(sourceLabel("icon_eu")).toBe("icon_eu");
  });
});

describe("formatBanner — spec lot E §7.1", () => {
  it("source, run et fraîcheur de la frise de la couche affichée", () => {
    expect(formatBanner(TEMP, NOW)).toBe("NOAA GFS 0.25° · run 06:00 UTC · updated 12 min ago");
    expect(formatBanner(PM, NOW)).toBe("NOAA GEFS-Aerosols 0.25° · run 00:00 UTC · updated 5 h 12 min ago");
  });
});

describe("formatWhen / formatOffset / timelineLabel — frise", () => {
  const T = Date.parse("2026-09-12T15:00:00Z"); // samedi
  it("jour, date et heure locale", () => {
    expect(formatWhen(T, "UTC")).toBe("Sat 12 15:00");
    expect(formatWhen(T, "Europe/Paris")).toBe("Sat 12 17:00");
    expect(formatWhen(Date.parse("2026-09-14T00:30:00Z"), "UTC")).toBe("Mon 14 00:30");
  });
  it("écart à maintenant, en heures arrondies", () => {
    expect(formatOffset(T, T - 3 * 3_600_000)).toBe("+3 h");
    expect(formatOffset(T, T + 2 * 3_600_000)).toBe("−2 h");
    expect(formatOffset(T, T - 29 * 60_000)).toBe("now");
    expect(formatOffset(T, T - 31 * 60_000)).toBe("+1 h");
  });
  it("libellé live et libellé d'un instant choisi", () => {
    expect(timelineLabel(T, T, true, "UTC")).toBe("Now · Sat 12 15:00");
    expect(timelineLabel(T + 3 * 3_600_000, T, false, "UTC")).toBe("Sat 12 18:00 (+3 h)");
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
    expect(ticks.map((t) => t.label)).toEqual(["0.5", "2", "8", "25", "50"]);
    expect(ticks[0]!.pct).toBeCloseTo((26 / 255) * 100, 6); // encode(0,5) = round(25,5) = 26
    expect(ticks[4]!.pct).toBeCloseTo(100, 6);
  });
  it("neige profonde : libellés du registre (tickLabel)", () => {
    const enc = { bits: 8, min: 0, max: 1000, scale: "sqrt" as const };
    const ticks = legendTicks(layerDef("snow_depth")!, enc);
    expect(ticks.map((t) => t.label)).toEqual(["10 cm", "50 cm", "1.5 m", "3 m", "10 m"]);
    expect(ticks[4]!.pct).toBeCloseTo(100, 6);
  });
});

describe("formatReading", () => {
  it("valeur formatée par la couche ; « — » sous tooltipMin", () => {
    expect(formatReading(layerDef("temp")!, 23.44)).toBe("23.4 °C");
    expect(formatReading(layerDef("rain")!, 0.05)).toBe("—");
    expect(formatReading(layerDef("rain")!, 0.1)).toBe("0.1 mm/h");
    expect(formatReading(layerDef("pm25")!, 4.9)).toBe("—");
  });
});

describe("formatWind — spec vent §10", () => {
  it("vitesse en km/h entier, direction d'où vient le vent", () => {
    expect(formatWind(0, 10)).toBe("Wind 36 km/h S");    // souffle vers le nord : vient du sud
    expect(formatWind(-10, 0)).toBe("Wind 36 km/h E");
    expect(formatWind(10, 0)).toBe("Wind 36 km/h W");
    expect(formatWind(0, -10)).toBe("Wind 36 km/h N");
    expect(formatWind(5, 5)).toBe("Wind 25 km/h SW");    // 7,07 m/s = 25,46 km/h
  });
  it("vent calme sous 1 km/h", () => {
    expect(formatWind(0.1, 0)).toBe("Calm");
    expect(formatWind(0, 0)).toBe("Calm");
  });
  it("windDirection est dans [0, 360[ et compassPoint arrondit au plus proche", () => {
    expect(windDirection(0, 10)).toBeCloseTo(180, 9);
    expect(windDirection(0, -10)).toBeCloseTo(0, 9);
    expect(compassPoint(11.25)).toBe("NNE");
    expect(compassPoint(11.24)).toBe("N");
    expect(compassPoint(348.75)).toBe("N");
    expect(compassPoint(348.74)).toBe("NNW");
    expect(compassPoint(225)).toBe("SW");
  });
});

describe("legendTitle / legendNote — légende neige (spec neige §5.2)", () => {
  it("nom du mode s'il existe, unité, note facultative", () => {
    expect(legendTitle(layerDef("temp")!)).toBe("Temperature · °C");
    expect(legendTitle(layerDef("snow_depth")!)).toBe("Depth · cm");
    expect(legendTitle(layerDef("snowfall")!, "since Sat 3 09:00")).toBe("Snowfall · cm · since Sat 3 09:00");
  });
  it("note « since » = heure du run, en heure locale ; seulement pour snowfall", () => {
    const run = "2026-10-03T06:00:00Z";
    expect(legendNote(layerDef("snowfall")!, run, "UTC")).toBe("since Sat 3 06:00");
    expect(legendNote(layerDef("snowfall")!, run, "Europe/Paris")).toBe("since Sat 3 08:00");
    expect(legendNote(layerDef("snow_depth")!, run, "UTC")).toBeUndefined();
    expect(legendNote(layerDef("temp")!, run, "UTC")).toBeUndefined();
  });
});

describe("légende Forest — deux barres (spec forêt §7)", () => {
  const forest = layerDef("forest")!;
  it("couvert 30 → 100 %, pertes 2001 → 2024, positions linéaires", () => {
    const [cover, loss] = forestLegend(forest);
    expect(cover.title).toBe("Tree cover 2000 · %");
    expect(cover.short).toBe("%");
    expect(cover.ticks).toEqual([{ label: "30", pct: 0 }, { label: "50", pct: (20 / 70) * 100 }, { label: "75", pct: (45 / 70) * 100 }, { label: "100", pct: 100 }]);
    expect(cover.stops.map((s) => s.at)).toEqual([0, 20 / 70, 45 / 70, 1]); // rien sous le seuil
    expect(loss.title).toBe("Forest loss by year");
    expect(loss.short).toBe("Loss");
    expect(loss.ticks.map((t) => t.label)).toEqual(["2001", "2008", "2016", "2024"]);
    expect(loss.stops[0]).toEqual({ at: 0, color: "rgba(255, 225, 40, 1)" });
    expect(loss.stops.at(-1)).toEqual({ at: 1, color: "rgba(230, 0, 0, 1)" });
  });
  it("HTML : deux parties, chacune titre (long + court), barre --stops et graduations", () => {
    const html = forestLegendHtml(forest);
    expect(html.match(/class="part"/g)).toHaveLength(2);
    expect(html).toContain('<span class="name">Tree cover 2000 · %</span><span class="short">%</span>');
    expect(html).toContain('<span class="name">Forest loss by year</span><span class="short">Loss</span>');
    expect(html).toContain('--stops:rgba(255, 225, 40, 1) 0%');
    expect(html).toContain('<span class="tick" style="--pct:100.00">2024</span>');
  });
  it("HTML : titres et graduations échappés (jamais de balisage injecté)", () => {
    const html = forestLegendHtml({ ...forest, unit: '<img src=x onerror="1">' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;1&quot;&gt;");
  });
});
