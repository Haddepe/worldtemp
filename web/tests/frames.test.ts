import { describe, expect, it, vi } from "vitest";
import {
  FrameSet, Limiter, RETRY_AFTER_MS, frameUrl, loadScalarFrame, loadWindFrame, redChannel, type FrameDeps,
} from "../src/data/frames";
import { TextureError } from "../src/data/loader";
import type { Frame } from "../src/data/manifest";

const G = { width: 4, height: 3 };

function frame(i: number): Frame {
  return { forecast_hour: 3 + 3 * i, valid_time_utc: "x", valid_ms: i, texture: `20260912T06Z/temp_f${String(3 + 3 * i).padStart(3, "0")}.png`, stats: { min: 0, max: 1 } };
}
const FRAMES = Array.from({ length: 6 }, (_, i) => frame(i));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Chargeur contrôlé : chaque appel crée une promesse en attente, résolue par le test. */
function controlled() {
  const calls: { i: number; d: ReturnType<typeof deferred<string>> }[] = [];
  const load = (_f: Frame, i: number) => {
    const d = deferred<string>();
    calls.push({ i, d });
    return d.promise;
  };
  return { calls, load };
}

describe("Limiter + FrameSet — spec lot E §5.4", () => {
  it("charge dans l'ordre voulu, au plus `max` à la fois", async () => {
    const lim = new Limiter(2);
    const { calls, load } = controlled();
    const set = new FrameSet(load, lim);
    set.setFrames("k", FRAMES);
    set.want([3, 4, 5, 2]);
    expect(calls.map((c) => c.i)).toEqual([3, 4]);
    expect(lim.running).toBe(2);
    calls[0]!.d.resolve("f3");
    await flush();
    expect(calls.map((c) => c.i)).toEqual([3, 4, 5]);
    expect(set.get(3)).toBe("f3");
    expect(set.isReady(3)).toBe(true);
    expect(set.stateOf(4)).toBe("loading");
  });
  it("want remplace l'ordre en attente (les chargements en vol continuent)", async () => {
    const lim = new Limiter(1);
    const { calls, load } = controlled();
    const set = new FrameSet(load, lim);
    set.setFrames("k", FRAMES);
    set.want([0, 1, 2]);
    set.want([5, 4]);
    calls[0]!.d.resolve("f0");
    await flush();
    expect(calls.map((c) => c.i)).toEqual([0, 5]);
  });
  it("onReady est appelé avec l'index chargé", async () => {
    const onReady = vi.fn();
    const set = new FrameSet(async (_f, i) => `f${i}`, new Limiter(3), onReady);
    set.setFrames("k", FRAMES);
    set.want([2]);
    await flush();
    expect(onReady).toHaveBeenCalledWith(2);
  });
  it("ensure : résolue quand la paire est prête, prioritaire sur l'ordre voulu", async () => {
    const lim = new Limiter(1);
    const { calls, load } = controlled();
    const set = new FrameSet(load, lim);
    set.setFrames("k", FRAMES);
    const done = vi.fn();
    void set.ensure([4, 5]).then(done);
    set.want([4, 5, 0]);
    calls[0]!.d.resolve("f4");
    await flush();
    expect(done).not.toHaveBeenCalled();
    calls[1]!.d.resolve("f5");
    await flush();
    expect(done).toHaveBeenCalled();
    expect(calls.map((c) => c.i)).toEqual([4, 5, 0]);
  });
  it("ensure : rejetée si une échéance échoue ; isSettled vrai pour une échéance en échec", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const set = new FrameSet(async (_f, i) => {
      if (i === 1) throw new Error("HTTP 404");
      return `f${i}`;
    }, new Limiter(3));
    set.setFrames("k", FRAMES);
    await expect(set.ensure([0, 1])).rejects.toThrowError(/unavailable/);
    expect(set.stateOf(1)).toBe("failed");
    expect(set.isSettled(1)).toBe(true);
    expect(set.isReady(1)).toBe(false);
    expect(set.isSettled(2)).toBe(false);
    warn.mockRestore();
  });
  it("échéance en échec : pas de nouvel essai avant RETRY_AFTER_MS", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 1_000;
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error("HTTP 503");
      return "ok";
    });
    const set = new FrameSet(load, new Limiter(3), () => {}, () => now);
    set.setFrames("k", FRAMES);
    set.want([0]);
    await flush();
    fail = false;
    set.want([0]);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    now += RETRY_AFTER_MS;
    set.want([0]);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(set.get(0)).toBe("ok");
    warn.mockRestore();
  });
  it("setFrames avec une autre clé : tout est oublié, les résultats en vol sont ignorés, les attentes rejetées", async () => {
    const lim = new Limiter(3);
    const { calls, load } = controlled();
    const set = new FrameSet(load, lim);
    set.setFrames("run1", FRAMES);
    const pending = set.ensure([0]);
    set.setFrames("run2", FRAMES);
    await expect(pending).rejects.toThrowError(/replaced/);
    calls[0]!.d.resolve("ancien");
    await flush();
    expect(set.get(0)).toBeNull();
    set.setFrames("run2", FRAMES); // même clé : rien ne change
    expect(set.length).toBe(6);
  });
  it("dispose : se désinscrit du limiteur et ignore le chargement en vol", async () => {
    const lim = new Limiter(1);
    const { calls, load } = controlled();
    const set = new FrameSet(load, lim);
    set.setFrames("k", FRAMES);
    set.want([0, 1]);
    set.dispose();
    calls[0]!.d.resolve("f0");
    await flush();
    expect(calls).toHaveLength(1);
    expect(set.get(0)).toBeNull();
  });
  it("priorité : la couche (0) passe avant le vent (1) quel que soit l'ordre d'inscription", async () => {
    const lim = new Limiter(1);
    const wind = controlled();
    const layer = controlled();
    const w = new FrameSet(wind.load, lim, () => {}, Date.now, 1); // inscrit en premier
    const l = new FrameSet(layer.load, lim);
    w.setFrames("w", FRAMES);
    l.setFrames("l", FRAMES);
    w.want([0, 1]); // le vent prend la seule place ; son échéance 1 attend
    l.want([0]);    // la couche attend aussi
    expect(wind.calls).toHaveLength(1);
    wind.calls[0]!.d.resolve("w0");
    await flush();
    expect(layer.calls).toHaveLength(1); // la place libérée va à la couche…
    expect(wind.calls).toHaveLength(1);  // …avant l'échéance suivante du vent
  });
});

