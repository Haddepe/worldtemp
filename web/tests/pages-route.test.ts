import { describe, it, expect } from "vitest";
import { PAGES, pagePath } from "../src/pages/registry";
import { pageForPath, pageDefaultsSearch, pageAfterLayerChange, searchForPageChange, searchForPageState } from "../src/pages/route";

const page = (slug: string) => PAGES.find((p) => p.slug === slug)!;

describe("pageForPath", () => {
  it("la racine donne l'accueil", () => expect(pageForPath("/").slug).toBe(""));
  it("avec ou sans barre finale donne la page vent", () => {
    expect(pageForPath("/wind-map/").slug).toBe("wind-map");
    expect(pageForPath("/wind-map").slug).toBe("wind-map");
  });
  it("un chemin inconnu donne l'accueil", () => expect(pageForPath("/foo/").slug).toBe(""));
  it("est sensible à la casse", () => expect(pageForPath("/WIND-MAP/").slug).toBe(""));
  it("aller-retour exact pagePath → pageForPath pour toutes les pages (popstate)", () => {
    for (const p of PAGES) expect(pageForPath(pagePath(p))).toBe(p);
  });
});

describe("pageDefaultsSearch", () => {
  it("accueil : couche temp", () => expect(pageDefaultsSearch("", page(""), false)).toBe("?layer=temp"));
  it("page vent : layer=none et wind=1", () => {
    const s = pageDefaultsSearch("", page("wind-map"), false);
    expect(s).toContain("layer=none");
    expect(s).toContain("wind=1");
  });
  it("page vent en reduced-motion : pas de wind", () => {
    expect(pageDefaultsSearch("", page("wind-map"), true)).not.toContain("wind");
  });
  it("page régionale : couche et vue", () => {
    expect(pageDefaultsSearch("", page("sahara-dust-forecast"), false)).toBe("?layer=dust&lon=-5&lat=20&d=2");
  });
  it("une vue explicite n'est pas complétée par celle de la page", () => {
    const p = new URLSearchParams(pageDefaultsSearch("?layer=rain&lon=10&lat=10", page("sahara-dust-forecast"), false));
    expect(p.get("layer")).toBe("rain");
    expect(p.get("lon")).toBe("10");
    expect(p.get("lat")).toBe("10");
    expect(p.has("d")).toBe(false);
  });
  it("lon seul suffit à écarter la vue de la page", () => {
    const p = new URLSearchParams(pageDefaultsSearch("?lon=3", page("sahara-dust-forecast"), false));
    expect(p.has("lat")).toBe(false);
    expect(p.has("d")).toBe(false);
  });
  it("wind=0 explicite est conservé", () => {
    expect(new URLSearchParams(pageDefaultsSearch("?wind=0", page("wind-map"), false)).get("wind")).toBe("0");
  });
});

describe("pageAfterLayerChange", () => {
  it("accueil vers pluie", () => expect(pageAfterLayerChange(page(""), "rain", false).slug).toBe("rain-map"));
  it("pluie vers temp : jamais l'accueil", () => expect(pageAfterLayerChange(page("rain-map"), "temp", false).slug).toBe("temperature-map"));
  it("page régionale vers sa couche", () => expect(pageAfterLayerChange(page("sahara-dust-forecast"), "dust", false).slug).toBe("dust-forecast"));
  it("aucune couche, vent allumé : page vent", () => expect(pageAfterLayerChange(page("rain-map"), null, true).slug).toBe("wind-map"));
  it("aucune couche, vent éteint : accueil", () => expect(pageAfterLayerChange(page("rain-map"), null, false).slug).toBe(""));
  it("déjà la bonne page : même objet", () => {
    const p = page("temperature-map");
    expect(pageAfterLayerChange(p, "temp", false)).toBe(p);
  });
});

describe("searchForPageChange", () => {
  it("retire layer, wind et vue, garde le reste", () => {
    expect(searchForPageChange("?layer=rain&wind=1&labels=0&lon=1&lat=2&d=3")).toBe("?labels=0");
  });
  it("chaîne vide quand rien ne reste", () => expect(searchForPageChange("?layer=rain")).toBe(""));
});

describe("searchForPageState", () => {
  it("couche exprimée par le chemin : pas de layer", () => {
    expect(searchForPageState("?layer=temp&labels=0", page("rain-map"), "rain", false, false)).toBe("?labels=0");
  });
  it("accueil sans couche : layer=none écrit", () => expect(searchForPageState("", page(""), null, false, false)).toBe("?layer=none"));
  it("vent différent du défaut de la page : écrit", () => {
    expect(searchForPageState("", page("rain-map"), "rain", true, false)).toBe("?wind=1");
    expect(searchForPageState("?wind=1", page("wind-map"), null, false, true)).toBe("?wind=0");
  });
  it("page à vent forcé, vent au défaut : retiré", () => expect(searchForPageState("?wind=1", page("wind-map"), null, true, true)).toBe(""));
  it("wind explicite gardé ailleurs, même égal au défaut", () => expect(searchForPageState("?wind=1", page("rain-map"), "rain", true, true)).toBe("?wind=1"));
  it("wind absent et égal au défaut : reste absent", () => expect(searchForPageState("", page("rain-map"), "rain", true, true)).toBe(""));
  it("la vue est gardée", () => {
    expect(searchForPageState("?layer=temp&lon=1&lat=2&d=3", page("rain-map"), "rain", false, false)).toBe("?lon=1&lat=2&d=3");
  });
});
