/**
 * Menu « Share… / Save image » affiché après une capture sur appareil tactile (complément du
 * 2026-10-03 à la spec capture §4.1). Le choix est un geste neuf : la feuille de partage ne dépend
 * plus d'une activation utilisateur consommée pendant la préparation de l'image. Échap ou un
 * toucher hors du menu : aucun choix. Le texte des boutons vit dans index.html.
 */
import type { CaptureChoice } from "../capture/share";

export interface CaptureMenu {
  /** Ouvre le menu ; rend le choix, ou `null` s'il est refermé sans choix. */
  choose(): Promise<CaptureChoice | null>;
}

export function createCaptureMenu(els: { menu: HTMLElement; share: HTMLButtonElement; save: HTMLButtonElement }): CaptureMenu {
  const { menu, share, save } = els;
  return {
    choose() {
      return new Promise((resolve) => {
        const done = (choice: CaptureChoice | null): void => {
          menu.hidden = true;
          share.removeEventListener("click", onShare);
          save.removeEventListener("click", onSave);
          document.removeEventListener("pointerdown", onOutside);
          document.removeEventListener("keydown", onKey);
          resolve(choice);
        };
        const onShare = (): void => done("share");
        const onSave = (): void => done("save");
        const onOutside = (e: Event): void => {
          if (!menu.contains(e.target as Node)) done(null);
        };
        const onKey = (e: KeyboardEvent): void => {
          if (e.key === "Escape") done(null);
        };
        share.addEventListener("click", onShare);
        save.addEventListener("click", onSave);
        document.addEventListener("pointerdown", onOutside);
        document.addEventListener("keydown", onKey);
        menu.hidden = false;
        share.focus();
      });
    },
  };
}
