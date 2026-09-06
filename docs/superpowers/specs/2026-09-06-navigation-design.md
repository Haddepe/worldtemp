# Spec — Navigation : zoom vers le curseur, pincement, tooltip, fondu

**Date :** 2026-09-06 · **Statut :** validée en brainstorming, à planifier
**Périmètre :** sous-projet 4, lot A « confort de navigation ». Front seul, aucun
changement de pipeline ni de tuiles. Les couches multiples (vent, nuages…, lot B)
et les étiquettes villes/pays (lot C) restent au backlog.

## 1. Objectif

Quatre défauts constatés sur https://globelayers.com après la spec 3 :

1. **Zoom non ancré** : la molette zoome vers le centre de l'écran, il faut recadrer
   après chaque cran. `zoomToCursor` d'OrbitControls a été écarté en spec 3 car il
   déplace la cible et casse la garde d'altitude (`near`/`far`, `rotateSpeed`).
2. **Pincement trop sensible sur téléphone** (dette n° 23 §8 de HISTORY). Cause
   structurelle : OrbitControls multiplie la **distance au centre** `d`
   (`radius *= scale`), pas l'altitude `a = d − 1`. À `d = 1,1`, un pincement de
   10 % double l'altitude ; à `d = 4`, il ne fait presque rien. Même défaut à la
   molette : les derniers 15 % de `d` contiennent 80 % du trajet visuel.
3. **Aucune lecture de valeur** : la couleur seule renseigne, à ±3 °C près.
4. **Fondu satellite → carte trop mou** : plage linéaire `d` ∈ [1,25 ; 1,12], le style
   carte semble arriver à contrecœur.

Cible : comportement Google Maps pour le zoom (le lieu sous le curseur ou entre les
doigts reste en place, sensation uniforme du globe entier au « zoom Normandie »),
un tooltip de température au survol (souris) ou au tap (tactile), un fondu plus
franc.

## 2. Approche retenue

