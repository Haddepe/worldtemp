/** Sélecteur de mode d'une couche (neige : Snowfall | Depth, spec neige §7) : DOM seulement, les
 * modes disponibles viennent de layers/select.ts. Groupe radio comme ui/layers-menu.ts. */
import { STRINGS } from "../i18n";
import type { LayerDef } from "../layers/registry";

export interface ModeSwitch {
  /** Modes à proposer et mode affiché ; `[]` masque le sélecteur. Ne notifie pas. */
  set(modes: readonly LayerDef[], active: string): void;
}

export function createModeSwitch(container: HTMLElement, onPick: (id: string) => void): ModeSwitch {
  container.setAttribute("role", "radiogroup");
  container.setAttribute("aria-label", STRINGS.snowModes.label);
  let ids: string[] = [];
  let buttons: HTMLButtonElement[] = [];
  let active = "";

  // Tabindex roulant sur le mode affiché (le premier si aucun ne l'est).
  const render = () => {
    const focus = ids.includes(active) ? active : ids[0];
    buttons.forEach((b, i) => {
      b.setAttribute("aria-checked", String(ids[i] === active));
      b.tabIndex = ids[i] === focus ? 0 : -1;
    });
  };

  const pick = (i: number, focus: boolean) => {
    const id = ids[i];
    if (id === undefined) return;
    if (focus) buttons[i]!.focus();
    if (id === active) return;
    active = id;
    render();
    onPick(id);
  };

  const button = (d: LayerDef, i: number) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.layer = d.id;
    b.textContent = d.modeLabel ?? d.label;
    b.addEventListener("click", () => pick(i, false));
    b.addEventListener("keydown", (e) => {
      const n = ids.length;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); pick((i + 1) % n, true); }
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); pick((i - 1 + n) % n, true); }
    });
    return b;
  };

  return {
    set(modes, act) {
      const next = modes.map((d) => d.id);
      // Mêmes modes : boutons gardés, sinon `activate` (rappelé après chaque choix) ferait perdre le focus clavier.
      if (next.join("|") !== ids.join("|")) {
        ids = next;
        buttons = modes.map(button);
        container.replaceChildren(...buttons);
      }
      active = act;
      render();
      container.hidden = modes.length === 0;
    },
  };
}
