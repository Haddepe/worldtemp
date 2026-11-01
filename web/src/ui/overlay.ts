import type { Encoding } from "../data/encoding";
import { STRINGS } from "../i18n";
import type { LayerDef } from "../layers/registry";
import { legendStopsCss, stopsCss } from "../render/colormap";
import { forestLegend, legendName, legendTicks } from "./format";

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
  /** Conteneur du sélecteur de mode (ui/modes.ts), dans le panneau de la légende. */
  layerModes: HTMLElement;
  /** `note` : mention après l'unité (« since Sat 3 09:00 » pour les chutes de neige). */
  setLegend(def: LayerDef, enc: Encoding, stats: { min: number; max: number }, note?: string): void;
  /** Légende Forest : deux barres (couvert, pertes), horizontales sur ordinateur, verticales côte à côte sur mobile. */
  setForestLegend(def: LayerDef): void;
  setLegendVisible(on: boolean): void;
  /** Crédit Hansen/UMD (CC BY 4.0) dans `#attribution`, tant que Forest est active. */
  setForestCredit(on: boolean): void;
  showFatal(text: string, options?: { reload?: boolean }): void;
}

/** Texte inséré dans `innerHTML` : jamais de balisage, même si une chaîne en contenait. */
function escapeHtml(t: string): string {
  return t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * Corps de la légende Forest : une `.part` par barre, chacune avec les classes de la légende d'une
 * couche météo (`.title`, `.bar` + `--stops`, `.ticks`) ; titre long (`.name`) sur ordinateur, court
 * (`.short`) sous la barre verticale du téléphone.
 */
export function forestLegendHtml(def: LayerDef): string {
  return forestLegend(def)
    .map((p) => {
      const ticks = p.ticks.map((t) => `<span class="tick" style="--pct:${t.pct.toFixed(2)}">${escapeHtml(t.label)}</span>`).join("");
      return (
        `<div class="part"><div class="title"><span class="name">${escapeHtml(p.title)}</span><span class="short">${escapeHtml(p.short)}</span></div>` +
        `<div class="bar" style="--stops:${stopsCss(p.stops)}"></div><div class="ticks">${ticks}</div></div>`
      );
    })
    .join("");
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
  const legendBody = byId<HTMLElement>("legend-body");
  const forestCredit = byId<HTMLElement>("attribution-forest");
  const layerModes = byId<HTMLElement>("layer-modes");
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
    layerModes,
    windToggle,
    labelsToggle,
    riversToggle,
    labels,
    panelRects() {
      const rects: { x0: number; y0: number; x1: number; y1: number }[] = [];
      // #layer-modes, #legend .note : hors du cadre de la légende sur mobile (sous et au-dessus d'elle).
      for (const el of overlay.querySelectorAll<HTMLElement>(".panel, #attribution, #layer-modes, #legend .note")) {
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
    setLegend(def, enc, stats, note) {
      const ticks = legendTicks(def, enc)
        .map((t) => `<span class="tick" style="--pct:${t.pct.toFixed(2)}">${t.label}</span>`)
        .join("");
      const iso = def.isoStep !== null ? ` · ${STRINGS.legend.isolines} ${def.isoStep} ${def.unit}` : "";
      // Séparateur à part : sur mobile la note quitte le titre (au-dessus de la légende verticale).
      const extra = note ? `<span class="note-sep"> · </span><span class="note">${note}</span>` : "";
      // Le corps seul est réécrit : le sélecteur de mode (#layer-modes), frère du corps, garde ses boutons et le focus.
      legendBody.innerHTML =
        // Orientation choisie par le CSS (`--stops`, `--pct`) : horizontale, ou verticale sur mobile.
        `<div class="title"><span class="name">${legendName(def)} · </span><span class="unit">${def.unit}</span>${extra}<span class="iso">${iso}</span></div>` +
        `<div class="bar" style="--stops:${legendStopsCss(def, enc)}"></div>` +
        `<div class="ticks">${ticks}</div>` +
        `<div class="extremes"><span>${STRINGS.legend.min} ${def.format(stats.min)}</span><span>${STRINGS.legend.max} ${def.format(stats.max)}</span></div>`;
    },
    setForestLegend(def) {
      legendBody.innerHTML = forestLegendHtml(def);
    },
    setLegendVisible(on) {
      legend.hidden = !on;
    },
    setForestCredit(on) {
      forestCredit.hidden = !on;
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
