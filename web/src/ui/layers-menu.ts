/** Menu radio des couches (spec couches §12) : DOM seulement, l'ordre et la disponibilité viennent de layers/select.ts. */
import type { LayerDef } from "../layers/registry";

export interface LayersMenu {
  setLayers(defs: readonly LayerDef[]): void;
  setActive(id: string | null): void;
  setDisabled(id: string, disabled: boolean): void;
}

const NONE = "none";

export function createLayersMenu(container: HTMLElement, onChange: (id: string | null) => void): LayersMenu {
  container.setAttribute("role", "radiogroup");
  container.setAttribute("aria-label", "Couche");
  const buttons = new Map<string, HTMLButtonElement>();
  let active: string | null = null;

  const idOf = (key: string) => (key === NONE ? null : key);

  const render = () => {
    for (const [key, b] of buttons) {
      const on = key === (active ?? NONE);
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };

  const select = (key: string, focus: boolean) => {
    const b = buttons.get(key);
    if (!b || b.disabled) return;
    active = idOf(key);
    render();
    if (focus) b.focus();
    onChange(active);
  };

  const move = (from: string, delta: number) => {
    const keys = [...buttons.keys()].filter((k) => !buttons.get(k)!.disabled);
    const i = keys.indexOf(from);
    if (i < 0 || keys.length === 0) return;
    select(keys[(i + delta + keys.length) % keys.length]!, true);
  };

  const button = (key: string, label: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.layer = key;
    b.textContent = label;
    b.addEventListener("click", () => select(key, false));
    b.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); move(key, 1); }
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); move(key, -1); }
    });
    return b;
  };

  return {
    setLayers(defs) {
      container.replaceChildren();
      buttons.clear();
      const none = button(NONE, "Aucune");
      buttons.set(NONE, none);
      container.appendChild(none);
      for (const d of defs) {
        const b = button(d.id, d.label);
        buttons.set(d.id, b);
        container.appendChild(b);
      }
      if (active !== null && !buttons.has(active)) active = null;
      render();
    },
    setActive(id) {
      active = id;
      render();
    },
    setDisabled(id, disabled) {
      const b = buttons.get(id);
      if (!b) return;
      b.disabled = disabled;
      b.title = disabled ? "Indisponible" : "";
    },
  };
}
