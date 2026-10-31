import { describe, expect, it } from "vitest";
import { captureRequest } from "../src/capture/input";
import { parseForecast } from "../src/data/manifest";
import { FORECAST } from "./fixtures";

const M = parseForecast(FORECAST);
const T = Date.UTC(2026, 8, 12, 13, 0);
const NOW = Date.UTC(2026, 9, 31, 9, 30);

describe("captureRequest — entrée de la capture selon la couche active (revue T6, Important 1)", () => {
  it("Forest active : légende forêt, aucune couche météo, instant présent, nom et texte « forest »", () => {
    const r = captureRequest({ activeId: "forest", shownId: null, manifest: M, cursorMs: T, nowMs: NOW });
    expect(r.layer).toBeNull();
    expect(r.forest?.id).toBe("forest");
    expect(r.tMs).toBe(NOW);
    expect(r.name).toBe("globelayers-forest-2026-10-31-09UTC.png");
    expect(r.text).toBe("Forest — globelayers.com");
  });
  it("Forest active sans manifeste météo : légende forêt quand même", () => {
    expect(captureRequest({ activeId: "forest", shownId: null, manifest: null, cursorMs: T, nowMs: NOW }).forest?.id).toBe("forest");
  });
  it("couche météo affichée : sa légende et l'instant du curseur, pas de forêt", () => {
    const r = captureRequest({ activeId: "temp", shownId: "temp", manifest: M, cursorMs: T, nowMs: NOW });
    expect(r.forest).toBeNull();
    expect(r.layer).toMatchObject({ model: "gfs_0p25", run: "2026-09-12T06:00:00Z" });
    expect(r.layer!.def.id).toBe("temp");
    expect(r.tMs).toBe(T);
    expect(r.name).toBe("globelayers-temp-2026-09-12-13UTC.png");
  });
  it("Aucune : ni couche ni forêt, instant présent", () => {
    const r = captureRequest({ activeId: null, shownId: null, manifest: M, cursorMs: T, nowMs: NOW });
    expect(r).toMatchObject({ layer: null, forest: null, tMs: NOW, name: "globelayers-2026-10-31-09UTC.png" });
    expect(r.text).toBe("GlobeLayers — globelayers.com");
  });
});
