import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lonLatToVec3 } from "../src/tiles/patch";
import type { ForestReading, TileReader } from "../src/tiles/reader";
import { TapDetector, createTooltip, forestText, mouseInput, placeTooltip, tooltipText, type Reading } from "../src/ui/tooltip";

describe("TapDetector — spec navigation §6", () => {
  it("tap valide : down puis up < 300 ms, < 8 px → position du down", () => {
    const d = new TapDetector();
    expect(d.feed({ type: "down", id: 1, x: 100, y: 100, t: 0 })).toBeNull();
    expect(d.feed({ type: "move", id: 1, x: 103, y: 102, t: 50 })).toBeNull();
    expect(d.feed({ type: "up", id: 1, x: 103, y: 102, t: 120 })).toEqual({ x: 100, y: 100 });
  });
  it("glisser > 8 px → pas de tap", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    d.feed({ type: "move", id: 1, x: 10, y: 0, t: 50 });
    expect(d.feed({ type: "up", id: 1, x: 10, y: 0, t: 100 })).toBeNull();
  });
  it("durée ≥ 300 ms → pas de tap", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    expect(d.feed({ type: "up", id: 1, x: 0, y: 0, t: 300 })).toBeNull();
  });
  it("second doigt pendant le geste → pas de tap, même après son retrait", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    d.feed({ type: "down", id: 2, x: 50, y: 50, t: 10 });
    d.feed({ type: "up", id: 2, x: 50, y: 50, t: 20 });
    expect(d.feed({ type: "up", id: 1, x: 0, y: 0, t: 30 })).toBeNull();
  });
  it("cancel réinitialise", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    d.feed({ type: "cancel", id: 1, x: 0, y: 0, t: 10 });
    expect(d.feed({ type: "up", id: 1, x: 0, y: 0, t: 20 })).toBeNull();
    d.feed({ type: "down", id: 1, x: 5, y: 5, t: 100 });
    expect(d.feed({ type: "up", id: 1, x: 5, y: 5, t: 150 })).toEqual({ x: 5, y: 5 });
  });
  it("le geste suivant repart de zéro après un tap", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    d.feed({ type: "up", id: 1, x: 0, y: 0, t: 10 });
    d.feed({ type: "down", id: 2, x: 9, y: 9, t: 500 });
    expect(d.feed({ type: "up", id: 2, x: 9, y: 9, t: 510 })).toEqual({ x: 9, y: 9 });
  });
});

describe("placeTooltip", () => {
  const tip = { w: 80, h: 30 };
  const vp = { w: 1000, h: 800 };
  it("au-dessus du point, centré, décalage 14 px", () => {
    expect(placeTooltip({ x: 500, y: 400 }, tip, vp)).toEqual({ left: 460, top: 356 });
  });
  it("en dessous si le point est à moins de 48 px du haut", () => {
    expect(placeTooltip({ x: 500, y: 40 }, tip, vp)).toEqual({ left: 460, top: 54 });
  });
  it("borné horizontalement dans le viewport (marge 4 px)", () => {
    expect(placeTooltip({ x: 10, y: 400 }, tip, vp).left).toBe(4);
    expect(placeTooltip({ x: 995, y: 400 }, tip, vp).left).toBe(1000 - 80 - 4);
  });
});

describe("tooltipText — nom du lieu au-dessus des valeurs (spec lot F §5.3)", () => {
  it("nom puis valeurs, une par ligne", () => {
    expect(tooltipText("Paris", ["12 °C", "Wind 10 km/h"])).toBe("Paris\n12 °C\nWind 10 km/h");
  });
  it("sans nom : valeurs seules ; sans valeur : nom seul ; rien : null", () => {
    expect(tooltipText(undefined, ["12 °C"])).toBe("12 °C");
    expect(tooltipText("Paris", [])).toBe("Paris");
    expect(tooltipText(undefined, [])).toBeNull();
  });
});

/** Éléments factices : Vitest tourne sans DOM, le tooltip n'utilise que ces membres. */
function fakeEls() {
  const el = () => ({ hidden: true, textContent: "", offsetWidth: 80, offsetHeight: 20, style: { transform: "" }, setAttribute: vi.fn() });
  return { tip: el(), marker: el() } as unknown as { tip: HTMLElement; marker: HTMLElement };
}

/** Caméra à d = 3 au-dessus de (0°, 0°), regardant le centre du globe. */
function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  cam.position.copy(lonLatToVec3(0, 0, new THREE.Vector3()).multiplyScalar(3));
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

