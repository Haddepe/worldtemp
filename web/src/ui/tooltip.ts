/**
 * Tooltip de température (spec navigation §6) : une « lecture » = un point ancré sur le globe,
 * projetée à chaque rendu. Entrée souris (hover) ou tap (pin) ; même code de rendu.
 */
import * as THREE from "three";
import type { Encoding, Grid } from "../data/metadata";
import { sampleTemperature } from "../data/sampling";
import { projectToScreen } from "../render/pick";
import { lonLatToVec3 } from "../tiles/patch";
import { formatTemperature } from "./format";
import { byId } from "./overlay";

export interface Reading {
  lon: number;
  lat: number;
}

export interface TooltipData {
  pixels: Uint8ClampedArray;
  grid: Pick<Grid, "width" | "height">;
  encoding: Pick<Encoding, "min_c" | "max_c">;
}

export type TapInput = { type: "down" | "move" | "up" | "cancel"; id: number; x: number; y: number; t: number };

/** Tap = un seul pointeur, < 8 px de déplacement, < 300 ms, aucun second doigt pendant le geste. */
export class TapDetector {
  private start: { id: number; x: number; y: number; t: number } | null = null;
  private spoiled = false;
  private down = 0;

  constructor(
    private readonly maxMovePx = 8,
    private readonly maxMs = 300,
  ) {}

  /** Renvoie la position du `down` quand un `up` conclut un tap valide, sinon `null`. */
  feed(e: TapInput): { x: number; y: number } | null {
    switch (e.type) {
      case "down":
        this.down++;
        if (this.down === 1) {
          this.start = { id: e.id, x: e.x, y: e.y, t: e.t };
          this.spoiled = false;
        } else {
          this.spoiled = true;
        }
        return null;
      case "move":
        if (this.start && e.id === this.start.id && Math.hypot(e.x - this.start.x, e.y - this.start.y) > this.maxMovePx) {
          this.spoiled = true;
        }
        return null;
      case "up": {
        this.down = Math.max(0, this.down - 1);
        const s = this.start;
        if (!s || e.id !== s.id) return null;
        const ok = !this.spoiled && e.t - s.t < this.maxMs;
        this.start = null;
        if (this.down === 0) this.spoiled = false;
        return ok ? { x: s.x, y: s.y } : null;
      }
      case "cancel":
        this.reset();
        return null;
    }
  }

  reset(): void {
    this.start = null;
    this.spoiled = false;
    this.down = 0;
  }
}

/** Position du coin haut-gauche du tooltip : centré, au-dessus du point (en dessous près du bord haut). */
export function placeTooltip(
  point: { x: number; y: number },
  tip: { w: number; h: number },
  viewport: { w: number; h: number },
  offset = 14,
  topGuard = 48,
): { left: number; top: number } {
  const margin = 4;
  const left = Math.max(margin, Math.min(viewport.w - tip.w - margin, point.x - tip.w / 2));
  const top = point.y < topGuard ? point.y + offset : point.y - offset - tip.h;
  return { left, top };
}

export interface Tooltip {
  setReading(r: Reading | null, mode: "hover" | "pin"): void;
  setData(d: TooltipData | null): void;
  /** Reprojection après un rendu ou un déplacement de la souris. */
  update(camera: THREE.PerspectiveCamera, width: number, height: number): void;
  /** Vrai si (x, y) est à moins de `radiusPx` du marqueur affiché (mode pin). */
  hitMarker(x: number, y: number, radiusPx?: number): boolean;
}

const MARKER_HALF = 6;

export function createTooltip(): Tooltip {
  const tip = byId<HTMLElement>("tooltip");
  const marker = byId<HTMLElement>("marker");
  let reading: Reading | null = null;
  let mode: "hover" | "pin" = "hover";
  let data: TooltipData | null = null;
  const point = new THREE.Vector3();
  let markerScreen: { x: number; y: number } | null = null;

  const hide = () => {
    tip.hidden = true;
    marker.hidden = true;
    markerScreen = null;
  };

  const refreshText = () => {
    if (!reading || !data) return;
    tip.textContent = formatTemperature(sampleTemperature(data.pixels, data.grid, data.encoding, reading.lon, reading.lat));
  };

  return {
    setReading(r, m) {
      reading = r;
      mode = m;
      if (r) lonLatToVec3(r.lon, r.lat, point);
      else hide();
      refreshText();
    },
    setData(d) {
      data = d;
      refreshText();
    },
    update(camera, width, height) {
      if (!reading || !data) {
        hide();
        return;
      }
      const s = projectToScreen(point, camera, width, height);
      if (!s.visible) {
        hide();
        return;
      }
      tip.hidden = false;
      const { left, top } = placeTooltip({ x: s.x, y: s.y }, { w: tip.offsetWidth, h: tip.offsetHeight }, { w: width, h: height });
      tip.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
      if (mode === "pin") {
        marker.hidden = false;
        marker.style.transform = `translate(${(s.x - MARKER_HALF).toFixed(1)}px, ${(s.y - MARKER_HALF).toFixed(1)}px)`;
        markerScreen = { x: s.x, y: s.y };
      } else {
        marker.hidden = true;
        markerScreen = null;
      }
    },
    hitMarker(x, y, radiusPx = 24) {
      return markerScreen !== null && Math.hypot(x - markerScreen.x, y - markerScreen.y) < radiusPx;
    },
  };
}
