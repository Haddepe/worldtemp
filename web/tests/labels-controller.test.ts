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
  const deferred: (() => void)[] = [];
  const ctl = new LabelsController({
    layer: { render: (v) => void frames.push(v.map((x) => ({ ...x }))), clear: () => void frames.push([]) },
    camera, size: () => ({ width: 800, height: 800 }), tier: "high",
    now: () => t, defer: (cb) => void deferred.push(cb),
  });
  return { ctl, camera, look, frames, deferred, advance: (ms: number) => { t += ms; }, last: () => frames[frames.length - 1]! };
}

const SET = buildLabelSet(
  [{ lon: 2.35, lat: 48.86, name: "Paris", pop: 11e6, capital: true }, { lon: 4.84, lat: 45.77, name: "Lyon", pop: 1.7e6, capital: false },
   { lon: 139.69, lat: 35.69, name: "Tokyo", pop: 37e6, capital: true }],
  [],
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
    r.deferred[0]!();
    expect(r.last().map((v) => v.name)).toEqual(["Tokyo"]);
  });
  it("éteint : vide la couche", () => {
    const r = rig();
    r.ctl.setData(SET);
    r.ctl.setEnabled(true);
    r.ctl.setEnabled(false);
    expect(r.last()).toEqual([]);
  });
});
