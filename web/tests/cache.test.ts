import { describe, expect, it, vi } from "vitest";
import { LayerCache } from "../src/layers/cache";

function item(id: string) {
  return { id, dispose: vi.fn() };
}

describe("LayerCache — LRU de capacité 2 (spec couches §10)", () => {
  it("crée à la demande, réutilise, évince le moins récent", () => {
    const factory = vi.fn(item);
    const c = new LayerCache(2, factory);
    const a = c.get("a");
    const b = c.get("b");
    expect(c.get("a")).toBe(a);           // touche a → b devient le moins récent
    const d = c.get("d");
    expect(c.ids()).toEqual(["a", "d"]);
    expect(b.dispose).toHaveBeenCalledTimes(1);
    expect(a.dispose).not.toHaveBeenCalled();
    expect(d.id).toBe("d");
    expect(factory).toHaveBeenCalledTimes(3);
    expect(c.has("b")).toBe(false);
  });
  it("dispose vide tout", () => {
    const c = new LayerCache(2, item);
    const a = c.get("a");
    c.dispose();
    expect(a.dispose).toHaveBeenCalled();
    expect(c.ids()).toEqual([]);
  });
  it("capacité < 1 refusée", () => {
    expect(() => new LayerCache(0, item)).toThrowError();
  });

  it("n'évince jamais l'id épinglé (I1) : passe à l'entrée suivante", () => {
    const c = new LayerCache(2, item);
    const temp = c.get("temp"); // temp affichée : épinglée
    const clouds = c.get("clouds", "temp"); // temp, clouds — plein
    const rain = c.get("rain", "temp"); // évince clouds (non épinglé), pas temp
    expect(c.ids()).toEqual(["temp", "rain"]);
    expect(temp.dispose).not.toHaveBeenCalled();
    expect(clouds.dispose).toHaveBeenCalledTimes(1);
    expect(rain.id).toBe("rain");
  });

  it("seul candidat évincable épinglé : capacité dépassée d'un plutôt que d'évincer", () => {
    const c = new LayerCache(1, item);
    const temp = c.get("temp"); // seule entrée, épinglée (couche affichée)
    const clouds = c.get("clouds", "temp"); // rien à évincer sans toucher temp
    expect(c.ids()).toEqual(["temp", "clouds"]);
    expect(temp.dispose).not.toHaveBeenCalled();
    expect(clouds.id).toBe("clouds");
  });
});
