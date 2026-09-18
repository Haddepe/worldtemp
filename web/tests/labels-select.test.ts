import { describe, expect, it } from "vitest";
import { buildLabelSet, type LabelSet } from "../src/labels/data";
import { LABEL_CAP, eligible, labelBox, labelCap, selectLabels, tierIndex, type SelectInput } from "../src/labels/select";

const city = (name: string, pop: number, capital = false, lon = 0, lat = 0) => ({ lon, lat, name, pop, capital });
const country = (name: string, rank: number, lon = 0, lat = 0) => ({ lon, lat, name, rank });

/** Projecteur factice : position écran donnée par une table, tout le reste hors viewport. */
function input(set: LabelSet, screen: Record<string, [number, number]>, over: Partial<SelectInput> = {}): SelectInput {
  return {
    set, d: 1.3, camDir: { x: 0, y: 0, z: 1 }, cap: 60, hasValue: false, shown: new Set(),
    project(id, out) {
      const at = screen[set.items[id]!.name];
      if (!at) return false;
      out.x = at[0];
      out.y = at[1];
      return true;
    },
    ...over,
  };
}

/** Tous les lieux face caméra (+z) : lon = −90 dans le repère de lonLatToVec3. */
const FRONT = -90;

describe("paliers de zoom (spec repères §3)", () => {
  it("tierIndex suit les bornes 2,5 / 1,6 / 1,25", () => {
    expect([4, 2.5, 2.49, 1.6, 1.59, 1.25, 1.24, 1.05].map(tierIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
  it("villes : capitales toujours, sinon seuil de population du palier", () => {
    const set = buildLabelSet([city("Cap", 1000, true), city("Méga", 6e6), city("Grande", 2e6), city("Moyenne", 2e5), city("Petite", 5e3)], []);
    const names = (d: number) => set.items.filter((i) => eligible(i, d)).map((i) => i.name);
    expect(names(3)).toEqual(["Cap", "Méga"]);
    expect(names(2)).toEqual(["Cap", "Méga", "Grande"]);
    expect(names(1.4)).toEqual(["Cap", "Méga", "Grande", "Moyenne"]);
    expect(names(1.1)).toEqual(["Cap", "Méga", "Grande", "Moyenne", "Petite"]);
  });
  it("pays : par rang, puis tous les vrais pays (micro-États exclus), puis aucun de près", () => {
    const set = buildLabelSet(
      [],
      [country("Un", 1), country("Quatre", 4), country("Sept", 7), country("MicroÉtat", 8)],
    );
    const names = (d: number) => set.items.filter((i) => eligible(i, d)).map((i) => i.name);
    expect(names(3)).toEqual(["Un"]);
    expect(names(2)).toEqual(["Un", "Quatre"]);
    expect(names(1.4)).toEqual(["Un", "Quatre", "Sept"]);
    expect(names(1.1)).toEqual([]);
  });
  it("plafond par tier, divisé par deux sous 600 px", () => {
    expect(LABEL_CAP).toEqual({ high: 60, low: 30 });
    expect(labelCap("high", 1440)).toBe(60);
    expect(labelCap("high", 599)).toBe(30);
    expect(labelCap("low", 500)).toBe(15);
  });
});

describe("selectLabels", () => {
  it("écarte ce qui est derrière l'horizon sans même le projeter", () => {
    const set = buildLabelSet([city("Devant", 1e7, false, FRONT, 0), city("Derrière", 1e7, false, 90, 0)], []);
    const seen: string[] = [];
    const inp = input(set, { Devant: [100, 100], Derrière: [300, 300] });
    const project = inp.project;
    inp.project = (id, out) => { seen.push(set.items[id]!.name); return project(id, out); };
    expect(selectLabels(inp).map((p) => set.items[p.id]!.name)).toEqual(["Devant"]);
    expect(seen).toEqual(["Devant"]);
  });
  it("écarte ce que le projecteur déclare hors viewport", () => {
    const set = buildLabelSet([city("Vue", 1e7, false, FRONT, 0), city("Hors", 1e7, false, FRONT, 1)], []);
    expect(selectLabels(input(set, { Vue: [100, 100] })).map((p) => p.id)).toEqual([0]);
  });
  it("anti-chevauchement : le premier dans l'ordre de priorité gagne", () => {
    const set = buildLabelSet([city("Paris", 1e7, true, FRONT, 0), city("Versailles", 9e4, false, FRONT, 0.1), city("Lyon", 2e6, false, FRONT, 1)], []);
    const out = selectLabels(input(set, { Paris: [100, 100], Versailles: [110, 104], Lyon: [100, 300] }, { d: 1.1 }));
    expect(out.map((p) => set.items[p.id]!.name)).toEqual(["Paris", "Lyon"]);
    expect(out[0]).toEqual({ id: 0, x: 100, y: 100 });
  });
  it("une valeur affichée agrandit la boîte : deux villes compatibles sans valeur se gênent avec", () => {
    const set = buildLabelSet([city("Haut", 1e7, false, FRONT, 0), city("Bas", 9e6, false, FRONT, 1)], []);
    const screen = { Haut: [100, 100], Bas: [100, 126] } as Record<string, [number, number]>; // sans valeur : 111,5 < 114,5 ; avec : 126,5 > 114,5
    expect(selectLabels(input(set, screen)).length).toBe(2);
    expect(selectLabels(input(set, screen, { hasValue: true })).length).toBe(1);
  });
  it("s'arrête au plafond", () => {
    const places = Array.from({ length: 10 }, (_, i) => city(`V${i}`, 1e7 - i, false, FRONT, 0));
    const set = buildLabelSet(places, []);
    const screen = Object.fromEntries(places.map((p, i) => [p.name, [100, 50 + i * 60] as [number, number]]));
    expect(selectLabels(input(set, screen, { cap: 3 })).map((p) => set.items[p.id]!.name)).toEqual(["V0", "V1", "V2"]);
  });
  it("stabilité : une étiquette déjà affichée passe avant une plus prioritaire qui la chevauche", () => {
    const set = buildLabelSet([city("Grande", 1e7, false, FRONT, 0), city("Petite", 2e5, false, FRONT, 0.1)], []);
    const screen = { Grande: [100, 100], Petite: [105, 102] } as Record<string, [number, number]>;
    expect(selectLabels(input(set, screen)).map((p) => p.id)).toEqual([0]);
    expect(selectLabels(input(set, screen, { shown: new Set([1]) })).map((p) => p.id)).toEqual([1]);
  });
  it("une étiquette déjà affichée mais plus éligible à ce zoom disparaît", () => {
    const set = buildLabelSet([city("Petite", 2e5, false, FRONT, 0)], []);
    expect(selectLabels(input(set, { Petite: [100, 100] }, { d: 3, shown: new Set([0]) }))).toEqual([]);
  });
  it("les pays passent avant les villes", () => {
    const set = buildLabelSet([city("Paris", 1e7, true, FRONT, 0)], [country("France", 2, FRONT, 0.1)]);
    const out = selectLabels(input(set, { Paris: [100, 100], France: [100, 104] }, { d: 2 }));
    expect(out.map((p) => set.items[p.id]!.name)).toEqual(["France"]);
  });
});

describe("labelBox", () => {
  it("ville : à droite du point ; pays : centré", () => {
    const set = buildLabelSet([city("Paris", 1, true)], [country("France", 1)]);
    const c = labelBox(set.items[1]!, 100, 100, false);
    expect(c.x0).toBeLessThan(100);
    expect(c.x1).toBeGreaterThan(130);
    const p = labelBox(set.items[0]!, 100, 100, false);
    expect((p.x0 + p.x1) / 2).toBeCloseTo(100, 6);
  });
});
