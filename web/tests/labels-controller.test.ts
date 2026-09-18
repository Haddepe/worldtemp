import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { LabelsController, SELECT_INTERVAL_MS } from "../src/labels/controller";
import { buildLabelSet } from "../src/labels/data";
import type { LabelView } from "../src/labels/layer";
import { layerDef } from "../src/layers/registry";
import { lonLatToVec3 } from "../src/tiles/patch";
import type { TooltipData } from "../src/ui/tooltip";

function rig(d = 1.3) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10);
  const look = (lon: number, lat: number, dist: number) => {
    camera.position.copy(lonLatToVec3(lon, lat).multiplyScalar(dist));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
  };
  look(2, 47, d);
  const frames: LabelView[][] = [];
  let t = 0;
  const deferred: { cb: () => void; ms: number }[] = [];
  const ctl = new LabelsController({
    layer: { render: (v) => void frames.push(v.map((x) => ({ ...x }))), clear: () => void frames.push([]) },
    camera, size: () => ({ width: 800, height: 800 }), tier: "high",
    now: () => t, defer: (cb, ms) => void deferred.push({ cb, ms }),
  });
  return { ctl, camera, look, frames, deferred, advance: (ms: number) => { t += ms; }, last: () => frames[frames.length - 1]! };
}

const SET = buildLabelSet(
  [{ lon: 2.35, lat: 48.86, name: "Paris", pop: 11e6, capital: true }, { lon: 4.84, lat: 45.77, name: "Lyon", pop: 1.7e6, capital: false },
   { lon: 139.69, lat: 35.69, name: "Tokyo", pop: 37e6, capital: true }],
  [],
);

const SET_WITH_COUNTRY = buildLabelSet(
  [{ lon: 2.35, lat: 48.86, name: "Paris", pop: 11e6, capital: true }, { lon: 4.84, lat: 45.77, name: "Lyon", pop: 1.7e6, capital: false }],
  [{ lon: 2.55, lat: 46.7, name: "France", rank: 2 }],
);

function temp(byte: number): TooltipData {
  const pixels = new Uint8ClampedArray(2 * 2 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels[i] = byte;
  return { def: layerDef("temp")!, pixels, grid: { width: 2, height: 2 }, encoding: { bits: 8, min: -50, max: 50, scale: "linear" } };
}

describe("LabelsController (spec repères §4)", () => {
  it("rien tant qu'il est éteint ou sans données", () => {
    const r = rig();
    r.ctl.onView();
    r.ctl.setData(SET);
    r.ctl.onView();
    expect(r.frames).toEqual([]);
  });
  it("allumé : affiche les villes visibles, pas celles de l'autre face", () => {
    const r = rig();
    r.ctl.setData(SET);
    r.ctl.setEnabled(true);
    expect(r.last().map((v) => v.name).sort()).toEqual(["Lyon", "Paris"]);
    expect(r.last().every((v) => v.value === null)).toBe(true);
    const paris = r.last().find((v) => v.name === "Paris")!;
    expect(paris.x).toBeGreaterThan(0);
    expect(paris.x).toBeLessThan(800);
  });
  it("valeur de la couche active, retirée quand la couche part", () => {
    const r = rig();
    r.ctl.setData(SET);
    r.ctl.setEnabled(true);
    r.ctl.setValueSource(temp(255));
    expect(r.last().find((v) => v.name === "Paris")!.value).toBe("50,0 °C");
    r.ctl.setValueSource(null);
    expect(r.last().find((v) => v.name === "Paris")!.value).toBeNull();
  });
  it("caméra en mouvement : repositionne à chaque vue, ne re-sélectionne qu'après 100 ms", () => {
    const r = rig();
    r.ctl.setData(SET);
    r.ctl.setEnabled(true);
    const x0 = r.last().find((v) => v.name === "Paris")!.x;
    r.look(40, 47, 1.3); // Paris sort de l'écran par la gauche ; re-sélection pas encore due
    r.advance(10);
    r.ctl.onView();
    const moved = r.last().find((v) => v.name === "Paris");
    expect(moved === undefined || moved.x !== x0).toBe(true);
    r.look(139, 36, 1.3);
    r.advance(SELECT_INTERVAL_MS);
    r.ctl.onView();
    expect(r.last().map((v) => v.name)).toEqual(["Tokyo"]);
  });
  it("sélection de rattrapage après l'arrêt de la caméra, sans nouvelle vue", () => {
    const r = rig();
    r.ctl.setData(SET);
    r.ctl.setEnabled(true);
    r.look(139, 36, 1.3);
    r.advance(10);
    r.ctl.onView();            // trop tôt pour re-sélectionner : un rattrapage est programmé
    expect(r.deferred.length).toBe(1);
    r.advance(SELECT_INTERVAL_MS);
    r.deferred[0]!.cb();
    expect(r.last().map((v) => v.name)).toEqual(["Tokyo"]);
  });
  it("un rattrapage périmé ne re-sélectionne pas moins de 100 ms après une sélection naturelle", () => {
    const r = rig();
    r.ctl.setData(SET);
    r.ctl.setEnabled(true);              // t=0 : sélection initiale, lastSelect=0
    r.look(40, 47, 1.3);                 // Paris sort de l'écran par la gauche
    r.advance(10);
    r.ctl.onView();                      // t=10 : pas encore dû, rattrapage armé (deviendra périmé)
    expect(r.deferred.length).toBe(1);
    r.look(3, 47, 1.3);                  // toujours proche de Paris/Lyon, jamais Tokyo
    r.advance(SELECT_INTERVAL_MS);       // t=110
    r.ctl.onView();                      // sélection naturelle (>= 100 ms depuis t=0)
    const afterNatural = r.last().map((v) => v.name);
    expect(afterNatural).not.toEqual(["Tokyo"]);
    r.look(139, 36, 1.3);                // vise Tokyo, mais sans passer par onView()
    r.advance(4);                        // t=114 : le rattrapage armé à t=10 est maintenant périmé
    const framesBefore = r.frames.length;
    r.deferred[0]!.cb();
    // Une sélection naturelle a déjà eu lieu à t=110 : re-sélectionner à t=114 violerait la
    // cadence de 100 ms. Le rattrapage périmé ne doit ni re-sélectionner ni repeindre ; il se
    // réarme pour le temps restant avant la prochaine échéance.
    expect(r.last().map((v) => v.name)).toEqual(afterNatural);
    expect(r.frames.length).toBe(framesBefore);
    expect(r.deferred.length).toBe(2);
    const rearmed = r.deferred[1]!;
    expect(rearmed.ms).toBeGreaterThan(0);
    expect(rearmed.ms).toBeLessThanOrEqual(SELECT_INTERVAL_MS);
    r.advance(rearmed.ms);               // t=210 : désormais dû
    rearmed.cb();
    expect(r.last().map((v) => v.name)).toEqual(["Tokyo"]);
  });
  it("un pays n'a jamais de valeur", () => {
    const r = rig();
    r.ctl.setData(SET_WITH_COUNTRY);
    r.ctl.setEnabled(true);
    r.ctl.setValueSource(temp(255));
    const france = r.last().find((v) => v.name === "France");
    expect(france).toBeDefined();
    expect(france!.value).toBeNull();
    expect(r.last().some((v) => v.kind === "city" && v.value !== null)).toBe(true);
  });
  it("éteint : vide la couche", () => {
    const r = rig();
    r.ctl.setData(SET);
    r.ctl.setEnabled(true);
    r.ctl.setEnabled(false);
    expect(r.last()).toEqual([]);
  });
});
