/**
 * `labels/layer.ts` (C1) : Vitest tourne sans DOM (ni jsdom, ni happy-dom) — faux DOM minimal
 * écrit ici, sans dépendance externe. Ne couvre que ce que `layer.ts` touche réellement :
 * `document.createElement`, `className`, `classList.add/remove/contains`, `textContent`,
 * `style.transform`, `append`, `requestAnimationFrame`, `setTimeout`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLabelsLayer } from "../src/labels/layer";

interface FakeElement {
  className: string;
  textContent: string;
  style: { transform: string };
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
  append(...children: unknown[]): void;
}

function fakeElement(): FakeElement {
  const classes = new Set<string>();
  return {
    className: "",
    textContent: "",
    style: { transform: "" },
    classList: {
      add: (c) => void classes.add(c),
      remove: (c) => void classes.delete(c),
      contains: (c) => classes.has(c),
    },
    append: () => {},
  };
}

/** Installe un `document.createElement` et un `requestAnimationFrame` minimaux en globals,
 * et journalise les éléments créés par tag pour pouvoir relire leur `textContent` ensuite
 * (pas d'accès direct aux entrées internes de `layer.ts`). */
function installFakeDom() {
  const divs: FakeElement[] = [];
  const spans: FakeElement[] = [];
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      const el = fakeElement();
      if (tag === "div") divs.push(el);
      else if (tag === "span") spans.push(el);
      return el;
    },
  });
  // Non piloté : ce test ne vérifie pas le fondu d'entrée (classe « on »), seulement le texte.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  const container = fakeElement();
  return { container: container as unknown as HTMLElement, divs, spans };
}

describe("labels/layer (C1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("un div recyclé ne garde pas la valeur de l'étiquette précédente", () => {
    const { container, divs, spans } = installFakeDom();
    const layer = createLabelsLayer(container);

    layer.render([{ id: 1, kind: "city", name: "Paris", value: "23.4 °C", x: 0, y: 0 }]);
    layer.render([]); // retire Paris : le div part en fondu puis rejoint la réserve
    vi.advanceTimersByTime(250); // FADE_MS (150) + marge (50) : l'entrée est bien repassée au pool

    layer.render([{ id: 2, kind: "country", name: "France", value: null, x: 0, y: 0 }]);

    expect(divs.length).toBe(1); // réutilisé : un seul div créé pour les deux étiquettes
    expect(spans[0]!.textContent).toBe("France"); // span nom, réutilisé
    expect(spans[1]!.textContent).toBe(""); // span valeur, réutilisé : ne garde pas « 23.4 °C »
  });

  it("une valeur qui change entre deux render du même id est bien réécrite", () => {
    const { container, spans } = installFakeDom();
    const layer = createLabelsLayer(container);

    layer.render([{ id: 1, kind: "city", name: "Paris", value: "10.0 °C", x: 0, y: 0 }]);
    expect(spans[1]!.textContent).toBe("10.0 °C");
    layer.render([{ id: 1, kind: "city", name: "Paris", value: "12.0 °C", x: 0, y: 0 }]);
    expect(spans[1]!.textContent).toBe("12.0 °C");
  });
});
