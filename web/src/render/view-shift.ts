/**
 * Décalage vertical du globe sur mobile (2026-10-03) : centré sur l'écran entier, il paraissait trop
 * bas, l'interface du bas (couches + crédits) étant plus haute que le bandeau du haut. Appliqué par
 * `camera.setViewOffset` (scene.ts) : clics, étiquettes, tuiles et zoom passent tous par la caméra.
 */
const MAX_FRACTION = 0.15;
/** Centre du globe aux 42 % de l'espace libre (50 % paraissait encore trop bas, retour utilisateur 2026-10-03). */
const CENTER_FRACTION = 0.42;

/** px CSS dont remonter l'image (négatif = descendre) pour placer le globe aux 42 % entre `freeTop` et `freeBottom`. */
export function globeShiftPx(viewportH: number, freeTop: number, freeBottom: number): number {
  if (!(viewportH > 0) || !(freeBottom > freeTop)) return 0;
  const shift = Math.round(viewportH / 2 - (freeTop + CENTER_FRACTION * (freeBottom - freeTop)));
  const max = MAX_FRACTION * viewportH;
  return Math.max(-max, Math.min(max, shift));
}
