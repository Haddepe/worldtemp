# Spec — Capture d'image partageable et vue caméra dans l'URL (chantier audience ②)

**Date :** 2026-10-03 · **Statut :** validée en brainstorming, à planifier
**Périmètre :** `web/` seulement : nouveau dossier `web/src/capture/`, ajouts dans
`web/src/labels/layer.ts`, `web/src/ui/tooltip.ts`, `web/src/i18n/en.ts`, `web/index.html`,
`web/src/style.css`, branchement dans `web/src/main.ts` ; `HISTORY.md`.
**Aucun changement** du pipeline, du contrat R2, du Worker `worldtemp-cron`, ni des métadonnées
de partage (`og:*`, `canonical`).

## 1. Objectif

Chantier audience (HISTORY §5 du 2026-10-03) : le site n'a presque pas de visiteurs humains, et
le levier rapide est le partage communautaire (Reddit r/dataisbeautiful et r/weather, Hacker News,
réseaux), fait par l'utilisateur. Il faut pour cela un **objet à partager** qui montre exactement
ce qu'on a vu et qui ramène vers le site.

Les liens profonds seuls ne suffisent pas (analyse utilisateur, 2026-10-03) : il n'y a **pas
d'archive**, la frise ne couvre que ~48 h du run courant. Un lien vers « la tempête de sable de
ce matin » montrera, quelques heures plus tard, des données sans rapport. Une **image fixe datée**
garde l'événement pour toujours ; c'est aussi le format attendu sur r/dataisbeautiful.

**But :**
1. Un bouton 📷 produit une image PNG du globe tel qu'affiché, avec un bandeau incrusté (couche,
   légende, date UTC de l'échéance, run, `globelayers.com`), partagée par la feuille native sur
   mobile ou téléchargée sur ordinateur.
2. La vue caméra (`lon`, `lat`, `d`) est **toujours à jour dans l'URL**, pas seulement après un vol
   vers une ville : copier l'adresse redonne le même lieu, la même couche, les mêmes interrupteurs.
   La partie lieu + couche d'un lien ne se périme pas.

## 2. Décisions (validées par l'utilisateur le 2026-10-03, ne pas rouvrir)

