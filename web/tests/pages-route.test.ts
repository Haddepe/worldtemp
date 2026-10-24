import { describe, it, expect } from "vitest";
import { PAGES, pagePath } from "../src/pages/registry";
import { pageForPath, pageDefaultsSearch, pageAfterLayerChange, searchForPageChange, searchForPageState, searchWithShownView } from "../src/pages/route";

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
  it("autre page d'entrée : vent éteint (wind=0), même en reduced-motion", () => {
    expect(new URLSearchParams(pageDefaultsSearch("", page("rain-map"), false)).get("wind")).toBe("0");
    expect(new URLSearchParams(pageDefaultsSearch("", page("sahara-dust-forecast"), true)).get("wind")).toBe("0");
  });
  it("wind=1 explicite gardé sur une page à vent éteint", () => {
    expect(new URLSearchParams(pageDefaultsSearch("?wind=1", page("rain-map"), false)).get("wind")).toBe("1");
  });
  it("accueil : pas de wind, défaut du site", () => {
    expect(pageDefaultsSearch("", page(""), false)).not.toContain("wind");
  });
  it("page vent en reduced-motion : pas de wind", () => {
    expect(pageDefaultsSearch("", page("wind-map"), true)).not.toContain("wind");
  });
  it("page régionale : couche et vue", () => {
    expect(pageDefaultsSearch("", page("sahara-dust-forecast"), false)).toBe("?layer=dust&wind=0&lon=-5&lat=20&d=2");
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
  it("retire layer et wind, garde la vue et le reste", () => {
    expect(searchForPageChange("?layer=rain&wind=1&labels=0&lon=1&lat=2&d=3")).toBe("?labels=0&lon=1&lat=2&d=3");
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

describe("searchWithShownView", () => {
  const shown = () => ({ lon: 10, lat: 45, d: 1.8 });
  const never = () => {
    throw new Error("shown() ne doit pas être consulté");
  };
  it("page cible à vue (région) : vue retirée, son vol l'écrira", () => {
    expect(searchWithShownView("?labels=0&lon=1&lat=2&d=3", page("rain-map"), page("europe-heatwave-map"), never)).toBe("?labels=0");
    expect(searchWithShownView("?lon=1&lat=2&d=3", page("europe-heatwave-map"), page("europe-heatwave-map"), never)).toBe("");
  });
  it("page cible sans vue : la vue de l'adresse est gardée (y compris vers la page courante)", () => {
    expect(searchWithShownView("?lon=1&lat=2&d=3", page("rain-map"), page("rain-map"), never)).toBe("?lon=1&lat=2&d=3");
    expect(searchWithShownView("?lon=1&lat=2&d=3", page("sahara-dust-forecast"), page("dust-forecast"), never)).toBe("?lon=1&lat=2&d=3");
  });
  it("région non touchée vers une page sans vue : la vue affichée est écrite", () => {
    expect(searchWithShownView("", page("sahara-dust-forecast"), page("dust-forecast"), shown)).toBe("?lon=10.00&lat=45.00&d=1.800");
    expect(searchWithShownView("?labels=0", page("europe-heatwave-map"), page("rain-map"), shown)).toBe("?labels=0&lon=10.00&lat=45.00&d=1.800");
  });
  it("garde « ma position » ou vol en cours (shown() null) : aucune vue écrite", () => {
    expect(searchWithShownView("?labels=0", page("europe-heatwave-map"), page("rain-map"), () => null)).toBe("?labels=0");
    expect(searchWithShownView("", page("europe-heatwave-map"), page("rain-map"), () => null)).toBe("");
  });
  it("page sans vue et adresse sans vue : caméra sur la vue par défaut, rien n'est écrit", () => {
    expect(searchWithShownView("", page(""), page("rain-map"), never)).toBe("");
    expect(searchWithShownView("?layer=none", page("wind-map"), page(""), never)).toBe("?layer=none");
  });
});