**Dolly maison, OrbitControls conserve la rotation.** `controls.enableZoom = false`.
Un module `web/src/controls/zoom.ts` écoute molette et pincement, pose
`camera.position` directement (comme `setInitialView` aujourd'hui) ; OrbitControls
relit la position à chaque `update()` et garde rotation, inertie et bornes de
distance. **La cible reste à l'origine** : la garde d'altitude de la spec 3 est
intacte.

Écarté : fork d'OrbitControls (1 900 lignes à maintenir pour 30 lignes changées) ;
contrôles maison complets (réécrit la rotation qui fonctionne).

## 3. Picking (`web/src/render/pick.ts`)

Fondation partagée par le zoom et le tooltip. Fonctions pures, sans état :

- `pickSphere(ndcX, ndcY, camera, target?) → Vector3 | null` : rayon caméra
  (`camera.matrixWorld`, `projectionMatrixInverse`) → intersection analytique avec la
  **sphère unité** centrée à l'origine, la plus proche de la caméra. `null` si le
  rayon manque le globe. Pas de raycast sur les meshes : indépendant des patches
  chargés, des jupes et de `frustumCulled = false`.
- `vec3ToLonLat(p) → { lon, lat }` : inverse exact de `tiles/patch.ts::lonLatToVec3`
  (convention SphereGeometry : lon −180 en −x, lon −90 en +z, nord en +y) ;
  `lon` ∈ [−180 ; 180[, `lat` ∈ [−90 ; 90].
- `projectToScreen(p, camera, width, height) → { x, y, visible }` : coordonnées CSS
  px depuis le coin haut-gauche du canvas ; `visible` = devant l'horizon
  (`dot(p̂, ĉ) > 1 / d`, même test que `tiles/lod.ts::isBeyondHorizon`, avec `p̂`
  unitaire donc rayon 0) **et** dans le viewport.

Les coordonnées NDC viennent du canvas (`getBoundingClientRect`), pas de la fenêtre :
l'overlay ne couvre pas le canvas en `pointer-events`, mais ses panneaux si.

## 4. Zoom (`web/src/controls/zoom.ts`)

### État et courbe

- État : altitude courante `a = d − 1`, altitude cible `aTarget`, ancre optionnelle.
  Bornes `[A_MIN ; A_MAX] = [MIN_DISTANCE − 1 ; MAX_DISTANCE − 1] = [0,042 ; 3]`,
  importées de `scene.ts`.
- **Molette** : `aTarget *= WHEEL_BASE ^ (−deltaY / 100)` avec `WHEEL_BASE = 0,885`
  (`deltaY < 0` = rapprochement, convention OrbitControls).
  Trajet complet `A_MAX → A_MIN` = `ln(3 / 0,042) / ln(1 / 0,885)` ≈ **35 crans** de
  100 unités, comme aujourd'hui, mais répartis uniformément en altitude.
  `deltaMode` normalisé : `DOM_DELTA_LINE` × 16, `DOM_DELTA_PAGE` × 400
  (fonction pure `normalizeWheel(event) → px`). `deltaY` borné à ±300 par événement
  (trackpads inertiels).
- **Pincement** : `a = a₀ · (dist₀ / dist)` où `dist` est l'écart des deux doigts en
  px CSS et `a₀`, `dist₀` ses valeurs au début du geste. Doubler l'écart divise
  l'altitude par deux. **Sans lissage** : appliqué immédiatement, verrouillé aux
  doigts. Borné aux mêmes limites.
- Le lissage de la molette se fait dans un hook `beforeUpdate` appelé par la boucle
  de `scene.ts` avant `controls.update()` : `a += (aTarget − a) · 0,25` par frame,
  convergence déclarée sous `|aTarget − a| < 1e-4 · a` (alors `a = aTarget`, ancre
  relâchée). Le module appelle `requestRender()` tant que non convergé : le rendu à
  la demande de la spec 2 est préservé.

### Ancre

Une ancre = `{ point: Vector3 (unitaire, sur la sphère), screen: { x, y } }`.

- Molette : à **chaque** événement, `pickSphere` sous le curseur → nouvelle ancre
  (le curseur peut bouger entre deux crans). Curseur hors globe → ancre `null` :
  zoom vers le centre sans rotation.
- Pincement : ancre prise **au début du geste** sous le milieu des doigts ; `screen`
  mis à jour à chaque `pointermove` avec le milieu courant. Résultat : le lieu saisi
  suit les doigts, ce qui donne le déplacement à deux doigts sans code
  supplémentaire. Milieu hors globe au départ → ancre `null`.
- Application, à chaque frame où `a` change ou l'ancre a bougé :
  1. `camera.position = ĉ · (1 + a)` (direction inchangée).
  2. `p₂ = pickSphere(screen)` ; si `null` (l'ancre est sortie du globe après le
     changement d'altitude), arrêter là.
  3. `q = Quaternion.setFromUnitVectors(p₂, point)` ; `camera.position.applyQuaternion(q)` ;
     `camera.lookAt(0, 0, 0)`.
  4. Répéter 2–3 jusqu'à **4 itérations**, arrêt anticipé quand l'erreur de
     reprojection passe sous 0,1 px : `lookAt` avec `up = +y` annule le roulis
     introduit par `q` et décale le point (convergence linéaire). Mesuré le
     2026-09-06 (viewport 1000×800, caméra en `d = 3`) : point à 30° du centre,
     zoom à `a = 0,3` → 12 px après 1 itération, 0,25 après 2, 0,005 après 3 ;
     point à 80° (limbe) → 171 / 9,8 / 0,7 / 0,05 px. Quatre `pickSphere` par frame
     restent négligeables.
  5. `controls.update()` (fait par la boucle) relit la position ; la borne polaire
     d'OrbitControls (`minPolarAngle`/`maxPolarAngle`, défauts 0/π) reste appliquée.

Près du limbe la rotation est grande mais bornée par construction (le point visé est
sur la sphère visible). Aucune garde supplémentaire.

### Entrées

- `wheel` sur le canvas, `{ passive: false }`, `preventDefault()`.
- `pointerdown` / `pointermove` / `pointerup` / `pointercancel` sur le canvas,
  **`pointerType === "touch"` seulement**. Table des pointeurs actifs ; **deux
  pointeurs** = pincement (début du geste à l'arrivée du second, fin au départ de l'un
  des deux). Un doigt : rien, OrbitControls tourne. Trois doigts et plus : le
  pincement continue avec les deux premiers.
- Pas de `setPointerCapture` (OrbitControls l'appelle déjà sur le même canvas ; un
  second capture sur le même pointeur est sans effet).
- `zoomSpeed` d'OrbitControls devient sans objet ; la ligne et son commentaire
  « spec 4 » disparaissent de `scene.ts`.

### Interface

```ts
export interface ZoomControl {
  /** À appeler par la boucle de rendu avant controls.update(). Renvoie true si la caméra a bougé. */
  beforeUpdate(): boolean;
  dispose(): void;
}
export function attachZoom(canvas, camera, opts: { requestRender(): void; aMin: number; aMax: number }): ZoomControl;
```

La logique de courbe, d'ancre et de détection de pincement vit dans des fonctions
pures exportées (`normalizeWheel`, `nextAltitude`, `pinchAltitude`, `anchorRotate`,
`PinchTracker`) ; `attachZoom` ne fait que brancher les événements.

## 5. Lecture des valeurs (`web/src/data/pixels.ts`, `sampling.ts`)

- `pixels.ts` : `bitmapPixels(bitmap: ImageBitmap) → Uint8ClampedArray | null` (RGBA, largeur ×
  hauteur × 4). Dessine le bitmap dans un `OffscreenCanvas` (repli `<canvas>`
  détaché si `OffscreenCanvas` absent, contexte `{ willReadFrequently: true }`) puis
  `getImageData`. Le bitmap est créé avec `imageOrientation: "flipY"` (sud en ligne 0)
  : le dessin re-retourne (`ctx.scale(1, −1)`) pour livrer des lignes **nord en
  haut, comme le PNG du pipeline**. ≈ 4 Mo, une fois par rafraîchissement (15 min).
  Le canvas est réutilisé entre appels.
- `DataLoader.refresh()` remplit `pixels` à côté de `texture` dans `LoadedData`
  (`pixels: Uint8ClampedArray | null`). Les tests du loader injectent `bitmapPixels` par
  `LoaderDeps`.
- `sampling.ts` gagne :
  ```ts
  export function sampleTemperature(
    pixels: Uint8ClampedArray, grid: Grid, encoding: Encoding, lon: number, lat: number,
  ): number; // °C
  ```
  Bilinéaire sur le canal R, en coordonnées cellulaires de `heatmapUv` (colonne
  `x = (lon + 180) / 360 · W`, ligne `y = (90 − lat) / 180 · (H − 1)`, centre de
  cellule à +0,5) ; **bouclage** de la colonne modulo `W` (la colonne 1439 interpole
  avec la 0) ; lignes bornées `[0 ; H − 1]`. Résultat
  `min_c + (t / 255) · (max_c − min_c)`. Pure, `grid` et `encoding` viennent de
  `latest.json` (dette n° 3 : aucune constante recopiée).

## 6. Tooltip (`web/src/ui/tooltip.ts`, `index.html`, `style.css`)

### Modèle

Une **lecture** = un point ancré sur le globe `{ lon, lat }`, ou `null`. Un seul
modèle pour les deux modes ; seule l'entrée diffère :

- **Souris** (`pointerType === "mouse"`) : `pointermove` → `pickSphere` → la lecture
  suit le curseur ; `pointerleave` du canvas ou curseur hors globe → `null`.
- **Tactile** : un **tap** pose la lecture ; un tap à moins de **24 px** CSS du
  marqueur la retire ; un tap ailleurs la déplace. Tap = un seul pointeur, déplacement
  < **8 px**, durée < **300 ms**, aucun second doigt pendant le geste (machine à états
  pure `TapDetector`, alimentée par `pointerdown/move/up/cancel`).
- Stylet (`pen`) : traité comme la souris.

### Rendu

- À chaque frame rendue (`onViewChange` de `scene.ts`), la lecture est projetée par
  `projectToScreen` ; le tooltip suit le globe quand on tourne, disparaît derrière
  l'horizon ou hors viewport. En mode souris la projection est aussi refaite sur
  `pointermove` (sans attendre un rendu, le globe étant immobile).
- Valeur : `sampleTemperature` à chaque changement de lecture ou de données
  (`applyData`), formatée « 23,4 °C » par `format.ts::formatTemperature` (une
  décimale, virgule française, signe −). Aucune lecture affichée si `data.data` est
  `null` ; la lecture reste stockée et s'affiche dès l'arrivée des données.
- Le tooltip s'affiche **filtre Température actif ou non** (la valeur a un sens sur
  le satellite aussi).
- DOM : `#tooltip` (`.panel`, `pointer-events: none`, `role="status"`,
  `aria-live="polite"`), positionné en `position: fixed`, centré horizontalement
  **au-dessus** du point avec un décalage de 14 px, retourné **en dessous** si le
  point est à moins de 48 px du haut du canvas. `#marker` : cercle de 12 px, bordure
  blanche 2 px, fond `#ffd166`, `pointer-events: none`, visible seulement en mode
  tactile. Les deux sont hors `#overlay` (l'overlay peut être replié ou masqué par
  `showFatal`).

### Interface

```ts
export interface Tooltip {
  setReading(r: { lon: number; lat: number } | null, mode: "hover" | "pin"): void;
  setData(d: { pixels: Uint8ClampedArray; grid: Grid; encoding: Encoding } | null): void;
  /** Reprojection après un rendu. */
  update(camera: THREE.PerspectiveCamera, width: number, height: number): void;
}
```

`main.ts` branche : `pointermove`/`pointerleave` souris → `setReading(…, "hover")`,
`TapDetector` → `setReading(…, "pin")`, `applyData` → `setData`, `onViewChange` →
`update`.

## 7. Fondu satellite → carte (`web/src/tiles/lod.ts`)

`mapStyleFor(distance)` passe de `[1,25 ; 1,12]` à **`[MAP_FADE_START ; MAP_FADE_END]
= [1,20 ; 1,14]`**, constantes nommées et exportées, même forme linéaire bornée,
même précaution IEEE-754 (dénominateur dérivé des deux bornes). Test mis à jour.
Ajustement final à l'œil pendant la validation ; les valeurs retenues sont reportées
ici et dans HISTORY.

## 8. Gestion d'erreurs

| Cas | Comportement |
|---|---|
| `OffscreenCanvas` absent | Repli `<canvas>` détaché ; si `getContext("2d")` renvoie `null`, `pixels` = `null`, tooltip jamais affiché, globe intact |
| `getImageData` lève (bitmap fermé, mémoire) | Idem : `pixels = null`, `console.warn`, rendu inchangé |
| Curseur hors globe (molette) | Zoom vers le centre, pas de rotation |
| Ancre sortie du globe après changement d'altitude | Rotation sautée pour cette frame |
| Deux doigts puis un seul | Fin du pincement ; OrbitControls reprend la rotation à un doigt |
| `pointercancel` (appel, geste système) | Table des pointeurs vidée, `TapDetector` réinitialisé |
| Données absentes ou en échec | Tooltip masqué ; lecture conservée, affichée à l'arrivée des données |
| `webglcontextlost` | Inchangé (`showFatal`) ; le tooltip est masqué avec l'overlay |

## 9. Tests

Vitest, logique pure uniquement (règle du projet : rendu et gestes validés à l'œil).

- `pick.test.ts` : rayon central touche `(0,0,1)` pour une caméra en `(0,0,3)` ;
  rayon hors globe → `null` ; `vec3ToLonLat ∘ lonLatToVec3` = identité sur une grille
  de points (pôles, ±180) ; `projectToScreen` : point face caméra au centre, point
  derrière l'horizon `visible = false`.
- `zoom.test.ts` : `normalizeWheel` (pixel, ligne, page, bornage ±300) ;
  `nextAltitude` (35 ± 1 crans de 100 pour `A_MAX → A_MIN`, bornes respectées, cran
  négatif inverse) ; `pinchAltitude` (écart ×2 → altitude ÷2, bornes) ;
  `anchorRotate` : pour une caméra en `(0,0,3)` et un point à 30° du centre,
  après passage à `a = 0,3` le point reprojeté à moins de **0,5 px** de sa position
  écran initiale (viewport 1000 × 800), cas ancre `null`, cas limbe (80°, < 0,5 px
  aussi), cas ancre sortie du globe (zoom arrière, rotation sautée) ;
  `PinchTracker` : début au second doigt, fin au retrait, troisième doigt ignoré.
- `sampling.test.ts` : centre de cellule exact (valeur du pixel), milieu de deux
  cellules = moyenne, bouclage colonne 1439 ↔ 0, pôles bornés, orientation (ligne 0
  = lat 90), conversion `encoding`.
- `tooltip.test.ts` : `TapDetector` (tap valide, glisser > 8 px, durée > 300 ms,
  second doigt, `pointercancel`), `formatTemperature` (`-3,0 °C`, `23,4 °C`,
  arrondi), placement au-dessus / en dessous selon la marge haute.
- `loader.test.ts` : `pixels` rempli via `bitmapPixels` injecté ; `bitmapPixels` qui lève
  → `pixels = null`, `texture` valide.
- `lod.test.ts` : bornes du fondu mises à jour.

Validation manuelle (Chrome DevTools MCP + téléphone de l'utilisateur), consignée
dans le rapport d'exécution : critères §10.

## 10. Critères d'acceptation

1. **Zoom ancré** : molette du zoom max au zoom min (`d` 4 → 1,042) sur un point
   fixe (ex. Cherbourg) : le lieu sous le curseur se déplace de **< 2 px** au total.
2. **Sensation uniforme** : **35 ± 3 crans** de molette pour ce trajet, chaque cran
   agrandit d'un facteur comparable à l'écran (mesuré sur 3 crans à `d` = 3, 1,5,
   1,1 : rapport des largeurs apparentes dans un facteur 1,5).
3. **Téléphone** : pincement dosable près du sol (l'utilisateur atteint le zoom
   Normandie et s'y stabilise sans à-coups) ; le lieu sous les doigts reste sous les
   doigts pendant un pincement-déplacement. Dette n° 23 fermée.
4. **Tooltip souris** : suit le curseur sans retard visible ; la valeur affichée
   correspond à la couleur de la légende à **±0,5 °C** sur 3 points (contrôle avec
   `sampleTemperature` sur le PNG en console).
5. **Tooltip tactile** : tap pose le marqueur et la valeur ; tap sur le marqueur le
   retire ; tap ailleurs le déplace ; un glisser ne pose rien.
6. **Fondu** : style carte franchement établi à `d` = 1,14, absent à 1,20.
7. **Tests** : Vitest vert (91 existants + nouveaux), `npm run build` OK, aucun
   nouveau fetch réseau, aucune lecture GPU (`readPixels` WebGL) par frame.
8. **Rendu à la demande préservé** : globe immobile, souris immobile → aucun rendu
   (DevTools « Frame rendering stats » à 0 fps).

## 11. Hors périmètre

- Couches multiples (vent, nuages, humidité, pression) et menu de filtres → lot B.
- Étiquettes villes/pays (Natural Earth, CSS2DRenderer) → lot C.
- Mise à jour de l'URL (`lon`, `lat`, `d`) pendant la navigation.
- Coordonnées dans le tooltip (utiles seulement avec des étiquettes, lot C).
- Inclinaison de la caméra, rotation à deux doigts (roulis).
- Dettes §8 de HISTORY autres que la n° 23.
