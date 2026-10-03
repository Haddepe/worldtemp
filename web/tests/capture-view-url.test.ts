import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewGuard } from "../src/capture/privacy";
import { SETTLE_MS, attachViewUrl } from "../src/capture/view-url";
import { lonLatToVec3 } from "../src/tiles/patch";

function harness(guard = new ViewGuard(), busy = () => false) {
  const camera = { position: lonLatToVec3(0, 0).multiplyScalar(3) };
  let view: () => void = () => {};
  let interact: () => void = () => {};
  let search = "?layer=dust";
  const replace = vi.fn((s: string) => void (search = s));
  attachViewUrl({ camera, onViewChange: (cb) => void (view = cb), onInteraction: (cb) => void (interact = cb), busy, guard, search: () => search, replace });
  const moveTo = (lon: number, lat: number, d: number) => {
    camera.position.copy(lonLatToVec3(lon, lat, new THREE.Vector3()).multiplyScalar(d));
    view();
  };
  return { replace, moveTo, interact: () => interact(), frame: () => view(), guard };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("attachViewUrl — vue écrite au repos de la caméra (spec capture §4.3)", () => {
  it("rien sans geste de l'utilisateur (chargement, setInitialView)", () => {
    const h = harness();
    h.moveTo(10, 20, 2);
    vi.advanceTimersByTime(5 * SETTLE_MS);
    expect(h.replace).not.toHaveBeenCalled();
  });
  it("après un geste : écrit 400 ms après le dernier mouvement, pas avant", () => {
    const h = harness();
    h.interact();
    h.moveTo(5, 5, 2.5);
    vi.advanceTimersByTime(SETTLE_MS - 100);
    h.moveTo(10, 20, 2);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(h.replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.replace).toHaveBeenCalledTimes(1);
    expect(h.replace).toHaveBeenCalledWith("?layer=dust&lon=10.00&lat=20.00&d=2.000");
  });
  it("rendus sans mouvement (vent animé) : aucun minuteur, aucune écriture", () => {
    const h = harness();
    h.interact();
    for (let i = 0; i < 10; i++) h.frame();
    vi.advanceTimersByTime(5 * SETTLE_MS);
    expect(h.replace).not.toHaveBeenCalled();
  });
  it("près de « ma position » : rien n'est écrit", () => {
    const guard = new ViewGuard();
    guard.located(10, 20);
    const h = harness(guard);
    h.interact();
    h.moveTo(11, 20, 1.3);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.replace).not.toHaveBeenCalled();
    h.moveTo(30, 20, 1.3);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.replace).toHaveBeenCalledWith("?layer=dust&lon=30.00&lat=20.00&d=1.300");
  });
  it("pendant un vol (images bloquées ≥ 400 ms) : rien, et la garde n'est pas levée", () => {
    const guard = new ViewGuard();
    guard.located(0, 0);
    let flying = true;
    const h = harness(guard, () => flying);
    h.interact();
    h.moveTo(20, 0, 2); // point intermédiaire du vol, à plus de 5° de « ma position »
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.replace).not.toHaveBeenCalled();
    flying = false;
    h.moveTo(0.5, 0, 1.3); // arrivée près de « ma position »
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.replace).not.toHaveBeenCalled();
  });
});
