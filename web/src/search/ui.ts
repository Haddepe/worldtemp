/**
 * Recherche de ville (spec lot F §5.2) : DOM du champ dépliable sous le bandeau. La logique
 * (index, clavier, requêtes périmées) vit dans `index.ts` et `model.ts`, testés sans DOM.
 */
import { STRINGS } from "../i18n";
import { type CitySearch, MIN_CHARS, type SearchResult, resultLabel } from "./index";
import { SearchModel } from "./model";
import { normalizeName } from "./normalize";

export interface SearchUiDeps {
  openButton: HTMLButtonElement;
  panel: HTMLElement;
  input: HTMLInputElement;
  list: HTMLElement;
  message: HTMLElement;
  search: Pick<CitySearch, "query">;
  onChoose(result: SearchResult): void;
  /** Le panneau s'ouvre ou se ferme : les étiquettes doivent l'éviter. */
  onLayoutChange(): void;
}

export function createSearchUi(d: SearchUiDeps): { open(): void; close(): void } {
  const model = new SearchModel();

  // `#search-message` reste toujours rendu (région `role="status"`) : basculer `hidden` ferait
  // manquer l'annonce aux lecteurs d'écran ; seul le texte change (vide = aucune place, CSS).
  const setMessage = (text: string | null): void => {
    d.message.textContent = text ?? "";
  };

  const render = (): void => {
    d.list.replaceChildren(
      ...model.results.map((r, i) => {
        const li = document.createElement("li");
        li.id = `search-option-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(i === model.active));
        li.textContent = resultLabel(r);
        li.addEventListener("mousedown", (e) => e.preventDefault()); // garder le focus dans le champ
        li.addEventListener("click", () => choose(r));
        return li;
      }),
    );
    d.input.setAttribute("aria-expanded", String(model.results.length > 0));
    if (model.active >= 0) d.input.setAttribute("aria-activedescendant", `search-option-${model.active}`);
    else d.input.removeAttribute("aria-activedescendant");
  };

  const runQuery = async (): Promise<void> => {
    const ticket = model.begin();
    let results: SearchResult[] = [];
    let failed = false;
    try {
      results = await d.search.query(d.input.value);
    } catch (e) {
      console.warn("[worldtemp] search unavailable:", e);
      failed = true;
    }
    if (!model.accept(ticket, results)) return;
    render();
    const enough = normalizeName(d.input.value).length >= MIN_CHARS;
    setMessage(failed ? STRINGS.search.unavailable : enough && results.length === 0 ? STRINGS.search.noMatches : null);
  };

  const open = (): void => {
    d.panel.hidden = false;
    d.openButton.setAttribute("aria-expanded", "true");
    d.input.focus();
    d.input.select();
    d.onLayoutChange();
    if (d.input.value !== "") void runQuery(); // la liste a été vidée à la fermeture : la reproposer
  };

  const close = (): void => {
    model.accept(model.begin(), []); // périme toute requête en vol
    render();
    setMessage(null);
    d.panel.hidden = true;
    d.openButton.setAttribute("aria-expanded", "false");
    d.onLayoutChange();
  };

  const choose = (r: SearchResult): void => {
    close();
    d.openButton.focus(); // le champ masqué ne doit pas garder le focus : on le rend au bouton
    d.onChoose(r);
  };

  d.openButton.addEventListener("click", () => (d.panel.hidden ? open() : close()));

  d.input.addEventListener("input", () => void runQuery());

  d.input.addEventListener("keydown", (e) => {
    const action = model.key(e.key);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      render();
    } else if (action.type === "choose") {
      e.preventDefault();
      choose(action.result);
    } else if (action.type === "close") {
      e.preventDefault();
      close();
      d.openButton.focus();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (document.querySelector("dialog[open]")) return; // panneau About ouvert
    e.preventDefault();
    open();
  });

  return { open, close };
}
