import { describe, expect, it } from "vitest";
import { layerDef } from "../src/layers/registry";
import { labelValue } from "../src/labels/text";
import type { TooltipData } from "../src/ui/tooltip";

/** Champ 2×2 uniforme à l'octet `byte` (RGBA, seul R compte). */
function data(id: string, byte: number, min: number, max: number): TooltipData {
  const pixels = new Uint8ClampedArray(2 * 2 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels[i] = byte;
  return { def: layerDef(id)!, pixels, grid: { width: 2, height: 2 }, encoding: { bits: 8, min, max, scale: "linear" } };
}

describe("labelValue — valeur sous le nom d'une ville (spec repères §4)", () => {
  it("formate avec le format de la couche", () => {
    expect(labelValue(data("temp", 255, -50, 50), 2.35, 48.86)).toBe("50.0 °C");
    expect(labelValue(data("clouds", 0, 0, 100), 2.35, 48.86)).toBe("0%");
  });
  it("nom seul : aucune couche", () => {
    expect(labelValue(null, 2.35, 48.86)).toBeNull();
  });
  it("nom seul : sous tooltipMin (pas de pluie)", () => {
    expect(labelValue(data("rain", 0, 0, 50), 2.35, 48.86)).toBeNull();
  });
});
