/**
 * Frise temporelle (spec lot E §7.1) : DOM seulement. L'état (instant, live/fixed, lecture) vit
 * dans `time/cursor.ts` ; `main.ts` appelle `render` à chaque changement (à chaque image pendant
 * la lecture : aucune écriture DOM quand rien n'a changé). Validée dans le navigateur (Vitest sans DOM).
 */
import { STRINGS } from "../i18n";
import { HOUR_MS, snapToHour } from "../time/timeline";
import { timelineLabel } from "./format";

export interface TimelineEls {
  root: HTMLElement;
  play: HTMLButtonElement;
  range: HTMLInputElement;
  label: HTMLElement;
  now: HTMLButtonElement;
}

export interface TimelineHandlers {
  /** Curseur déplacé : instant absolu (ms UTC) choisi, à l'heure pleine. */
  seek(t: number): void;
  toggle(): void;
  goLive(): void;
  /** Premier contact avec la frise (spec lot E §5.4) : préchargement des échéances. */
  interact(): void;
}

export interface TimelineRender {
  t: number;
  start: number;
  end: number;
  playing: boolean;
  live: boolean;
  nowMs: number;
  timeZone?: string;
}

export interface TimelineView {
  render(s: TimelineRender): void;
  setVisible(on: boolean): void;
}

export function createTimeline(els: TimelineEls, on: TimelineHandlers): TimelineView {
  let start = 0;
  let last = "";
  els.range.addEventListener("input", () => on.seek(start + Number(els.range.value) * HOUR_MS));
  els.play.addEventListener("click", () => on.toggle());
  els.now.addEventListener("click", () => on.goLive());
  for (const type of ["pointerdown", "keydown", "focusin"] as const) {
    els.root.addEventListener(type, () => on.interact(), { passive: true });
  }
  return {
    render(s) {
      start = s.start;
      // En lecture, le libellé avance par heure pleine (sinon les minutes défilent à chaque image).
      const shown = s.live ? s.t : snapToHour(s.t);
      const label = timelineLabel(shown, s.nowMs, s.live, s.timeZone);
      const max = String(Math.round((s.end - s.start) / HOUR_MS));
      const value = String(Math.round((s.t - s.start) / HOUR_MS));
      const signature = `${label}|${max}|${value}|${s.playing}|${s.live}`;
      if (signature === last) return;
      last = signature;
      els.label.textContent = label;
      els.range.max = max;
      if (els.range.value !== value) els.range.value = value;
      els.range.setAttribute("aria-valuetext", label);
      els.play.textContent = s.playing ? "⏸" : "▶";
      els.play.setAttribute("aria-label", s.playing ? STRINGS.timeline.pause : STRINGS.timeline.play);
      els.now.hidden = s.live;
    },
    setVisible(visible) {
      els.root.hidden = !visible;
    },
  };
}
