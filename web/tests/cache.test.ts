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
});
