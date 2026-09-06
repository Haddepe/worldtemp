import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PinchTracker, WHEEL_BASE, anchorRotate, nextAltitude, normalizeWheel, pinchAltitude, type Anchor } from "../src/controls/zoom";
import { pickSphere, projectToScreen } from "../src/render/pick";

const A_MIN = 0.042;
const A_MAX = 3;

describe("normalizeWheel", () => {
  it("pixels tels quels, lignes × 16, pages × 400", () => {
    expect(normalizeWheel(100, 0)).toBe(100);
    expect(normalizeWheel(3, 1)).toBe(48);
    expect(normalizeWheel(0.5, 2)).toBe(200);
    expect(normalizeWheel(1, 2)).toBe(300); // 400 px, borné
  });
  it("borne à ±300", () => {
    expect(normalizeWheel(5000, 0)).toBe(300);
    expect(normalizeWheel(-5000, 0)).toBe(-300);
  });
});

describe("nextAltitude", () => {
  it("deltaY < 0 rapproche d'un facteur WHEEL_BASE par cran de 100", () => {
    expect(nextAltitude(1, -100, A_MIN, A_MAX)).toBeCloseTo(WHEEL_BASE, 12);
    expect(nextAltitude(1, 100, A_MIN, A_MAX)).toBeCloseTo(1 / WHEEL_BASE, 12);
  });
  it("35 ± 1 crans de A_MAX à A_MIN", () => {
    let a = A_MAX;
    let n = 0;
    while (a > A_MIN) {
      a = nextAltitude(a, -100, A_MIN, A_MAX);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(34);
    expect(n).toBeLessThanOrEqual(36);
  });
  it("respecte les bornes", () => {
    expect(nextAltitude(A_MIN, -100, A_MIN, A_MAX)).toBe(A_MIN);
    expect(nextAltitude(A_MAX, 100, A_MIN, A_MAX)).toBe(A_MAX);
  });
});

describe("pinchAltitude", () => {
  it("écart doublé → altitude divisée par deux", () => {
    expect(pinchAltitude(1, 100, 200, A_MIN, A_MAX)).toBeCloseTo(0.5, 12);
    expect(pinchAltitude(1, 200, 100, A_MIN, A_MAX)).toBeCloseTo(2, 12);
  });
  it("bornes et écart nul", () => {
    expect(pinchAltitude(0.05, 100, 10000, A_MIN, A_MAX)).toBe(A_MIN);
    expect(pinchAltitude(2, 100, 1, A_MIN, A_MAX)).toBe(A_MAX);
    expect(pinchAltitude(1, 100, 0, A_MIN, A_MAX)).toBe(1);
  });
});

describe("PinchTracker", () => {
  it("pas de pincement à un doigt, pincement au second, clé stable", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    expect(t.pair()).toBeNull();
    expect(t.pinch()).toBeNull();
    t.down(2, 30, 40);
    expect(t.pair()).toBe("1:2");
    expect(t.pinch()).toEqual({ dist: 50, mid: { x: 15, y: 20 } });
  });
  it("move met à jour distance et milieu", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 30, 40);
    t.move(2, 60, 80);
    expect(t.pinch()).toEqual({ dist: 100, mid: { x: 30, y: 40 } });
  });
  it("troisième doigt ignoré ; retrait de l'un des deux premiers → nouvelle paire", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 30, 40);
    t.down(3, 500, 500);
    expect(t.pair()).toBe("1:2");
    t.up(2);
    expect(t.pair()).toBe("1:3");
    t.up(1);
    expect(t.pair()).toBeNull();
  });
  it("reset vide tout", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 1, 1);
    t.reset();
    expect(t.pair()).toBeNull();
  });
  it("move d'un pointeur inconnu est ignoré", () => {
    const t = new PinchTracker();
    t.move(9, 1, 1);
    expect(t.pair()).toBeNull();
  });
});

const W = 1000;
const H = 800;

function cameraAt(position: THREE.Vector3): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, W / H, 0.01, 10);
  cam.position.copy(position);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** Point de la sphère à `angleDeg` du centre de l'écran, en diagonale (exerce le roulis). */
function anchorAt(angleDeg: number, cam: THREE.PerspectiveCamera): Anchor {
  const s = Math.sin((angleDeg * Math.PI) / 180);
  const point = new THREE.Vector3(s * Math.SQRT1_2, s * Math.SQRT1_2, Math.cos((angleDeg * Math.PI) / 180)).normalize();
  const { x, y } = projectToScreen(point, cam, W, H);
  return { point, screen: { x, y } };
}

function zoomTo(cam: THREE.PerspectiveCamera, a: number): void {
  cam.position.setLength(1 + a);
  cam.updateMatrixWorld(true);
}

describe("anchorRotate", () => {
  it("point à 30° du centre, zoom de a = 2 à 0,3 : reprojeté à < 0,5 px", () => {
    const cam = cameraAt(new THREE.Vector3(0, 0, 3));
    const anchor = anchorAt(30, cam);
    zoomTo(cam, 0.3);
    const err = anchorRotate(cam, anchor, W, H);
    const s = projectToScreen(anchor.point, cam, W, H);
    expect(Math.hypot(s.x - anchor.screen.x, s.y - anchor.screen.y)).toBeLessThan(0.5);
    expect(err).toBeLessThan(0.5);
  });
  it("limbe (80°) : < 0,5 px en 4 itérations", () => {
    const cam = cameraAt(new THREE.Vector3(0, 0, 3));
    const anchor = anchorAt(80, cam);
    zoomTo(cam, 0.3);
    anchorRotate(cam, anchor, W, H);
    const s = projectToScreen(anchor.point, cam, W, H);
    expect(Math.hypot(s.x - anchor.screen.x, s.y - anchor.screen.y)).toBeLessThan(0.5);
  });
  it("la caméra reste à la même distance et regarde l'origine", () => {
    const cam = cameraAt(new THREE.Vector3(0, 0, 3));
    const anchor = anchorAt(30, cam);
    zoomTo(cam, 0.3);
    anchorRotate(cam, anchor, W, H);
    expect(cam.position.length()).toBeCloseTo(1.3, 9);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    expect(forward.dot(cam.position.clone().normalize())).toBeCloseTo(-1, 9);
  });
  it("ancre sortie du globe (zoom arrière) : rotation sautée, erreur Infinity", () => {
    const cam = cameraAt(new THREE.Vector3(0, 0, 3));
    const anchor = anchorAt(45, cam);
    zoomTo(cam, 2.5); // le point visé n'est plus sous le curseur : le rayon manque la sphère
    const before = cam.position.clone();
    expect(pickSphere((anchor.screen.x / W) * 2 - 1, 1 - (anchor.screen.y / H) * 2, cam)).toBeNull();
    expect(anchorRotate(cam, anchor, W, H)).toBe(Number.POSITIVE_INFINITY);
    expect(cam.position.distanceTo(before)).toBe(0);
  });
  it("reprise d'ancre stable : deux zooms successifs avec la même ancre ne dérivent pas", () => {
    const cam = cameraAt(new THREE.Vector3(0, 0, 3));
    const anchor = anchorAt(30, cam);
    zoomTo(cam, 1.5);
    anchorRotate(cam, anchor, W, H);
    zoomTo(cam, 0.3);
    anchorRotate(cam, anchor, W, H);
    const s = projectToScreen(anchor.point, cam, W, H);
    expect(Math.hypot(s.x - anchor.screen.x, s.y - anchor.screen.y)).toBeLessThan(0.05);
  });
});
