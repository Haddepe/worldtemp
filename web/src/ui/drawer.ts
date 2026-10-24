import { pagePath, PAGES, type PageDef } from "../pages/registry";
import { pageForPath } from "../pages/route";
import { renderDrawerNav } from "../build/pages";

/** Clic gauche sans modificateur, lien interne vers une page connue. */
export function shouldIntercept(
  e: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
  href: string,
  origin: string,
): boolean {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false;
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  // pageForPath renvoie l'accueil pour un chemin inconnu : on exige que le chemin normalisé coïncide.
  const page = pageForPath(url.pathname);
  return PAGES.includes(page) && pagePath(page) === (url.pathname.endsWith("/") ? url.pathname : url.pathname + "/");
}

export interface Drawer { setCurrent(page: PageDef): void }

/** Tiroir de navigation (lot G, spec §5) : `<dialog>` modal ; Échap et focus fournis par le navigateur. */
export function createDrawer(opts: { navigate: (page: PageDef) => void; openAbout: () => void; revealSummary: () => void }): Drawer {
  const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const dialog = byId<HTMLDialogElement>("drawer");
  const nav = byId<HTMLElement>("drawer-nav");
  const home = PAGES[0]!;

  byId("drawer-open").addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
  });
  byId("drawer-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  const go = (e: MouseEvent, a: HTMLAnchorElement, then?: () => void): void => {
    if (!shouldIntercept(e, a.getAttribute("href") ?? "", location.origin)) return;
    e.preventDefault();
    then?.();
    opts.navigate(pageForPath(new URL(a.href, location.origin).pathname));
    dialog.close();
  };
  nav.addEventListener("click", (e) => {
    const a = (e.target as Element).closest("a");
    if (a) go(e, a as HTMLAnchorElement);
  });
  byId("drawer-home").addEventListener("click", (e) => go(e, e.currentTarget as HTMLAnchorElement));
  byId("drawer-howto").addEventListener("click", (e) => {
    if (!shouldIntercept(e, "/", location.origin)) return;
    e.preventDefault();
    opts.revealSummary();
    opts.navigate(home);
    dialog.close();
  });
  byId("drawer-about").addEventListener("click", () => {
    dialog.close();
    opts.openAbout();
  });

  return {
    setCurrent(page) {
      nav.innerHTML = renderDrawerNav(page);
    },
  };
}
