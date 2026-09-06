/**
 * Zoom maison sur l'altitude a = d − 1 (spec navigation §4). OrbitControls garde la rotation
 * (`enableZoom = false`) et relit `camera.position` à chaque `update()`.
 */
import * as THREE from "three";
import { ndcFromCanvas, pickSphere, projectToScreen } from "../render/pick";

export const WHEEL_BASE = 0.885;
const WHEEL_MAX_PX = 300;

/** `deltaY` d'un WheelEvent en pixels, borné à ±300 (trackpads inertiels). */
export function normalizeWheel(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.max(-WHEEL_MAX_PX, Math.min(WHEEL_MAX_PX, px));
}

function clamp(a: number, aMin: number, aMax: number): number {
  return Math.min(aMax, Math.max(aMin, a));
}

/** Altitude après un cran de molette : deltaPx < 0 rapproche (convention OrbitControls). */
export function nextAltitude(a: number, deltaPx: number, aMin: number, aMax: number): number {
  return clamp(a * Math.pow(WHEEL_BASE, -deltaPx / 100), aMin, aMax);
}

/** Altitude pendant un pincement : doubler l'écart des doigts divise l'altitude par deux. */
export function pinchAltitude(a0: number, dist0: number, dist: number, aMin: number, aMax: number): number {
  if (dist <= 0 || dist0 <= 0) return a0;
  return clamp((a0 * dist0) / dist, aMin, aMax);
}

interface PointerPos {
  x: number;
  y: number;
}

/** Suivi des pointeurs tactiles : le pincement porte sur les deux premiers arrivés. */
export class PinchTracker {
  private readonly pointers = new Map<number, PointerPos>();

  down(id: number, x: number, y: number): void {
    this.pointers.set(id, { x, y });
  }

  move(id: number, x: number, y: number): void {
    const p = this.pointers.get(id);
    if (p) {
      p.x = x;
      p.y = y;
    }
  }

  up(id: number): void {
    this.pointers.delete(id);
  }

  reset(): void {
    this.pointers.clear();
  }

  /** Clé des deux premiers pointeurs (ordre d'insertion), `null` si moins de deux. */
  pair(): string | null {
    if (this.pointers.size < 2) return null;
    const [a, b] = this.pointers.keys();
    return `${a}:${b}`;
  }

