import { describe, expect, it, vi } from "vitest";
import { createToggle } from "../src/ui/toggle";

/** Faux bouton : Vitest tourne sans DOM. */
function fakeButton(title = "") {
  const attrs = new Map<string, string>();
  let click: (() => void) | null = null;
  const b = {
    disabled: false,
    title,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    addEventListener: (_: string, cb: () => void) => { click = cb; },
  };
  return { button: b as unknown as HTMLButtonElement, attrs, click: () => click?.() };
}

describe("createToggle — interrupteur générique (spec repères §6)", () => {
  it("bascule au clic, reflète aria-checked, notifie", () => {
    const f = fakeButton();
    const onChange = vi.fn();
    createToggle(f.button, onChange, "Indisponible");
    expect(f.attrs.get("aria-checked")).toBe("false");
    f.click();
    expect(f.attrs.get("aria-checked")).toBe("true");
    expect(onChange).toHaveBeenCalledWith(true);
  });
  it("setOn ne notifie pas", () => {
    const f = fakeButton();
    const onChange = vi.fn();
    createToggle(f.button, onChange, "Indisponible").setOn(true);
    expect(f.attrs.get("aria-checked")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("désactivé : ignore le clic, annonce aria-checked false, pose le titre d'indisponibilité (dette n° 38)", () => {
    const f = fakeButton();
    const onChange = vi.fn();
    const t = createToggle(f.button, onChange, "Vent indisponible");
    t.setOn(true);
    t.setDisabled(true);
    expect(f.button.disabled).toBe(true);
    expect(f.attrs.get("aria-checked")).toBe("false");
    expect(f.button.title).toBe("Vent indisponible");
    f.click();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("réactivé : retrouve l'état demandé et le titre d'origine", () => {
    const f = fakeButton("Afficher le vent");
    const t = createToggle(f.button, vi.fn(), "Vent indisponible");
    t.setOn(true);
    t.setDisabled(true);
    t.setDisabled(false);
    expect(f.attrs.get("aria-checked")).toBe("true");
    expect(f.button.title).toBe("Afficher le vent");
  });
});