describe("createTooltip — épingle (relecture finale lot F, F2 et F4)", () => {
  it("isPinned : vrai seulement en mode pin avec une lecture", () => {
    const t = createTooltip(fakeEls());
    expect(t.isPinned()).toBe(false);
    t.setReading(null, "pin");
    expect(t.isPinned()).toBe(false);
    t.setReading({ lon: 0, lat: 0 }, "pin");
    expect(t.isPinned()).toBe(true);
    t.setReading({ lon: 0, lat: 0 }, "hover");
    expect(t.isPinned()).toBe(false);
  });
  it("épinglé sans couche, sans vent ni nom : marqueur visible, bulle masquée", () => {
    const els = fakeEls();
    const t = createTooltip(els);
    t.setReading({ lon: 0, lat: 0 }, "pin");
    t.update(camera(), 400, 400);
    expect(els.marker.hidden).toBe(false);
    expect(els.tip.hidden).toBe(true);
  });
  it("épinglé avec un nom : marqueur et bulle visibles", () => {
    const els = fakeEls();
    const t = createTooltip(els);
    t.setReading({ lon: 0, lat: 0, name: "Epinal" }, "pin");
    t.update(camera(), 400, 400);
    expect(els.marker.hidden).toBe(false);
    expect(els.tip.hidden).toBe(false);
    expect(els.tip.textContent).toBe("Epinal");
  });
  it("pinned : position écran et texte d'une épingle visible (ville)", () => {
    const t = createTooltip(fakeEls());
    t.setReading({ lon: 0, lat: 0, name: "Epinal", origin: "city" }, "pin");
    t.update(camera(), 400, 400);
    const p = t.pinned()!;
    expect(p.x).toBeCloseTo(200, 6);
    expect(p.y).toBeCloseTo(200, 6);
    expect(p.text).toBe("Epinal");
  });
  it("pinned : null pour « ma position », en survol, avant update, ou derrière le globe", () => {
    const loc = createTooltip(fakeEls());
    loc.setReading({ lon: 0, lat: 0, origin: "locate" }, "pin");
    loc.update(camera(), 400, 400);
    expect(loc.pinned()).toBeNull();
    const hover = createTooltip(fakeEls());
    hover.setReading({ lon: 0, lat: 0, name: "X" }, "hover");
    hover.update(camera(), 400, 400);
    expect(hover.pinned()).toBeNull();
    const early = createTooltip(fakeEls());
    early.setReading({ lon: 0, lat: 0, origin: "user" }, "pin");
    expect(early.pinned()).toBeNull();
    const behind = createTooltip(fakeEls());
    behind.setReading({ lon: 180, lat: 0, origin: "user" }, "pin");
    behind.update(camera(), 400, 400);
    expect(behind.pinned()).toBeNull();
  });
  it("pinned : épingle sans texte (ni couche ni nom) → text null", () => {
    const t = createTooltip(fakeEls());
    t.setReading({ lon: 0, lat: 0, origin: "user" }, "pin");
    t.update(camera(), 400, 400);
    expect(t.pinned()).toMatchObject({ text: null });
  });
  it("survol sans rien à écrire : ni marqueur ni bulle", () => {
    const els = fakeEls();
    const t = createTooltip(els);
    t.setReading({ lon: 0, lat: 0 }, "hover");
    t.update(camera(), 400, 400);
    expect(els.marker.hidden).toBe(true);
    expect(els.tip.hidden).toBe(true);
  });
});