  pinch(): { dist: number; mid: PointerPos } | null {
    if (this.pointers.size < 2) return null;
    const [a, b] = this.pointers.values();
    if (!a || !b) return null;
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
}

export interface Anchor {
  /** Point de la sphère unité (unitaire) saisi sous le curseur ou entre les doigts. */
  point: THREE.Vector3;
  /** Position visée, px CSS depuis le coin haut-gauche du canvas. */
  screen: { x: number; y: number };
}

const ANCHOR_EPS_PX = 0.1;
const p2 = new THREE.Vector3();
const q = new THREE.Quaternion();

/**
 * Tourne la caméra autour de l'origine pour ramener `anchor.point` sous `anchor.screen`.
 * Convergence linéaire (`lookAt` annule le roulis) : jusqu'à `maxIterations`, arrêt sous 0,1 px.
 * Renvoie l'erreur résiduelle en px, `Infinity` si l'ancre est sortie du globe.
 */
export function anchorRotate(
  camera: THREE.PerspectiveCamera,
  anchor: Anchor,
  width: number,
  height: number,
  maxIterations = 4,
): number {
  const ndc = ndcFromCanvas(anchor.screen.x, anchor.screen.y, width, height);
  let err = Number.POSITIVE_INFINITY;
  for (let i = 0; i < maxIterations; i++) {
    if (!pickSphere(ndc.x, ndc.y, camera, p2)) return Number.POSITIVE_INFINITY;
    q.setFromUnitVectors(p2.normalize(), anchor.point);
    camera.position.applyQuaternion(q);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const s = projectToScreen(anchor.point, camera, width, height);
    err = Math.hypot(s.x - anchor.screen.x, s.y - anchor.screen.y);
    if (err < ANCHOR_EPS_PX) break;
  }
  return err;
}

export interface ZoomControl {
  /** À appeler par la boucle de rendu avant `controls.update()`. Renvoie true si la caméra a bougé. */
  beforeUpdate(): boolean;
  dispose(): void;
}

export interface ZoomOptions {
  requestRender(): void;
  aMin: number;
  aMax: number;
  /** Appelé au début (`true`) et à la fin (`false`) d'un pincement à deux doigts. */
  onPinch?(active: boolean): void;
}

const SMOOTHING = 0.25;
const CONVERGENCE = 1e-4;

export function attachZoom(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, opts: ZoomOptions): ZoomControl {
  let wheelActive = false;
  let aTarget = 0;
  let pinchA: number | null = null;
  let anchor: Anchor | null = null;
  let anchorMoved = false;
  const pinch = new PinchTracker();
  let pinchBase: { a0: number; dist0: number; key: string } | null = null;

  const altitude = () => camera.position.length() - 1;

  const canvasPoint = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top, w: r.width, h: r.height };
  };

  const anchorAt = (x: number, y: number, w: number, h: number): Anchor | null => {
    const ndc = ndcFromCanvas(x, y, w, h);
    const p = pickSphere(ndc.x, ndc.y, camera);
    return p ? { point: p.normalize(), screen: { x, y } } : null;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (pinchBase) return; // un pincement est en cours : ignorer la molette (trackpad + pincement simultanés)
    const base = wheelActive ? aTarget : altitude();
    aTarget = nextAltitude(base, normalizeWheel(e.deltaY, e.deltaMode), opts.aMin, opts.aMax);
    wheelActive = true;
    const c = canvasPoint(e.clientX, e.clientY);
    anchor = anchorAt(c.x, c.y, c.w, c.h);
    opts.requestRender();
  };

  /** Début ou fin de geste quand la paire de doigts change. */
  const syncPinch = () => {
    const key = pinch.pair();
    if (key === (pinchBase?.key ?? null)) return;
    if (key) {
      const g = pinch.pinch()!;
      const r = canvas.getBoundingClientRect();
      pinchBase = { a0: altitude(), dist0: g.dist, key };
      anchor = anchorAt(g.mid.x - r.left, g.mid.y - r.top, r.width, r.height);
      wheelActive = false;
      opts.onPinch?.(true);
    } else {
      pinchBase = null;
      anchor = null;
      pinchA = null;
      anchorMoved = false;
      opts.onPinch?.(false);
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    pinch.down(e.pointerId, e.clientX, e.clientY);
    syncPinch();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    pinch.move(e.pointerId, e.clientX, e.clientY);
    const g = pinch.pinch();
    if (!pinchBase || !g || pinch.pair() !== pinchBase.key) return;
    pinchA = pinchAltitude(pinchBase.a0, pinchBase.dist0, g.dist, opts.aMin, opts.aMax);
    if (anchor) {
      const r = canvas.getBoundingClientRect();
      anchor.screen = { x: g.mid.x - r.left, y: g.mid.y - r.top };
      anchorMoved = true;
    }
    opts.requestRender();
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    pinch.up(e.pointerId);
    syncPinch();
  };
  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    pinch.up(e.pointerId); // n'oublier que le pointeur annulé, pas les deux doigts
    syncPinch();
  };

  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);

  return {
    beforeUpdate() {
      const a = altitude();
      let aNew = a;
      if (pinchA !== null) {
        aNew = pinchA;
        pinchA = null;
      } else if (wheelActive) {
        aNew = a + (aTarget - a) * SMOOTHING;
        if (Math.abs(aTarget - aNew) < CONVERGENCE * aNew) {
          aNew = aTarget;
          wheelActive = false;
        } else {
          opts.requestRender();
        }
      }
      let moved = false;
      if (aNew !== a) {
        camera.position.setLength(1 + aNew);
        camera.updateMatrixWorld(true);
        moved = true;
      }
      if (anchor && (moved || anchorMoved)) {
        const r = canvas.getBoundingClientRect();
        anchorRotate(camera, anchor, r.width, r.height);
        anchorMoved = false;
        moved = true;
      }
      if (!wheelActive && !pinchBase) anchor = null;
      return moved;
    },
    dispose() {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
    },
  };
}