describe("chargeurs d'échéances", () => {
  function bitmap(width = G.width, height = G.height) {
    return { width, height, close: vi.fn() } as unknown as ImageBitmap;
  }
  function rgba(n: number, r: (i: number) => number) {
    const px = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) px[i * 4] = r(i);
    return px;
  }

  it("frameUrl : chemin relatif sous la base, sans cache-busting (URL immuable)", () => {
    expect(frameUrl("https://x.test/layers", FRAMES[0]!)).toBe("https://x.test/layers/20260912T06Z/temp_f003.png");
  });
  it("redChannel : un octet sur quatre", () => {
    expect([...redChannel(rgba(3, (i) => i + 10))]).toEqual([10, 11, 12]);
  });
  it("loadScalarFrame : canal R seul, bitmap fermé, rendu = valeurs sans flou", async () => {
    const b = bitmap();
    const deps: FrameDeps = { fetchBitmap: vi.fn(async () => b), bitmapPixels: () => rgba(12, (i) => i * 20) };
    const f = await loadScalarFrame(deps, "B", FRAMES[0]!, G, 0);
    expect([...f.values]).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220]);
    expect(f.render).toBe(f.values);
    expect(b.close).toHaveBeenCalled();
    expect(deps.fetchBitmap).toHaveBeenCalledWith("B/20260912T06Z/temp_f003.png");
  });
  it("loadScalarFrame : soften > 0 → rendu flouté distinct, valeurs brutes gardées", async () => {
    const deps: FrameDeps = { fetchBitmap: async () => bitmap(), bitmapPixels: () => rgba(12, (i) => (i === 5 ? 255 : 0)) };
    const f = await loadScalarFrame(deps, "B", FRAMES[0]!, G, 1.2);
    expect(f.values[5]).toBe(255);
    expect(f.render).not.toBe(f.values);
    expect(f.render[5]!).toBeLessThan(255);
    expect(f.render).toHaveLength(12);
  });
  it("loadScalarFrame : taille inattendue ou pixels illisibles → erreur, bitmap fermé", async () => {
    const small = bitmap(2, 2);
    await expect(loadScalarFrame({ fetchBitmap: async () => small, bitmapPixels: () => rgba(4, () => 0) }, "B", FRAMES[0]!, G, 0))
      .rejects.toThrowError(TextureError);
    expect(small.close).toHaveBeenCalled();
    const b = bitmap();
    await expect(loadScalarFrame({ fetchBitmap: async () => b, bitmapPixels: () => null }, "B", FRAMES[0]!, G, 0))
      .rejects.toThrowError(/pixels/);
    expect(b.close).toHaveBeenCalled();
  });
  it("loadWindFrame : U et V entrelacés, deux bitmaps fermés", async () => {
    const bu = bitmap();
    const bv = bitmap();
    const deps: FrameDeps = {
      fetchBitmap: async (url) => (url.includes("wind_u") ? bu : bv),
      bitmapPixels: (b) => rgba(12, () => (b === bu ? 200 : 50)),
    };
    const u = { ...FRAMES[0]!, texture: "20260912T06Z/wind_u_f003.png" };
    const v = { ...FRAMES[0]!, texture: "20260912T06Z/wind_v_f003.png" };
    const uv = await loadWindFrame(deps, "B", u, v, G);
    expect(uv).toHaveLength(24);
    expect([uv[0], uv[1], uv[22], uv[23]]).toEqual([200, 50, 200, 50]);
    expect(bu.close).toHaveBeenCalled();
    expect(bv.close).toHaveBeenCalled();
  });
  it("loadWindFrame : une composante en échec → rejet, l'autre bitmap fermé", async () => {
    const bu = bitmap();
    const deps: FrameDeps = {
      fetchBitmap: async (url) => {
        if (url.includes("wind_v")) throw new Error("HTTP 404");
        return bu;
      },
      bitmapPixels: () => rgba(12, () => 0),
    };
    const u = { ...FRAMES[0]!, texture: "20260912T06Z/wind_u_f003.png" };
    const v = { ...FRAMES[0]!, texture: "20260912T06Z/wind_v_f003.png" };
    await expect(loadWindFrame(deps, "B", u, v, G)).rejects.toThrowError(/404/);
    expect(bu.close).toHaveBeenCalled();
  });
});

