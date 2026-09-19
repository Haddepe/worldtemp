/**
 * Panneau « About » (spec site public §5) : `<dialog>` natif ouvert en modal — piège à focus,
 * Échap et retour du focus au bouton sont fournis par le navigateur. Le contenu vit dans
 * `index.html` (HTML initial, indexable) ; ici, seulement l'ouverture et la fermeture.
 */
export function createAbout(dialog: HTMLDialogElement, openButton: HTMLButtonElement, closeButton: HTMLButtonElement): void {
  openButton.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
  });
  closeButton.addEventListener("click", () => dialog.close());
  // Le contenu est enveloppé dans un <div> : une cible égale au dialog = clic sur le fond.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
}
