import { describe, expect, it, vi } from "vitest";
import { SUMMARY_KEY, setSummaryHidden, summaryHidden } from "../src/ui/summary";

describe("résumé refermable — mémoire du choix (lot G §5)", () => {
  it("sans stockage : visible", () => {
    expect(summaryHidden(null)).toBe(false);
  });
  it("valeur mémorisée : masqué", () => {
    expect(summaryHidden({ getItem: () => "1" })).toBe(true);
  });
  it("getItem qui lève : visible", () => {
    expect(summaryHidden({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
  });
  it("setItem qui lève : ignoré", () => {
    expect(() => setSummaryHidden({ setItem: () => { throw new Error("quota"); }, removeItem: () => {} }, true)).not.toThrow();
  });
  it("masquer écrit la clé, ré-afficher la retire", () => {
    const setItem = vi.fn(), removeItem = vi.fn();
    setSummaryHidden({ setItem, removeItem }, true);
    expect(setItem).toHaveBeenCalledWith(SUMMARY_KEY, "1");
    setSummaryHidden({ setItem, removeItem }, false);
    expect(removeItem).toHaveBeenCalledWith(SUMMARY_KEY);
  });
  it("stockage nul : ne lève pas", () => {
    expect(() => setSummaryHidden(null, true)).not.toThrow();
  });
});