describe("Task 8 — corrections revue round 1", () => {
  it("dispose : rejette les ensure() en attente avec /released/", async () => {
    const lim = new Limiter(1);
    const { load } = controlled();
    const set = new FrameSet(load, lim);
    set.setFrames("k", FRAMES);
    const pending = set.ensure([0, 1]);
    set.dispose();
    await expect(pending).rejects.toThrowError(/released/);
  });
  it("ensure après dispose : rejetée immédiatement", async () => {
    const lim = new Limiter(1);
    const { load } = controlled();
    const set = new FrameSet(load, lim);
    set.setFrames("k", FRAMES);
    set.dispose();
    await expect(set.ensure([0])).rejects.toThrowError(/released/);
  });
  it("isReady(i) redevient faux après dispose", async () => {
    const lim = new Limiter(1);
    const set = new FrameSet(async (_f, i) => `f${i}`, lim);
    set.setFrames("k", FRAMES);
    set.want([0]);
    await flush();
    expect(set.isReady(0)).toBe(true);
    set.dispose();
    expect(set.isReady(0)).toBe(false);
  });
  it("erreur d'une tâche (onReady qui lève) : journalisée, la place libérée profite à l'échéance suivante", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const lim = new Limiter(1);
    let calls = 0;
    const onReady = vi.fn(() => {
      calls++;
      if (calls === 1) throw new Error("boom");
    });
    const set = new FrameSet(async (_f, i) => `f${i}`, lim, onReady);
    set.setFrames("k", FRAMES);
    set.want([0]);
    await flush();
    expect(error).toHaveBeenCalledWith("[worldtemp] forecast frame task failed:", expect.any(Error));
    expect(lim.running).toBe(0);
    expect(set.isReady(0)).toBe(true);
    set.want([0, 1]);
    await flush();
    expect(set.isReady(1)).toBe(true); // l'échéance suivante démarre normalement malgré l'erreur précédente
    error.mockRestore();
  });
  it("échéance en échec : la place limiteur est libérée", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lim = new Limiter(1);
    const set = new FrameSet(async () => {
      throw new Error("HTTP 500");
    }, lim);
    set.setFrames("k", FRAMES);
    set.want([0]);
    await flush();
    expect(set.stateOf(0)).toBe("failed");
    expect(lim.running).toBe(0);
    warn.mockRestore();
  });
  it("setFrames pendant un chargement en vol : la place limiteur est libérée quand il se règle", async () => {
    const lim = new Limiter(1);
    const { calls, load } = controlled();
    const set = new FrameSet(load, lim);
    set.setFrames("run1", FRAMES);
    set.want([0]);
    expect(lim.running).toBe(1);
    set.setFrames("run2", FRAMES); // change de génération pendant que l'échéance 0 est en vol
    calls[0]!.d.resolve("stale");
    await flush();
    expect(lim.running).toBe(0);
  });
  it("key : null avant setFrames, clé du dernier setFrames, de nouveau null après dispose (revue T12 round 1)", async () => {
    const lim = new Limiter(1);
    const set = new FrameSet(async (_f, i) => `f${i}`, lim);
    expect(set.key).toBeNull();
    set.setFrames("run1|2026-09-12T10:12:40Z", FRAMES);
    expect(set.key).toBe("run1|2026-09-12T10:12:40Z");
    set.setFrames("run1|2026-09-12T10:12:40Z", FRAMES); // même clé : inchangé
    expect(set.key).toBe("run1|2026-09-12T10:12:40Z");
    set.setFrames("run2|2026-09-12T13:12:40Z", FRAMES);
    expect(set.key).toBe("run2|2026-09-12T13:12:40Z");
    set.dispose();
    expect(set.key).toBeNull();
  });
  it("répartition par rang : le vent passe avant la suite du préchargement de la couche (rang, pas seulement priorité)", async () => {
    const lim = new Limiter(1);
    const layer = controlled();
    const wind = controlled();
    const l = new FrameSet(layer.load, lim); // priorité par défaut (0)
    const w = new FrameSet(wind.load, lim, () => {}, Date.now, 1); // priorité 1 (après la couche)
    l.setFrames("l", FRAMES);
    w.setFrames("w", FRAMES);
    l.want([0, 1, 2, 3, 4, 5]); // préchargement complet de la couche
    expect(layer.calls).toHaveLength(1);
    w.want([0]);
    expect(wind.calls).toHaveLength(0); // la seule place est prise par la couche
    layer.calls[0]!.d.resolve("l0");
    await flush();
    expect(wind.calls).toHaveLength(1); // le vent (rang 0) passe avant l'échéance 1 de la couche (rang 1)
    expect(layer.calls).toHaveLength(1);
  });
});
