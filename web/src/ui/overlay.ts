import { STOPS, legendGradientCss } from "../render/colormap";
import { legendTicks } from "./format";

export interface Overlay {
  setBanner(text: string): void;
  /** `null` masque le statut. */
  setStatus(text: string | null): void;
  setLegend(minC: number, maxC: number, stats: { min_c: number; max_c: number }): void;
  onOpacity(cb: (opacity: number) => void): void;
  initialOpacity(): number;
  showFatal(text: string, options?: { reload?: boolean }): void;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`élément #${id} introuvable`);
  return el as T;
}

export function createOverlay(): Overlay {
  const bannerText = byId<HTMLElement>("banner-text");
  const status = byId<HTMLElement>("status");
  const legend = byId<HTMLElement>("legend");
  const opacity = byId<HTMLInputElement>("opacity");
  const fatal = byId<HTMLElement>("fatal");
  const overlay = byId<HTMLElement>("overlay");
  const toggle = byId<HTMLButtonElement>("toggle-overlay");

  toggle.addEventListener("click", () => {
    const collapsed = overlay.classList.toggle("collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
  });

  return {
    setBanner(text) {
      bannerText.textContent = text;
    },
    setStatus(text) {
      status.hidden = text === null;
      status.textContent = text ?? "";
    },
    setLegend(minC, maxC, stats) {
      const ticks = legendTicks(minC, maxC)
        .map((t) => `<span class="tick" style="left:${t.pct.toFixed(2)}%">${t.c}</span>`)
        .join("");
      legend.innerHTML =
        `<div class="bar" style="background:${legendGradientCss(STOPS, minC, maxC)}"></div>` +
        `<div class="ticks">${ticks}</div>` +
        `<div class="extremes"><span>min ${stats.min_c.toFixed(1)} °C</span><span>max ${stats.max_c.toFixed(1)} °C</span></div>`;
    },
    onOpacity(cb) {
      opacity.addEventListener("input", () => cb(Number(opacity.value)));
    },
    initialOpacity() {
      return Number(opacity.value);
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
