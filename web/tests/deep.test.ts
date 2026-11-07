import { describe, expect, it, vi } from "vitest";
import { tileAt } from "../src/tiles/grid";
import { DeepCatalog, cellOf, parseCatalog, parseDirectory, type ByteRange } from "../src/tiles/deep";
import type { DeepInfo } from "../src/tiles/manifest";

describe("cellOf — miroir de tiler/pack.py cell_of (test_cell_of)", () => {
  it("mêmes cas que test_cell_of", () => {
    expect(cellOf(9, 0, 0)).toBe("0_0");
    expect(cellOf(9, 1023, 511)).toBe("35_17");
    const t = tileAt(9, -59.9, -5.1);
    expect(cellOf(9, t.x, t.y)).toBe("12_9");
  });
});

/** Répertoire WTPK construit à la main (format de tiler/pack.py write_archive). */
function directory(records: [number, number, number, number, number][], over: { magic?: string; version?: number } = {}): ArrayBuffer {
  const buf = new ArrayBuffer(16 + 16 * records.length);
  const v = new DataView(buf);
  const magic = over.magic ?? "WTPK";
  for (let i = 0; i < 4; i++) v.setUint8(i, magic.charCodeAt(i));
  v.setUint8(4, over.version ?? 1);
  v.setUint32(8, records.length, true);
  records.forEach(([z, x, y, off, len], i) => {
    const o = 16 + 16 * i;
    v.setUint8(o, z);
    v.setUint16(o + 2, x, true);
    v.setUint16(o + 4, y, true);
    v.setUint32(o + 8, off, true);
    v.setUint32(o + 12, len, true);
  });
  return buf;
}

describe("parseDirectory", () => {
  it("deux enregistrements → plages justes, clés tileKey", () => {
    const d = parseDirectory(directory([[8, 300, 40, 48, 1000], [9, 600, 80, 1048, 70000]]));
    expect(d.size).toBe(2);
    expect(d.get("8/300/40")).toEqual({ offset: 48, length: 1000 });
    expect(d.get("9/600/80")).toEqual({ offset: 1048, length: 70000 });
  });
  it("magic, version ou longueur fausse → lève", () => {
    expect(() => parseDirectory(directory([[9, 1, 1, 32, 5]], { magic: "WTPX" }))).toThrow();
    expect(() => parseDirectory(directory([[9, 1, 1, 32, 5]], { version: 2 }))).toThrow();
    expect(() => parseDirectory(directory([[9, 1, 1, 32, 5]]).slice(0, 20))).toThrow();
    expect(() => parseDirectory(new ArrayBuffer(8))).toThrow();
  });
});

describe("parseCatalog", () => {
  it("cellules → compte et taille", () => {
    const c = parseCatalog({ format: "wtpk1", cells: { "12_8": { count: 812, bytes: 123456789 } } });
    expect(c.get("12_8")).toEqual({ count: 812, bytes: 123456789 });
    expect(c.size).toBe(1);
  });
  it("format inconnu ou cellule mal formée → lève", () => {
    expect(() => parseCatalog({ format: "wtpk2", cells: {} })).toThrow();
    expect(() => parseCatalog({ format: "wtpk1", cells: { a: { count: -1, bytes: 0 } } })).toThrow();
    expect(() => parseCatalog({ format: "wtpk1" })).toThrow();
    expect(() => parseCatalog(null)).toThrow();
  });
});

const INFO: DeepInfo = { baseUrl: "https://hf.test/datasets/o/r/resolve/abc/v1.12", maxLevel: 9, catalog: "catalog.json", format: "wtpk1" };
// Tuile 9/600/80 : lon −180 + 600.5·0.3515625 = 31.1…, lat 90 − 80.5·0.3515625 = 61.7… → cellule 21_2.
const T = { z: 9, x: 600, y: 80 };
const CELL = cellOf(T.z, T.x, T.y);

interface Pending<T> { resolve(v: T): void; reject(e: Error): void }

