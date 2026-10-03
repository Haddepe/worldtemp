/**
 * `ui/capture-menu.ts` : Vitest tourne sans DOM — éléments et document factices écrits ici, qui ne
 * couvrent que ce que le menu touche (`hidden`, `focus`, `contains`, écouteurs).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaptureMenu } from "../src/ui/capture-menu";

type Handler = (e: { key?: string; target?: unknown }) => void;

function fakeTarget() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    handlers,
    addEventListener: (t: string, h: Handler) => void (handlers.get(t) ?? handlers.set(t, new Set()).get(t)!).add(h),
    removeEventListener: (t: string, h: Handler) => void handlers.get(t)?.delete(h),
    fire: (t: string, e: { key?: string; target?: unknown } = {}) => [...(handlers.get(t) ?? [])].forEach((h) => h(e)),
    count: (t: string) => handlers.get(t)?.size ?? 0,
  };
}

function setup() {
  const share = { ...fakeTarget(), focus: vi.fn() };
  const save = { ...fakeTarget(), focus: vi.fn() };
  const menu = { ...fakeTarget(), hidden: true, contains: (n: unknown) => n === menu || n === share || n === save };
  const doc = fakeTarget();
  vi.stubGlobal("document", doc);
  const m = createCaptureMenu({ menu, share, save } as unknown as { menu: HTMLElement; share: HTMLButtonElement; save: HTMLButtonElement });
  return { m, menu, share, save, doc };
}

afterEach(() => vi.unstubAllGlobals());

describe("createCaptureMenu — Share / Save image après la capture", () => {
  it("affiche le menu, met le focus sur Share, rend « save » au clic puis se referme", async () => {
    const { m, menu, share, save, doc } = setup();
    const p = m.choose();
    expect(menu.hidden).toBe(false);
    expect(share.focus).toHaveBeenCalled();
    save.fire("click");
    expect(await p).toBe("save");
    expect(menu.hidden).toBe(true);
    expect(doc.count("pointerdown") + doc.count("keydown") + save.count("click") + share.count("click")).toBe(0);
  });
  it("rend « share » au clic sur Share", async () => {
    const { m, share } = setup();
    const p = m.choose();
    share.fire("click");
    expect(await p).toBe("share");
  });
  it("Échap ou toucher hors du menu : null, menu refermé", async () => {
    const a = setup();
    const p1 = a.m.choose();
    a.doc.fire("keydown", { key: "Escape" });
    expect(await p1).toBeNull();
    expect(a.menu.hidden).toBe(true);
    const p2 = a.m.choose();
    a.doc.fire("pointerdown", { target: a.menu });
    a.doc.fire("keydown", { key: "a" });
    a.doc.fire("pointerdown", { target: {} });
    expect(await p2).toBeNull();
  });
});