describe("mouseInput — le survol n'écrase pas une lecture épinglée (F2)", () => {
  function fake(pinned: boolean) {
    const t = { pinned, setReading: vi.fn((r: Reading | null, m: "hover" | "pin") => void (t.pinned = m === "pin" && r !== null)), isPinned: () => t.pinned };
    return t;
  }
  const here: Reading = { lon: 1, lat: 2 };
  it("non épinglé : move lit le point survolé, leave efface", () => {
    const t = fake(false);
    expect(mouseInput(t, "move", () => here)).toBe(true);
    expect(t.setReading).toHaveBeenLastCalledWith(here, "hover");
    expect(mouseInput(t, "leave", () => here)).toBe(true);
    expect(t.setReading).toHaveBeenLastCalledWith(null, "hover");
  });
  it("épinglé : move et leave ignorés", () => {
    const t = fake(true);
    const read = vi.fn(() => here);
    expect(mouseInput(t, "move", read)).toBe(false);
    expect(mouseInput(t, "leave", read)).toBe(false);
    expect(t.setReading).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it("épinglé : un clic lève l'épingle, puis le survol reprend", () => {
    const t = fake(true);
    expect(mouseInput(t, "down", () => here)).toBe(true);
    expect(t.setReading).toHaveBeenLastCalledWith(null, "hover");
    expect(mouseInput(t, "move", () => here)).toBe(true);
    expect(t.setReading).toHaveBeenLastCalledWith(here, "hover");
  });
  it("non épinglé : un clic ne change rien", () => {
    const t = fake(false);
    expect(mouseInput(t, "down", () => here)).toBe(false);
    expect(t.setReading).not.toHaveBeenCalled();
  });
});

describe("forestText — tooltip de la couche Forest (spec forêt §7)", () => {
  it("couvert, perte, rien", () => {
    expect(forestText({ cover: 85, lossYear: null, level: 8 })).toBe("Tree cover 85%");
    expect(forestText({ cover: 60, lossYear: 2019, level: 8 })).toBe("Forest lost in 2019");
    expect(forestText({ cover: 0, lossYear: null, level: 7 })).toBe("No forest");
    expect(forestText(null)).toBe("No forest");
  });
});

describe("createTooltip — lecture de la tuile forêt (Review Focus 1)", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());
  /** Lecteur factice : tuile non décodée tant que `ready` est faux ; `read` résout à la main. */
  function fakeReader(value: (lon: number) => ForestReading | null) {
    let ready = false;
    let release: () => void = () => {};
    const reader: Pick<TileReader, "peek" | "read"> = {
      peek: (lon) => (ready ? value(lon) : undefined),
      read: vi.fn((lon: number) => new Promise<ForestReading | null>((resolve) => {
        release = () => {
          ready = true;
          resolve(value(lon));
        };
      })),
    };
    return { reader, release: async () => { release(); await Promise.resolve(); await Promise.resolve(); } };
  }

  it("tuile pas encore décodée : « … », jamais une valeur devinée ; puis la valeur lue", async () => {
    const els = fakeEls();
    const t = createTooltip(els);
    const f = fakeReader(() => ({ cover: 85, lossYear: null, level: 8 }));
    t.setForest(f.reader);
    t.setReading({ lon: 0, lat: 0 }, "hover");
    t.update(camera(), 400, 400);
    expect(els.tip.textContent).toBe("…");
    expect(els.tip.hidden).toBe(false);
    vi.advanceTimersByTime(100);
    await f.release();
    expect(els.tip.textContent).toBe("Tree cover 85%");
  });

  it("le point a changé avant la fin du décodage : le texte suit le point courant", async () => {
    const els = fakeEls();
    const t = createTooltip(els);
    const f = fakeReader((lon) => (lon < 0 ? { cover: 40, lossYear: null, level: 8 } : { cover: 90, lossYear: 2012, level: 8 }));
    t.setForest(f.reader);
    t.setReading({ lon: -1, lat: 0 }, "hover");
    t.setReading({ lon: 1, lat: 0, name: "Here" }, "hover");
    vi.advanceTimersByTime(100);
    await f.release();
    expect(els.tip.textContent).toBe("Here\nForest lost in 2012");
  });

  it("survol rapide : une seule lecture, celle du dernier point, 100 ms après l'arrêt", () => {
    const t = createTooltip(fakeEls());
    const f = fakeReader(() => ({ cover: 50, lossYear: null, level: 8 }));
    t.setForest(f.reader);
    for (let i = 0; i < 30; i++) {
      t.setReading({ lon: i, lat: 0 }, "hover");
      vi.advanceTimersByTime(20);
    }
    expect(f.reader.read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(f.reader.read).toHaveBeenCalledTimes(1);
    expect(f.reader.read).toHaveBeenLastCalledWith(29, 0);
  });

  it("couche quittée avant la fin du délai : aucune lecture", () => {
    const t = createTooltip(fakeEls());
    const f = fakeReader(() => null);
    t.setForest(f.reader);
    t.setReading({ lon: 0, lat: 0 }, "hover");
    t.setForest(null);
    vi.advanceTimersByTime(500);
    expect(f.reader.read).not.toHaveBeenCalled();
  });

  it("sans forêt à cet endroit : « No forest » ; setForest(null) retire la ligne", () => {
    const els = fakeEls();
    const t = createTooltip(els);
    t.setForest({ peek: () => null, read: async () => null });
    t.setReading({ lon: 0, lat: 0, name: "Here" }, "pin");
    expect(els.tip.textContent).toBe("Here\nNo forest");
    t.setForest(null);
    expect(els.tip.textContent).toBe("Here");
  });
});
