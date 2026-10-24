import { describe, expect, it } from "vitest";
import { layerDef } from "../src/layers/registry";
import { PAGES, SITE, pagePath, type PageDef } from "../src/pages/registry";
import { MAX_DISTANCE, MIN_DISTANCE } from "../src/render/scene";

const mots = (p: PageDef) => p.body.join(" ").split(/\s+/).filter(Boolean).length;
const textes = (p: PageDef) => [p.title, p.description, p.h1, p.summary, p.menuLabel, p.ogAlt, ...p.body];

describe("registre des pages — lot G", () => {
  it("17 pages, slugs uniques, accueil en tête", () => {
    expect(PAGES).toHaveLength(17);
    expect(PAGES[0]!.kind).toBe("home");
    expect(new Set(PAGES.map((p) => p.slug)).size).toBe(17);
    expect(PAGES.filter((p) => p.kind === "layer")).toHaveLength(8);
    expect(PAGES.filter((p) => p.kind === "region")).toHaveLength(8);
    expect(SITE).toBe("https://globelayers.com");
  });

  it("chaque couche citée existe dans LAYERS", () => {
    for (const p of PAGES) expect(p.layer === null || layerDef(p.layer) !== undefined).toBe(true);
  });

  it("description 80–160 caractères, titres uniques", () => {
    for (const p of PAGES) {
      expect(p.description.length, p.slug).toBeGreaterThanOrEqual(80);
      expect(p.description.length, p.slug).toBeLessThanOrEqual(160);
    }
    expect(new Set(PAGES.map((p) => p.title)).size).toBe(17);
  });

  it("Read more : 150 à 300 mots, textes distincts", () => {
    for (const p of PAGES) {
      expect(mots(p), p.slug).toBeGreaterThanOrEqual(150);
      expect(mots(p), p.slug).toBeLessThanOrEqual(300);
    }
    const tous = PAGES.flatMap((p) => p.body);
    expect(new Set(tous).size).toBe(tous.length);
  });

  it("aucun mot interdit", () => {
    for (const p of PAGES) for (const t of textes(p)) expect(t).not.toMatch(/\b(track(er|ing)?|alerts?)\b/i);
  });

  it("related ne cite que des slugs existants, jamais soi-même", () => {
    const slugs = new Set(PAGES.map((p) => p.slug));
    for (const p of PAGES) {
      for (const r of p.related) {
        expect(slugs.has(r), `${p.slug} -> ${r}`).toBe(true);
        expect(r).not.toBe(p.slug);
      }
    }
  });

  it("vent forcé seulement pour vent, ouragans, typhons", () => {
    expect(PAGES.filter((p) => p.windForced).map((p) => p.slug)).toEqual([
      "wind-map", "atlantic-hurricane-map", "pacific-typhoon-map",
    ]);
  });

  it("vues bornées", () => {
    for (const p of PAGES) {
      if (!p.view) continue;
      expect(Math.abs(p.view.lat), p.slug).toBeLessThanOrEqual(89);
      expect(Math.abs(p.view.lon), p.slug).toBeLessThanOrEqual(180);
      expect(p.view.d, p.slug).toBeGreaterThanOrEqual(MIN_DISTANCE);
      expect(p.view.d, p.slug).toBeLessThanOrEqual(MAX_DISTANCE);
    }
  });

  it("pagePath", () => {
    expect(pagePath(PAGES[0]!)).toBe("/");
    expect(pagePath(PAGES.find((p) => p.slug === "wind-map")!)).toBe("/wind-map/");
  });
});
