/**
 * Zoom maison sur l'altitude a = d − 1 (spec navigation §4). OrbitControls garde la rotation
 * (`enableZoom = false`) et relit `camera.position` à chaque `update()`.
 */

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
