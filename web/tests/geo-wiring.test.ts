import { describe, expect, it, vi } from "vitest";
import { wireGeo, type GeoWiringDeps } from "../src/geo/wiring";
import type { LabelSet } from "../src/labels/data";
import type { RiversLayer } from "../src/render/rivers";
import type { RiverSegments } from "../src/rivers/data";
import type { ViewState } from "../src/tiles/lod";

/** Faux bouton : Vitest tourne sans DOM. */
function fakeButton() {
  const attrs = new Map<string, string>();
  let click: (() => void) | null = null;
  const b = {
    disabled: false,
    title: "",
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    addEventListener: (_: string, cb: () => void) => { click = cb; },
  };
  return { button: b as unknown as HTMLButtonElement, raw: b, attrs, click: () => click?.() };
}

/** Promesse résolue ou rejetée à la main : fige un téléchargement en cours. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const SET = { items: [] } as unknown as LabelSet;
const SEGMENTS = {} as RiverSegments;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function harness(search = "") {
  const labelsButton = fakeButton();
  const riversButton = fakeButton();
  const labels = { setData: vi.fn(), setEnabled: vi.fn() };
  const riversLayer = { object: { visible: false }, setView: vi.fn(), dispose: vi.fn() };
  const viewListeners: ((view: ViewState) => void)[] = [];
  const state = { search };
  const deps = {
    labelsButton: labelsButton.button,
    riversButton: riversButton.button,
    labels,
    loadLabels: vi.fn(async () => SET),
    loadRivers: vi.fn(async () => SEGMENTS),
    createRivers: vi.fn(() => riversLayer as unknown as RiversLayer),
    scene: {
      add: vi.fn(),
      onViewChange: vi.fn((cb: (view: ViewState) => void) => void viewListeners.push(cb)),
      requestRender: vi.fn(),
      distance: () => 2,
    },
    search: () => state.search,
    replaceSearch: vi.fn((s: string) => { state.search = s; }),
  } satisfies GeoWiringDeps;
  return { deps, labelsButton, riversButton, labels, riversLayer, viewListeners, state };
}

describe("wireGeo — étiquettes (spec repères §6, §7)", () => {
  it("allumées par défaut : charge, pose les données puis active ; l'interrupteur reflète l'état", async () => {
    const h = harness();
    wireGeo(h.deps).start();
    await flush();
    expect(h.deps.loadLabels).toHaveBeenCalledTimes(1);
    expect(h.labels.setData).toHaveBeenCalledWith(SET);
    expect(h.labels.setEnabled).toHaveBeenLastCalledWith(true);
    expect(h.labelsButton.attrs.get("aria-checked")).toBe("true");
  });

  it("?labels=0 : rien n'est téléchargé avant le premier clic ; le clic écrit l'URL", async () => {
    const h = harness("?layer=temp&labels=0");
    wireGeo(h.deps).start();
    await flush();
    expect(h.deps.loadLabels).not.toHaveBeenCalled();
    expect(h.labels.setEnabled).toHaveBeenLastCalledWith(false);
    h.labelsButton.click();
    await flush();
    expect(h.deps.replaceSearch).toHaveBeenCalledWith("?layer=temp&labels=1");
    expect(h.deps.loadLabels).toHaveBeenCalledTimes(1);
    expect(h.labels.setEnabled).toHaveBeenLastCalledWith(true);
  });

  it("un seul téléchargement par session, même après extinction et rallumage", async () => {
    const h = harness();
    wireGeo(h.deps).start();
    await flush();
    h.labelsButton.click();
    h.labelsButton.click();
    await flush();
    expect(h.deps.loadLabels).toHaveBeenCalledTimes(1);
    expect(h.labels.setData).toHaveBeenCalledTimes(1);
    expect(h.labels.setEnabled.mock.calls.map((c) => c[0])).toEqual([true, false, true]);
  });

  it("éteintes pendant le téléchargement : l'état relu après l'attente l'emporte", async () => {
    const h = harness();
    const d = deferred<LabelSet>();
    h.deps.loadLabels.mockReturnValueOnce(d.promise);
    wireGeo(h.deps).start();
    h.labelsButton.click(); // off, téléchargement encore en vol
    d.resolve(SET);
    await flush();
    expect(h.labels.setEnabled).toHaveBeenLastCalledWith(false);
    expect(h.labels.setEnabled).not.toHaveBeenCalledWith(true);
  });

  it("échec : interrupteur grisé, rien n'est activé", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = harness();
    h.deps.loadLabels.mockRejectedValueOnce(new Error("404"));
    wireGeo(h.deps).start();
    await flush();
    expect(h.labelsButton.raw.disabled).toBe(true);
    expect(h.labelsButton.raw.title).toBe("Labels unavailable");
    expect(h.labels.setEnabled).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("wireGeo — fleuves (spec repères §6, §7)", () => {
  it("allumés par défaut : un maillage ajouté à la scène, calé sur la vue, visible, rendu demandé", async () => {
    const h = harness();
    const geo = wireGeo(h.deps);
    expect(geo.rivers()).toBeNull();
    geo.start();
    await flush();
    expect(h.deps.createRivers).toHaveBeenCalledWith(SEGMENTS);
    expect(h.deps.scene.add).toHaveBeenCalledWith(h.riversLayer.object);
    expect(h.riversLayer.setView).toHaveBeenCalledWith(2, expect.any(Number));
    expect(h.riversLayer.object.visible).toBe(true);
    expect(h.deps.scene.requestRender).toHaveBeenCalled();
    expect(geo.rivers()).toBe(h.riversLayer);
  });

  it("?rivers=0 : rien n'est téléchargé ni créé avant le premier clic", async () => {
    const h = harness("?rivers=0");
    wireGeo(h.deps).start();
    await flush();
    expect(h.deps.loadRivers).not.toHaveBeenCalled();
    expect(h.deps.createRivers).not.toHaveBeenCalled();
    h.riversButton.click();
    await flush();
    expect(h.deps.replaceSearch).toHaveBeenCalledWith("?rivers=1");
    expect(h.riversLayer.object.visible).toBe(true);
  });

  it("clics on/off/on pendant le téléchargement : une seule création, un seul écouteur de vue (I1)", async () => {
    const h = harness();
    const d = deferred<RiverSegments>();
    h.deps.loadRivers.mockReturnValueOnce(d.promise);
    wireGeo(h.deps).start();
    h.riversButton.click(); // off
    h.riversButton.click(); // on
    d.resolve(SEGMENTS);
    await flush();
    expect(h.deps.loadRivers).toHaveBeenCalledTimes(1);
    expect(h.deps.createRivers).toHaveBeenCalledTimes(1);
    expect(h.deps.scene.add).toHaveBeenCalledTimes(1);
    expect(h.deps.scene.onViewChange).toHaveBeenCalledTimes(1);
    expect(h.riversLayer.object.visible).toBe(true);
  });

  it("éteints pendant le téléchargement : le maillage est créé mais reste invisible", async () => {
    const h = harness();
    const d = deferred<RiverSegments>();
    h.deps.loadRivers.mockReturnValueOnce(d.promise);
    wireGeo(h.deps).start();
    h.riversButton.click(); // off
    d.resolve(SEGMENTS);
    await flush();
    expect(h.riversLayer.object.visible).toBe(false);
  });

  it("extinction : maillage masqué, rendu demandé ; la vue ne cale plus le maillage tant qu'il est éteint (dette n° 41)", async () => {
    const h = harness();
    wireGeo(h.deps).start();
    await flush();
    h.deps.scene.requestRender.mockClear();
    h.riversButton.click();
    await flush();
    expect(h.riversLayer.object.visible).toBe(false);
    expect(h.deps.scene.requestRender).toHaveBeenCalled();
    h.riversLayer.setView.mockClear();
    const view = { cameraPosition: { length: () => 3 } } as unknown as ViewState;
    h.viewListeners[0]!(view);
    expect(h.riversLayer.setView).not.toHaveBeenCalled();
    h.riversButton.click(); // rallumage : recalé tout de suite sur la distance courante, puis à chaque vue
    await flush();
    expect(h.riversLayer.setView).toHaveBeenLastCalledWith(2, expect.any(Number));
    h.viewListeners[0]!(view);
    expect(h.riversLayer.setView).toHaveBeenLastCalledWith(3, expect.any(Number));
  });

  it("échec : interrupteur grisé, rien dans la scène", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = harness();
    h.deps.loadRivers.mockRejectedValueOnce(new Error("404"));
    const geo = wireGeo(h.deps);
    geo.start();
    await flush();
    expect(h.riversButton.raw.disabled).toBe(true);
    expect(h.riversButton.raw.title).toBe("Rivers unavailable");
    expect(h.deps.scene.add).not.toHaveBeenCalled();
    expect(geo.rivers()).toBeNull();
    warn.mockRestore();
  });
});
