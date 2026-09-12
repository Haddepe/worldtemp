import type { Encoding } from "../data/encoding";
import type { LayerDef } from "../layers/registry";
import { legendGradientCss } from "../render/colormap";
import { legendTicks } from "./format";

export interface Overlay {
  /** Conteneur du menu des couches (ui/layers-menu.ts). */
  controls: HTMLElement;
  setBanner(text: string): void;
  /** `null` masque le statut. */
  setStatus(text: string | null): void;
  setLegend(def: LayerDef, enc: Encoding, stats: { min: number; max: number }): void;
  setLegendVisible(on: boolean): void;
  showFatal(text: string, options?: { reload?: boolean }): void;
}

export function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`élément #${id} introuvable`);
  return el as T;
}

export function createOverlay(): Overlay {
  const bannerText = byId<HTMLElement>("banner-text");
  const status = byId<HTMLElement>("status");
  const legend = byId<HTMLElement>("legend");
  const controls = byId<HTMLElement>("controls");
  const fatal = byId<HTMLElement>("fatal");
  const overlay = byId<HTMLElement>("overlay");
  const toggle = byId<HTMLButtonElement>("toggle-overlay");

  toggle.addEventListener("click", () => {
    const collapsed = overlay.classList.toggle("collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
  });

  return {
    controls,
    setBanner(text) {
      bannerText.textContent = text;
    },
    setStatus(text) {
      status.hidden = text === null;
      status.textContent = text ?? "";
    },
    setLegend(def, enc, stats) {
      const ticks = legendTicks(def, enc)
        .map((t) => `<span class="tick" style="left:${t.pct.toFixed(2)}%">${t.label}</span>`)
        .join("");
      const iso = def.isoStep !== null ? ` · isolignes ${def.isoStep} ${def.unit}` : "";
      legend.innerHTML =
        `<div class="title">${def.label} · ${def.unit}${iso}</div>` +
        `<div class="bar" style="background:${legendGradientCss(def, enc)}"></div>` +
        `<div class="ticks">${ticks}</div>` +
        `<div class="extremes"><span>min ${def.format(stats.min)}</span><span>max ${def.format(stats.max)}</span></div>`;
    },
    setLegendVisible(on) {
      legend.hidden = !on;
    },
    showFatal(text, options) {
      fatal.textContent = text;
      if (options?.reload) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Recharger";
        button.addEventListener("click", () => location.reload());
        fatal.appendChild(button);
      }
      fatal.hidden = false;
      overlay.hidden = true;
    },
  };
}
