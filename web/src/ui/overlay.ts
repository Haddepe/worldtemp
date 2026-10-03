import type { Encoding } from "../data/encoding";
import { STRINGS } from "../i18n";
import type { LayerDef } from "../layers/registry";
import { legendStopsCss } from "../render/colormap";
import { legendTicks } from "./format";

export interface Overlay {
  /** Conteneur du menu radio des couches (ui/layers-menu.ts). */
  layersMenu: HTMLElement;
  /** Bouton role="switch" du vent (ui/toggle.ts). */
  windToggle: HTMLButtonElement;
  labelsToggle: HTMLButtonElement;
  riversToggle: HTMLButtonElement;
  labels: HTMLElement;
  /** Rectangles (px CSS, repère du viewport) des panneaux visibles : les étiquettes les évitent. */
  panelRects(): { x0: number; y0: number; x1: number; y1: number }[];
  /** Appelé quand les panneaux sont repliés ou déployés. */
  onLayoutChange(cb: () => void): void;
  /** Un panneau a changé de taille hors du bouton de repli (champ de recherche). */
  notifyLayout(): void;
  setBanner(text: string): void;
  /** `null` masque le statut. */
  setStatus(text: string | null): void;
  setLegend(def: LayerDef, enc: Encoding, stats: { min: number; max: number }): void;
  setLegendVisible(on: boolean): void;
  showFatal(text: string, options?: { reload?: boolean }): void;
}

export function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`element #${id} not found`);
  return el as T;
}

export function createOverlay(): Overlay {
  const bannerText = byId<HTMLElement>("banner-text");
  const status = byId<HTMLElement>("status");
  const legend = byId<HTMLElement>("legend");
  const layersMenu = byId<HTMLElement>("layers-menu");
  const windToggle = byId<HTMLButtonElement>("wind-toggle");
  const labelsToggle = byId<HTMLButtonElement>("labels-toggle");
  const riversToggle = byId<HTMLButtonElement>("rivers-toggle");
  const labels = byId<HTMLElement>("labels");
  const fatal = byId<HTMLElement>("fatal");
  const overlay = byId<HTMLElement>("overlay");
  const toggle = byId<HTMLButtonElement>("toggle-overlay");

  const layoutListeners: (() => void)[] = [];
  toggle.addEventListener("click", () => {
    const collapsed = overlay.classList.toggle("collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    for (const cb of layoutListeners) cb();
  });

  return {
    layersMenu,
    windToggle,
    labelsToggle,
    riversToggle,
    labels,
    panelRects() {
      const rects: { x0: number; y0: number; x1: number; y1: number }[] = [];
      for (const el of overlay.querySelectorAll<HTMLElement>(".panel, #attribution")) {
        const r = el.getBoundingClientRect(); // masqué (`hidden`, replié) = rectangle vide
        if (r.width > 0 && r.height > 0) rects.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
      }
      return rects;
    },
    onLayoutChange(cb) {
      layoutListeners.push(cb);
    },
    notifyLayout() {
      for (const cb of layoutListeners) cb();
    },
    setBanner(text) {
      if (bannerText.textContent !== text) bannerText.textContent = text; // appelé à chaque image pendant la lecture
    },
    setStatus(text) {
      const hidden = text === null;
      if (status.hidden !== hidden) status.hidden = hidden;
      if (status.textContent !== (text ?? "")) status.textContent = text ?? "";
    },
    setLegend(def, enc, stats) {
      const ticks = legendTicks(def, enc)
        .map((t) => `<span class="tick" style="--pct:${t.pct.toFixed(2)}">${t.label}</span>`)
        .join("");
      const iso = def.isoStep !== null ? ` · ${STRINGS.legend.isolines} ${def.isoStep} ${def.unit}` : "";
      legend.innerHTML =
        // Orientation choisie par le CSS (`--stops`, `--pct`) : horizontale, ou verticale sur mobile.
        `<div class="title"><span class="name">${def.label} · </span><span class="unit">${def.unit}</span><span class="iso">${iso}</span></div>` +
        `<div class="bar" style="--stops:${legendStopsCss(def, enc)}"></div>` +
        `<div class="ticks">${ticks}</div>` +
        `<div class="extremes"><span>${STRINGS.legend.min} ${def.format(stats.min)}</span><span>${STRINGS.legend.max} ${def.format(stats.max)}</span></div>`;
    },
    setLegendVisible(on) {
      legend.hidden = !on;
    },
    showFatal(text, options) {
      fatal.textContent = text;
      if (options?.reload) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = STRINGS.fatal.reload;
        button.addEventListener("click", () => location.reload());
        fatal.appendChild(button);
      }
      fatal.hidden = false;
      overlay.hidden = true;
    },
  };
}
