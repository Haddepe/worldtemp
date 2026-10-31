/**
 * `ui/modes.ts` (neige, spec §7) : Vitest tourne sans DOM (ni jsdom, ni happy-dom) — faux DOM
 * minimal, comme labels-layer.test.ts. Ne couvre que ce que `modes.ts` touche réellement.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { layerDef } from "../src/layers/registry";
import { createModeSwitch } from "../src/ui/modes";

interface FakeButton {
  type: string;
  textContent: string;
  tabIndex: number;
  dataset: Record<string, string>;
  attrs: Map<string, string>;
  focused: boolean;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  addEventListener(type: string, cb: (e: unknown) => void): void;
  focus(): void;
  fire(type: string, e?: unknown): void;
}

function fakeButton(): FakeButton {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const b: FakeButton = {
    type: "",
    textContent: "",
    tabIndex: 0,
    dataset: {},
    attrs: new Map(),
    focused: false,
    setAttribute: (k, v) => void b.attrs.set(k, v),
    getAttribute: (k) => b.attrs.get(k) ?? null,
    addEventListener: (type, cb) => void listeners.set(type, [...(listeners.get(type) ?? []), cb]),
    focus: () => { b.focused = true; },
    fire: (type, e) => { for (const cb of listeners.get(type) ?? []) cb(e ?? {}); },
  };
  return b;
}

function installFakeDom() {
  const created: FakeButton[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const b = fakeButton();
      created.push(b);
      return b;
    },
  });
  const attrs = new Map<string, string>();
  let children: FakeButton[] = [];
  const container = {
    hidden: false,
    attrs,
    get children() { return children; },
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    replaceChildren: (...c: FakeButton[]) => { children = c; },
    appendChild: (c: FakeButton) => { children.push(c); return c; },
  };
  return { container, created };
}

const key = (k: string) => ({ key: k, preventDefault: () => {} });
const SNOW = [layerDef("snowfall")!, layerDef("snow_depth")!];

describe("createModeSwitch — sélecteur Snowfall | Depth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("groupe radio étiqueté, un bouton par mode, aria-checked sur l'actif", () => {
    const { container } = installFakeDom();
    const sw = createModeSwitch(container as unknown as HTMLElement, () => {});
    sw.set(SNOW, "snowfall");
    expect(container.attrs.get("role")).toBe("radiogroup");
    expect(container.attrs.get("aria-label")).toBe("Snow mode");
    expect(container.hidden).toBe(false);
    const [a, b] = container.children;
    expect(container.children).toHaveLength(2);
    expect([a!.textContent, b!.textContent]).toEqual(["Snowfall", "Depth"]);
    expect(a!.attrs.get("role")).toBe("radio");
    expect(a!.attrs.get("aria-checked")).toBe("true");
    expect(b!.attrs.get("aria-checked")).toBe("false");
    expect([a!.tabIndex, b!.tabIndex]).toEqual([0, -1]); // tabindex roulant sur l'actif
  });

  it("clic sur Depth → onPick(\"snow_depth\") ; clic sur le mode actif → rien", () => {
    const { container } = installFakeDom();
    const onPick = vi.fn();
    const sw = createModeSwitch(container as unknown as HTMLElement, onPick);
    sw.set(SNOW, "snowfall");
    container.children[0]!.fire("click");
    expect(onPick).not.toHaveBeenCalled();
    container.children[1]!.fire("click");
    expect(onPick).toHaveBeenCalledWith("snow_depth");
    expect(container.children[1]!.attrs.get("aria-checked")).toBe("true");
  });

  it("flèche droite → mode suivant (focalisé), flèche gauche boucle", () => {
    const { container } = installFakeDom();
    const onPick = vi.fn();
    const sw = createModeSwitch(container as unknown as HTMLElement, onPick);
    sw.set(SNOW, "snowfall");
    container.children[0]!.fire("keydown", key("ArrowRight"));
    expect(onPick).toHaveBeenLastCalledWith("snow_depth");
    expect(container.children[1]!.focused).toBe(true);
    container.children[1]!.fire("keydown", key("ArrowRight")); // boucle
    expect(onPick).toHaveBeenLastCalledWith("snowfall");
    container.children[0]!.fire("keydown", key("ArrowLeft"));
    expect(onPick).toHaveBeenLastCalledWith("snow_depth");
  });

  it("set des mêmes modes : boutons gardés (le focus clavier survit à activate)", () => {
    const { container, created } = installFakeDom();
    const sw = createModeSwitch(container as unknown as HTMLElement, () => {});
    sw.set(SNOW, "snowfall");
    sw.set(SNOW, "snow_depth");
    expect(created).toHaveLength(2);
    expect(container.children[1]!.attrs.get("aria-checked")).toBe("true");
  });

  it("set([]) masque le conteneur", () => {
    const { container } = installFakeDom();
    const sw = createModeSwitch(container as unknown as HTMLElement, () => {});
    sw.set(SNOW, "snowfall");
    sw.set([], "temp");
    expect(container.hidden).toBe(true);
    expect(container.children).toHaveLength(0);
  });
});
