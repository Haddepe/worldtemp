/**
 * Étiquettes en DOM (spec repères §4) : un `div` par étiquette, réutilisé d'une sélection à
 * l'autre, positionné par `transform`. Aucune logique de choix ici — voir labels/select.ts.
 * Pas de test (Vitest tourne sans DOM) : validé à l'œil.
 */
export interface LabelView {
  id: number;
  kind: "city" | "country";
  name: string;
  value: string | null;
  x: number;
  y: number;
}

export interface LabelsLayer {
  /** Affiche exactement `views` : crée, met à jour, fait disparaître le reste en fondu. */
  render(views: LabelView[]): void;
  clear(): void;
  /** Variante sombre (F5) : texte foncé à halo clair, lisible en style carte sans couche. */
  setDark(dark: boolean): void;
}

const FADE_MS = 150;

interface Entry { el: HTMLDivElement; name: HTMLSpanElement; value: HTMLSpanElement; text: string }

export function createLabelsLayer(container: HTMLElement): LabelsLayer {
  const live = new Map<number, Entry>();
  const pool: Entry[] = [];
  let dark = false;

  const make = (): Entry => {
    const el = document.createElement("div");
    const name = document.createElement("span");
    const value = document.createElement("span");
    name.className = "name";
    value.className = "value";
    el.append(name, value);
    container.append(el);
    return { el, name, value, text: "" };
  };

  const retire = (e: Entry): void => {
    e.el.classList.remove("on");
    // Une entrée retirée n'est plus référencée que par ce timeout : elle ne peut pas être
    // remise au pool deux fois, ni y être pendant qu'elle est encore `live` — push sans garde.
    setTimeout(() => pool.push(e), FADE_MS + 50);
  };

  return {
    render(views) {
      const keep = new Set<number>();
      for (const v of views) {
        keep.add(v.id);
        let e = live.get(v.id);
        if (!e) {
          e = pool.pop() ?? make();
          e.el.className = `label ${v.kind}`;
          e.name.textContent = v.name;
          // Un `div` recyclé garde le `textContent` de l'étiquette précédente si on ne le vide
          // pas explicitement : le témoin `text` seul ne suffit pas à le refléter (C1).
          e.text = "";
          e.value.textContent = "";
          live.set(v.id, e);
          const entry = e;
          const id = v.id;
          // Frame suivante : la transition d'opacité joue. Garde nécessaire si l'entrée a été
          // créée puis retirée dans la même frame (ex. clear() ou une resélection synchrone
          // avant que ce callback ne s'exécute) : sans elle, `on` réapparaîtrait sur un `div`
          // déjà rendu au pool ou réutilisé pour une autre étiquette.
          requestAnimationFrame(() => {
            if (live.get(id) === entry) entry.el.classList.add("on");
          });
        }
        const text = v.value ?? "";
        if (e.text !== text) {
          e.text = text;
          e.value.textContent = text;
        }
        e.el.style.transform = `translate3d(${Math.round(v.x)}px, ${Math.round(v.y)}px, 0)`;
      }
      for (const [id, e] of live) {
        if (keep.has(id)) continue;
        live.delete(id);
        retire(e);
      }
    },
    clear() {
      for (const e of live.values()) retire(e);
      live.clear();
    },
    setDark(next) {
      if (next === dark) return;
      dark = next;
      container.classList.toggle("dark", dark);
    },
  };
}
