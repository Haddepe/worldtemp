import { describe, expect, it } from "vitest";
import { SearchModel } from "../src/search/model";

const r = (name: string) => ({ name, region: "", country: "", lon: 0, lat: 0, pop: 0 });

describe("SearchModel — clavier et requêtes périmées (spec lot F §5.2)", () => {
  it("de nouveaux résultats activent le premier ; aucun résultat → -1", () => {
    const m = new SearchModel();
    expect(m.accept(m.begin(), [r("A"), r("B")])).toBe(true);
    expect(m.active).toBe(0);
    m.accept(m.begin(), []);
    expect(m.active).toBe(-1);
  });
  it("une réponse périmée est ignorée", () => {
    const m = new SearchModel();
    const old = m.begin();
    const fresh = m.begin();
    expect(m.accept(fresh, [r("New")])).toBe(true);
    expect(m.accept(old, [r("Old")])).toBe(false);
    expect(m.results.map((x) => x.name)).toEqual(["New"]);
  });
  it("flèches : circulent dans la liste", () => {
    const m = new SearchModel();
    m.accept(m.begin(), [r("A"), r("B"), r("C")]);
    m.key("ArrowDown");
    expect(m.active).toBe(1);
    m.key("ArrowUp");
    m.key("ArrowUp");
    expect(m.active).toBe(2);
    m.key("ArrowDown");
    expect(m.active).toBe(0);
  });
  it("Entrée choisit l'actif ; sans résultat, rien", () => {
    const m = new SearchModel();
    expect(m.key("Enter")).toEqual({ type: "none" });
    m.accept(m.begin(), [r("A"), r("B")]);
    m.key("ArrowDown");
    expect(m.key("Enter")).toEqual({ type: "choose", result: r("B") });
  });
  it("Échap ferme ; une autre touche ne fait rien", () => {
    const m = new SearchModel();
    expect(m.key("Escape")).toEqual({ type: "close" });
    expect(m.key("a")).toEqual({ type: "none" });
  });
});
