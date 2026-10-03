/**
 * Tooltip de la couche active : une « lecture » = un point ancré sur le globe,
 * projetée à chaque rendu. Entrée souris (hover) ou tap (pin) ; même code de rendu.
 */
import * as THREE from "three";
import { sampleSource, type ValueSource } from "../data/sampling";
import type { LayerDef } from "../layers/registry";
import { projectToScreen } from "../render/pick";
import { lonLatToVec3 } from "../tiles/patch";
import { sampleUV, type WindField } from "../wind/sim";
import { formatReading, formatWind } from "./format";
import { byId } from "./overlay";

export interface Reading {
  lon: number;
  lat: number;
  /** Nom du lieu (recherche), affiché au-dessus des valeurs. */
  name?: string;
  /** Origine d'une épingle : « ma position » n'apparaît jamais dans une capture (spec capture §2). */
  origin?: "user" | "city" | "locate";
}

/** Couche affichée à l'instant du curseur (spec lot E §6.2). */
export interface TooltipData extends ValueSource {
  def: LayerDef;
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

/** Texte du tooltip : nom du lieu (s'il y en a un) puis une valeur par ligne ; `null` = rien à montrer. */
export function tooltipText(name: string | undefined, values: readonly string[]): string | null {
  const lines = name ? [name, ...values] : [...values];
  return lines.length ? lines.join("\n") : null;
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
  /** Champ de vent actif (spec vent §10) ; `null` retire la ligne « Vent … ». */
  setWind(field: WindField | null): void;
  /** Reprojection après un rendu ou un déplacement de la souris. */
  update(camera: THREE.PerspectiveCamera, width: number, height: number): void;
  /** Vrai si (x, y) est à moins de `radiusPx` du marqueur affiché (mode pin). */
  hitMarker(x: number, y: number, radiusPx?: number): boolean;
  /** Vrai si une lecture est épinglée (mode pin, lecture non nulle). */
  isPinned(): boolean;
  /** Épingle visible pour la capture (px CSS) ; `null` si rien d'épinglé, hors écran ou « ma position ». */
  pinned(): { x: number; y: number; text: string | null } | null;
}

/**
 * Souris sur le canvas (relecture finale lot F, F2) : le survol n'écrase pas une lecture épinglée
 * (arrivée d'un vol) ; un clic lève l'épingle et le survol reprend. Renvoie vrai si la lecture a changé.
 */
export function mouseInput(
  t: Pick<Tooltip, "isPinned" | "setReading">,
  type: "move" | "leave" | "down",
  read: () => Reading | null,
): boolean {
  if (type === "down") {
    if (!t.isPinned()) return false;
    t.setReading(null, "hover");
    return true;
  }
  if (t.isPinned()) return false;
  t.setReading(type === "move" ? read() : null, "hover");
  return true;
}

const MARKER_HALF = 6;

/** `els` : éléments injectables pour les tests (Vitest tourne sans DOM). */
export function createTooltip(els?: { tip: HTMLElement; marker: HTMLElement }): Tooltip {
  const tip = els?.tip ?? byId<HTMLElement>("tooltip");
  const marker = els?.marker ?? byId<HTMLElement>("marker");
  let reading: Reading | null = null;
  let mode: "hover" | "pin" = "hover";
  let data: TooltipData | null = null;
  let wind: WindField | null = null;
  const point = new THREE.Vector3();
  const windSample = { u: 0, v: 0 };
  let markerScreen: { x: number; y: number } | null = null;

  const hide = () => {
    tip.hidden = true;
    marker.hidden = true;
    markerScreen = null;
  };

  const refreshText = () => {
    if (!reading) return;
    const values: string[] = [];
    if (data) values.push(formatReading(data.def, sampleSource(data, reading.lon, reading.lat)));
    if (wind) {
      sampleUV(wind, reading.lon, reading.lat, windSample);
      values.push(formatWind(windSample.u, windSample.v));
    }
    const text = tooltipText(reading.name, values);
    if (text !== null) tip.textContent = text;
  };

  return {
    setReading(r, m) {
      reading = r;
      mode = m;
      tip.setAttribute("aria-live", m === "pin" ? "polite" : "off"); // hover ne doit pas annoncer à chaque mouvement de souris
      if (r) lonLatToVec3(r.lon, r.lat, point);
      else hide();
      refreshText();
    },
    setData(d) {
      // ignore un tampon incohérent : sinon noUncheckedIndexedAccess dans sampleValue retombe silencieusement sur min
      const n = d ? d.grid.width * d.grid.height : 0;
      data = d && d.a.length === n && (d.b === null || d.b.length === n) ? d : null;
      refreshText();
    },
    setWind(f) {
      // même garde que setData : un tampon incohérent ferait retomber sampleUV sur NaN
      wind = f && f.uv.length === f.grid.width * f.grid.height * 2 ? f : null;
      refreshText();
    },
    update(camera, width, height) {
      // Épinglé, le marqueur s'affiche même sans rien à écrire (📍 sans couche : on voit où l'on
      // est arrivé) ; la bulle, elle, reste masquée tant qu'elle n'a pas de texte.
      const hasText = reading !== null && (data !== null || wind !== null || !!reading.name);
      if (!reading || (!hasText && mode !== "pin")) {
        hide();
        return;
      }
      const s = projectToScreen(point, camera, width, height);
      if (!s.visible) {
        hide();
        return;
      }
      tip.hidden = !hasText;
      if (hasText) {
        const { left, top } = placeTooltip({ x: s.x, y: s.y }, { w: tip.offsetWidth, h: tip.offsetHeight }, { w: width, h: height });
        tip.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
      }
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
    isPinned() {
      return mode === "pin" && reading !== null;
    },
    pinned() {
      if (mode !== "pin" || !reading || !markerScreen || reading.origin === "locate") return null;
      return { x: markerScreen.x, y: markerScreen.y, text: tip.hidden ? null : tip.textContent };
    },
  };
}
