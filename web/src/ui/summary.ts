import { SITE, pagePath, type PageDef } from "../pages/registry";
import { renderMoreBody } from "../build/pages";

/**
 * Résumé refermable de la page courante + panneau « Read more » (lot G, spec §5).
 * Le HTML initial (index.html / pages générées) porte déjà le contenu indexable ; ici seulement
 * le remplacement lors d'une navigation interne et la mémoire du choix « masqué ».
 */
export const SUMMARY_KEY = "globelayers.summaryHidden";

/** Lève ou stockage absent : le résumé reste visible. */
export function summaryHidden(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(SUMMARY_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mémorise (ou efface) le choix ; une erreur de stockage est ignorée. */
export function setSummaryHidden(storage: Pick<Storage, "setItem" | "removeItem"> | null, hidden: boolean): void {
  try {
    if (hidden) storage?.setItem(SUMMARY_KEY, "1");
    else storage?.removeItem(SUMMARY_KEY);
  } catch {
    /* sans stockage, le choix dure le temps de la session (état en mémoire) */
  }
}

export interface Summary {
  /** Affiche le résumé de `page` ; `notice` s'ajoute au texte (ex. reduced-motion). */
  show(page: PageDef, notice: string | null): void;
  /** Ré-affiche le résumé et efface la mémoire du choix. */
  reveal(): void;
  /** `cb` est appelé à chaque affichage/masquage (recalcul du décalage du globe sur mobile). */
  onLayout(cb: () => void): void;
}

export function createSummary(storage: Storage | null): Summary {
  const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const box = byId<HTMLElement>("summary");
  const title = byId<HTMLElement>("summary-title");
  const text = byId<HTMLElement>("summary-text");
  const moreOpen = byId<HTMLButtonElement>("more-open");
  const close = byId<HTMLButtonElement>("summary-close");
  const more = byId<HTMLDialogElement>("more");
  const moreClose = byId<HTMLButtonElement>("more-close");
  const moreBody = byId<HTMLElement>("more-body");
  let hidden = summaryHidden(storage); // repli mémoire si le stockage échoue
  let layout: (() => void) | null = null;

  const apply = (): void => {
    box.hidden = hidden;
    layout?.();
  };

  moreOpen.addEventListener("click", () => {
    if (!more.open) more.showModal();
  });
  moreClose.addEventListener("click", () => more.close());
  more.addEventListener("click", (e) => {
    if (e.target === more) more.close();
  });
  close.addEventListener("click", () => {
    hidden = true;
    setSummaryHidden(storage, true);
    apply();
  });

  const setMeta = (selector: string, attr: string, value: string): void => {
    document.querySelector(selector)?.setAttribute(attr, value);
  };

  apply();
  return {
    show(page, notice) {
      title.textContent = page.h1;
      text.textContent = notice ? `${page.summary} ${notice}` : page.summary;
      moreBody.innerHTML = renderMoreBody(page);
      more.setAttribute("aria-labelledby", "more-title");
      document.title = page.title;
      setMeta('meta[name="description"]', "content", page.description);
      setMeta('link[rel="canonical"]', "href", SITE + pagePath(page));
      apply();
    },
    reveal() {
      hidden = false;
      setSummaryHidden(storage, false);
      apply();
    },
    onLayout(cb) {
      layout = cb;
    },
  };
}
