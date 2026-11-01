import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDialog } from "../src/ui/about";

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

describe("createDialog — panneau About (spec site public §5)", () => {
  it("le bouton « ? » ouvre en modal, une seule fois", () => {
    const d = fakeDialog(), open = fakeButton(), close = fakeButton();
    createDialog(d.el, open.el, close.el);
    open.click();
    open.click();
    expect(d.raw.showModal).toHaveBeenCalledTimes(1);
  });
  it("le bouton Close ferme", () => {
    const d = fakeDialog(), open = fakeButton(), close = fakeButton();
    createDialog(d.el, open.el, close.el);
    open.click();
    close.click();
    expect(d.raw.close).toHaveBeenCalledTimes(1);
  });
  it("un clic sur le fond (la cible est le dialog lui-même) ferme ; un clic dans le contenu ne ferme pas", () => {
    const d = fakeDialog(), open = fakeButton(), close = fakeButton();
    createDialog(d.el, open.el, close.el);
    open.click();
    d.clickOn({ some: "paragraph" });
    expect(d.raw.close).not.toHaveBeenCalled();
    d.clickOn(d.el);
    expect(d.raw.close).toHaveBeenCalledTimes(1);
  });
});

describe("crédit Forest (spec forêt §5.2) — index.html", () => {
  const html = readFileSync(join(__dirname, "..", "index.html"), "utf8");
  const CREDIT = "Hansen/UMD/Google/USGS/NASA — Global Forest Change 2000–2024 (v1.12), CC BY 4.0";
  it("#attribution : mention masquée par défaut, affichée quand Forest est active", () => {
    const attribution = html.match(/<p id="attribution">([\s\S]*?)<\/p>/)![1]!;
    expect(attribution).toContain(`<span id="attribution-forest" hidden> · ${CREDIT}</span>`);
  });
  it("panneau About : crédit permanent, couche décrite, repli 2023 mentionné", () => {
    const about = html.match(/<dialog id="about"[\s\S]*?<\/dialog>/)![0];
    expect(about).toContain(CREDIT);
    expect(about).toContain("<strong>Forest</strong>");
    expect(about).toMatch(/2023 release/);
  });
});
