import { describe, expect, it, vi } from "vitest";
import { createAbout } from "../src/ui/about";

/** Faux éléments : Vitest tourne sans DOM. */
function fakeButton() {
  let click: (() => void) | null = null;
  return { el: { addEventListener: (_: string, cb: () => void) => { click = cb; } } as unknown as HTMLButtonElement, click: () => click?.() };
}
function fakeDialog() {
  let onClick: ((e: { target: unknown }) => void) | null = null;
  const dialog = {
    open: false,
    showModal: vi.fn(() => { dialog.open = true; }),
    close: vi.fn(() => { dialog.open = false; }),
    addEventListener: (_: string, cb: (e: { target: unknown }) => void) => { onClick = cb; },
  };
  return { el: dialog as unknown as HTMLDialogElement, raw: dialog, clickOn: (target: unknown) => onClick?.({ target }) };
}

describe("createAbout — panneau About (spec site public §5)", () => {
  it("le bouton « ? » ouvre en modal, une seule fois", () => {
    const d = fakeDialog(), open = fakeButton(), close = fakeButton();
    createAbout(d.el, open.el, close.el);
    open.click();
    open.click();
    expect(d.raw.showModal).toHaveBeenCalledTimes(1);
  });
  it("le bouton Close ferme", () => {
    const d = fakeDialog(), open = fakeButton(), close = fakeButton();
    createAbout(d.el, open.el, close.el);
    open.click();
    close.click();
    expect(d.raw.close).toHaveBeenCalledTimes(1);
  });
  it("un clic sur le fond (la cible est le dialog lui-même) ferme ; un clic dans le contenu ne ferme pas", () => {
    const d = fakeDialog(), open = fakeButton(), close = fakeButton();
    createAbout(d.el, open.el, close.el);
    open.click();
    d.clickOn({ some: "paragraph" });
    expect(d.raw.close).not.toHaveBeenCalled();
    d.clickOn(d.el);
    expect(d.raw.close).toHaveBeenCalledTimes(1);
  });
});