| Décision | Pourquoi |
|---|---|
| **Image plutôt que lien daté** ; l'échéance n'entre **pas** dans l'URL | Pas d'archive : une échéance dans l'URL devient fausse en quelques heures. L'image fige l'instant |
| **Cadrage = ce qui est à l'écran**, à la résolution du rendu WebGL (CSS × DPR plafonné par le profil GPU) | Fidèle et simple ; un format fixe imposerait un rendu hors écran à une autre taille (niveau de détail des tuiles, étiquettes à replacer) |
| **Contenu** : globe (couche, vent, fleuves, halo, étoiles — tout le WebGL) + étiquettes villes/pays telles qu'affichées + point épinglé + bandeau | Choix utilisateur. Exclus : boutons, panneaux, frise, infobulle de survol |
| **Composition maison sur canvas 2D**, aucune dépendance | `html2canvas`/`dom-to-image` : poids, rendu approximatif du WebGL et de `backdrop-filter` ; `getDisplayMedia` : permission, toute l'interface capturée, absent sur mobile |
| **Étiquettes redessinées depuis les données** (`LabelView`), pas depuis le DOM | Position, nom, valeur et type sont déjà calculés pour le DOM ; pas de lecture de styles calculés |
| **Confidentialité de « ma position »** : écriture de la vue suspendue après un vol « ma position » jusqu'à ce que le centre de la vue s'éloigne de plus de **5°** du point localisé (≈ 550 km) ou qu'une ville soit choisie ; le marqueur « ma position » est **exclu de l'image** | Promesse du panneau About (la position n'est ni stockée ni partagée, HISTORY lot F). Une URL réécrite à chaque arrêt de caméra porterait sinon la position sans que l'utilisateur le voie |
| **Heure affichée = heure exacte du curseur** (à la minute), en **UTC** | L'image montre le mélange GPU entre deux échéances à cet instant ; UTC car l'audience est mondiale (la frise, elle, reste en heure locale) |

## 3. Architecture

Nouveau dossier `web/src/capture/` :

| Unité | Rôle | Dépend de | Test |
|---|---|---|---|
| `compose.ts` (pur) | `composeCapture(input): DrawOp[]` : liste d'ordres de dessin (rectangle, texte, dégradé, marqueur) à partir de la taille de l'image, du DPR, de la couche, de la légende, de l'heure, des étiquettes et du point épinglé. Place le bandeau et met les polices à l'échelle selon la largeur | `ui/format.ts` (`legendTicks`), `render/colormap.ts` (arrêts de couleur), `i18n/en.ts` | Vitest |
| `naming.ts` (pur) | `captureFileName(layerId, tMs)` → `globelayers-<couche>-<AAAA-MM-JJ>-<HH>UTC.png` (`none` → `globelayers-<AAAA-MM-JJ>-<HH>UTC.png`) ; `captureWhen(tMs)` → `Forecast for Sat 3 Oct 2026, 13:24 UTC` ; `captureRun(model, runIso)` → `GFS run 3 Oct 06Z` | `i18n/en.ts` | Vitest |
| `privacy.ts` (pur) | `ViewGuard` : `located(lon, lat)`, `cityChosen()`, `mayWrite(centerLon, centerLat): boolean` (faux tant que la distance angulaire au point localisé est ≤ 5°) | — | Vitest |
| `paint.ts` | `paint(ctx, ops)` : exécute les `DrawOp` sur un `CanvasRenderingContext2D` | — | à l'œil |
| `capture.ts` | `captureImage(deps): Promise<Blob>` : `renderer.render(scene, camera)` puis, **dans la même tâche**, `drawImage(canvas WebGL)` sur un canvas 2D de même taille, `paint(composeCapture(...))`, `toBlob("image/png")` | `render/scene.ts`, `compose.ts`, `paint.ts` | à l'œil |
| `share.ts` | `shareOrSave(blob, name, text, url): Promise<"shared" \| "saved" \| "cancelled">` : appareil tactile (`matchMedia("(pointer: coarse)")`) **et** `navigator.canShare({ files })` → `navigator.share` ; sinon `<a download>` + `URL.revokeObjectURL` (Chrome sous Windows accepte aussi le partage de fichiers : sans la garde tactile, l'ordinateur ouvrirait la boîte de partage du système au lieu de télécharger) | — | à l'œil |

Ajouts au code existant :
- `LabelsLayer.current(): LabelView[]` (`labels/layer.ts`) : les vues passées au dernier `render`.
- `Tooltip` (`ui/tooltip.ts`) : la lecture épinglée porte son origine (`"user"` | `"city"` |
  `"locate"`) ; `pinned(): { lon, lat, text, origin } | null` pour la capture.
- Bouton `<button id="capture" aria-label="Save or share an image">📷</button>` dans `#banner`,
  entre `#locate` et `#about-open`, même style que ses voisins (`style.css`).
- `main.ts` : **branchement seulement** (clic → `captureImage` → `shareOrSave` → message) et
  écriture de la vue au repos de la caméra ; aucune logique de composition.

**Préservation du tampon WebGL :** pas de `preserveDrawingBuffer` (coût permanent). La lecture
se fait juste après un `render()` explicite, dans la même tâche JS, ce que le navigateur garantit.

## 4. Flux

### 4.1 Capture

1. Clic sur 📷 → bouton `disabled`, `aria-busy="true"`.
2. `captureImage` : rendu forcé, copie du canvas WebGL, composition, `toBlob`. Une lecture de la
   frise en cours continue ; l'image fige l'instant du clic (heure du curseur lue au début).
3. `shareOrSave(blob, captureFileName(...), texte, location.href)` :
   - appareil tactile et `canShare({files})` : feuille native, titre `GlobeLayers`, texte
     `<Couche> · <captureWhen> — globelayers.com`, URL courante ;
   - sinon : téléchargement du PNG.
4. Message bref dans `#status` : `Image saved` (téléchargement) ; rien pour `shared` ou
   `cancelled` ; `Capture failed` en cas d'erreur (§5). Le message dure **3 s**, puis `#status`
   retrouve son contenu précédent (ex. « Data is outdated »). Bouton réactivé dans tous les cas.

### 4.2 Contenu de l'image

- **Fond :** copie exacte du canvas WebGL.
- **Étiquettes :** pour chaque `LabelView` visible, mêmes règles que le CSS (`.label`) : ville =
  point blanc + nom + valeur en gras sous le nom ; pays = majuscules espacées, centré ; halo noir
  (variante sombre `#labels.dark` : texte foncé, halo clair). Positions CSS × DPR.
- **Point épinglé** (origine `user` ou `city`) : marqueur jaune `#ffd166` cerclé de blanc + texte
  de l'infobulle dans un cartouche sombre. Origine `locate` : **ni marqueur ni texte**.
- **Bandeau :** en bas, pleine largeur, fond `rgba(10,12,18,0.82)`, hauteur
  `clamp(64, 0.09 × min(L, H), 160)` px d'image ; police système, tailles proportionnelles à la
  hauteur du bandeau.
  - gauche : `<Nom de couche> · <unité>` puis dégradé de la légende et graduations
    (`legendTicks`) ;
  - droite : `captureWhen(t)`, puis `captureRun(model, run)` (`GEFS-Aerosols` pour `pm25`/`dust`),
    puis **`globelayers.com`** en gras ;
  - largeur < 600 px CSS (portrait mobile) : les deux blocs s'empilent (couche + légende en haut,
    date/run/site en bas), hauteur du bandeau doublée.
  - couche `none` : pas de légende ni de run ; `Captured <date UTC>` et `globelayers.com`.

### 4.3 Vue caméra dans l'URL

- Au repos de la caméra (aucun événement `change` d'OrbitControls depuis **400 ms**, amortissement
  fini) : si `ViewGuard.mayWrite(centre)`, `history.replaceState(null, "", withView(location.search,
  lon, lat, d))` avec le centre de la vue (point de la sphère sous l'axe caméra) et la distance.
- Vol vers une ville : `ViewGuard.cityChosen()`, puis comportement actuel (écriture à l'arrivée).
- Vol « ma position » : `ViewGuard.located(lon, lat)` et **retrait** de `lon`/`lat`/`d` de l'URL ;
  écriture suspendue tant que `mayWrite` est faux.
- Aucune entrée d'historique (`replaceState`), aucune écriture pendant un geste ou un vol.

## 5. Erreurs

| Cas | Comportement |
|---|---|
| `toBlob` rend `null`, canvas 2D indisponible, exception de composition | `Capture failed` dans `#status`, bouton réactivé, aucun autre effet |
| Contexte WebGL perdu | Le bouton vit dans `#overlay`, masqué par `showFatal()` : inaccessible, rien à faire |
| `navigator.share` rejette `AbortError` (annulation) | `cancelled`, aucun message |
| `navigator.share` rejette autre chose | repli sur le téléchargement |
| Aucune donnée encore chargée (démarrage) | Capture possible : globe sans couche, bandeau variante `none` |

## 6. Tests

Vitest (logique pure, règle du projet), attendus écrits en dur :
- `naming.test.ts` : noms de fichier (couche, `none`, minuit, heure à un chiffre), `captureWhen`
  à la minute, `captureRun` GFS et GEFS-Aerosols.
- `compose.test.ts` : 390×844 @3 (portrait, blocs empilés), 1920×1080 @1 (paysage), couche `none`,
  heure entre deux échéances (`13:24`), étiquette ville avec et sans valeur, pays, variante sombre,
  point épinglé `user` présent et `locate` absent ; vérifie positions × DPR et hauteur du bandeau.
- `privacy.test.ts` : écriture permise sans localisation ; refusée à 0°, 4,9° ; permise à 5,1° ;
  rouverte par `cityChosen()` ; antiméridien (179° ↔ −179°) et pôle.

À l'œil (navigateur sur ordinateur, puis téléphone de l'utilisateur) : image fidèle à l'écran pour
temp, dust et `none` ; étiquettes alignées ; feuille de partage sur mobile ; téléchargement sur
ordinateur ; URL mise à jour après rotation et zoom ; URL **sans** position après « ma position ».

## 7. Critères d'acceptation

1. 📷 sur ordinateur télécharge `globelayers-<couche>-<date>-<HH>UTC.png`, de la taille du rendu
   WebGL, contenant globe, étiquettes, point épinglé et bandeau lisible.
2. 📷 sur mobile ouvre la feuille de partage native avec l'image jointe.
3. L'image ne contient ni bouton, ni panneau, ni frise, ni marqueur « ma position ».
4. Après rotation ou zoom à la main, l'URL porte `lon`, `lat`, `d` de la vue au repos ; la recharger
   redonne la même vue.
5. Après « ma position », l'URL ne porte aucune position tant que la vue reste à ≤ 5° du point.
6. Suites Vitest et pytest vertes, `typecheck` et build OK ; bundle gzip en hausse de moins de
   10 Ko (estimation, mesurée au build).

## 8. HISTORY

§3 (dossier `capture/`, nouveaux tests), §5 (décisions du §2), §7 (merge), §9 ; §8 : la ligne R8
« image Open Graph par couche » reste ouverte (non traitée ici).

## 9. Hors périmètre

- Échéance dans l'URL, aperçu de lien (`og:image`) par couche ou par vue (script Worker), format
  d'image fixe, animation GIF/vidéo de la frise (piste si les images prennent).
- Agrandissement des boutons du bandeau (dette n° 51, le 📷 en hérite).