function harness(cells: Record<string, { count: number; bytes: number }> = { [CELL]: { count: 2, bytes: 99999 } }) {
  const json: (Pending<unknown> & { url: string })[] = [];
  const ranges: (Pending<ArrayBuffer> & { url: string; range: ByteRange })[] = [];
  let t = 0;
  const deps = {
    fetchJson: vi.fn((url: string, _signal: AbortSignal) => new Promise<unknown>((resolve, reject) => json.push({ url, resolve, reject }))),
    fetchRange: vi.fn((url: string, range: ByteRange, _signal: AbortSignal) =>
      new Promise<ArrayBuffer>((resolve, reject) => ranges.push({ url, range, resolve, reject }))),
    onChange: vi.fn(),
    now: () => t,
  };
  const cat = new DeepCatalog(INFO, deps);
  return {
    cat, deps, json, ranges,
    advance: (ms: number) => { t += ms; },
    catalogOk: async () => { json.shift()!.resolve({ format: "wtpk1", cells }); await flush(); },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("DeepCatalog.lookup", () => {
  it("pending, un seul catalogue et un seul répertoire même après 10 appels ; onChange une fois ; present / absent", async () => {
    const h = harness();
    for (let i = 0; i < 10; i++) expect(h.cat.lookup(T)).toEqual({ state: "pending" });
    expect(h.deps.fetchJson).toHaveBeenCalledTimes(1);
    expect(h.json[0]!.url).toBe(`${INFO.baseUrl}/catalog.json`);
    await h.catalogOk();
    for (let i = 0; i < 10; i++) expect(h.cat.lookup(T)).toEqual({ state: "pending" });
    expect(h.deps.fetchJson).toHaveBeenCalledTimes(1);
    expect(h.deps.fetchRange).toHaveBeenCalledTimes(1);
    expect(h.ranges[0]!.url).toBe(`${INFO.baseUrl}/${CELL}.wtpk`);
    expect(h.ranges[0]!.range).toEqual({ offset: 0, length: 16 + 16 * 2 });
    expect(h.deps.onChange).not.toHaveBeenCalled();
    h.ranges[0]!.resolve(directory([[9, 600, 80, 48, 500], [9, 601, 80, 548, 700]]));
    await flush();
    expect(h.deps.onChange).toHaveBeenCalledTimes(1);
    expect(h.cat.lookup(T)).toEqual({ state: "present", range: { offset: 48, length: 500 }, url: `${INFO.baseUrl}/${CELL}.wtpk` });
    expect(h.cat.lookup({ z: 9, x: 600, y: 81 })).toEqual({ state: "absent" }); // même cellule, pas au répertoire
    expect(h.deps.fetchRange).toHaveBeenCalledTimes(1);
    expect(h.deps.onChange).toHaveBeenCalledTimes(1);
  });

  it("cellule absente du catalogue → absent sans fetchRange", async () => {
    const h = harness({});
    expect(h.cat.lookup(T)).toEqual({ state: "pending" });
    await h.catalogOk();
    expect(h.cat.lookup(T)).toEqual({ state: "absent" });
    expect(h.deps.fetchRange).not.toHaveBeenCalled();
  });

  it("échec du répertoire (HF injoignable, 429) → pending, aucun nouvel appel avant 30 s, nouvel essai après (Review Focus 2)", async () => {
    const h = harness();
    h.cat.lookup(T);
    await h.catalogOk();
    h.ranges.shift()!.reject(new Error("HTTP 429"));
    await flush();
    for (let i = 0; i < 10; i++) expect(h.cat.lookup(T)).toEqual({ state: "pending" });
    h.advance(29_999);
    expect(h.cat.lookup(T)).toEqual({ state: "pending" });
    expect(h.deps.fetchRange).toHaveBeenCalledTimes(1);
    h.advance(1);
    expect(h.cat.lookup(T)).toEqual({ state: "pending" });
    expect(h.deps.fetchRange).toHaveBeenCalledTimes(2);
    h.ranges.shift()!.resolve(directory([[9, 600, 80, 48, 500]]));
    await flush();
    expect(h.cat.lookup(T).state).toBe("present");
  });

  it("répertoire illisible = échec (refroidissement)", async () => {
    const h = harness();
    h.cat.lookup(T);
    await h.catalogOk();
    h.ranges.shift()!.resolve(new ArrayBuffer(4));
    await flush();
    expect(h.cat.lookup(T)).toEqual({ state: "pending" });
    expect(h.deps.fetchRange).toHaveBeenCalledTimes(1);
  });

  it("échec du catalogue → pending, refroidissement, nouvel essai après", async () => {
    const h = harness();
    h.cat.lookup(T);
    h.json.shift()!.reject(new Error("offline"));
    await flush();
    expect(h.cat.lookup(T)).toEqual({ state: "pending" });
    h.advance(29_999);
    h.cat.lookup(T);
    expect(h.deps.fetchJson).toHaveBeenCalledTimes(1);
    h.advance(1);
    h.cat.lookup(T);
    expect(h.deps.fetchJson).toHaveBeenCalledTimes(2);
    await h.catalogOk();
    expect(h.deps.fetchRange).toHaveBeenCalledTimes(1);
  });
});
