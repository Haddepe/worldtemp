# Spec — Recherche de ville, « ma position » et villes de détail (lot F)

**Date :** 2026-09-26 · **Statut :** validée en brainstorming, à planifier
**Périmètre :** outil `tools/build_geo.py` et ses données (`web/public/geo/`), front (`web/`).
**Aucun changement** du pipeline horaire, du contrat `layers/latest.json`, des tuiles image
(`sat`/`map`), de R2, ni des paramètres d'URL existants (`layer`, `wind`, `labels`, `rivers`,
`lon`, `lat`, `d`, `tier`).

## 1. Objectif

Feuille de route HISTORY §8, lot F (ligne R4), plus une demande de l'utilisateur : en zoomant sur
le Grand Est, **Épinal n'apparaît pas**. Cause établie : la ville est **absente de la source**
(Natural Earth 10m, 7 342 lieux ; `grep -i pinal` ne trouve rien dans le cache brut), pas un
problème d'affichage. Ce lot :

1. ajoute **~165 000 villes** (GeoNames, > 1 000 habitants) affichées de près, par tuiles ;
2. ajoute une **recherche de ville** hors ligne, sans service externe ;
3. ajoute un bouton **« ma position »** ;
4. amène la caméra sur le lieu choisi par un **vol animé**, puis ouvre marqueur et tooltip.

## 2. Décisions (validées par l'utilisateur le 2026-09-26, ne pas rouvrir)

| Décision | Pourquoi |
|---|---|
| **GeoNames `cities1000`** (> 1 000 hab.), pas `cities15000` ni `cities5000` | Choix utilisateur : couvrir aussi les petites villes ; impose le découpage en tuiles. |
| **Socle Natural Earth conservé** (`places.json` inchangé) + **tuiles de détail GeoNames à un seul niveau** (z = 5) | La vue monde ne change pas ; seules les vues proches ont besoin des petites villes, donc pas de pyramide. |
| **Réutiliser la grille** (`tiles/grid.ts` ↔ `tiler/grid.py`) **et `selectTiles`**, **pas `TileLoader`** | La grille et le cadrage sont génériques ; `TileLoader` est lié aux images, textures et au budget GPU. |
| **Recherche = index de noms découpé par préfixe de 2 lettres**, servi avec le site | Toutes les villes trouvables, hors ligne, sans tiers ni fuite de la frappe (option B « géocodeur externe » et C « socle seul » écartées). |
| **Choix d'un résultat = vol animé + marqueur + tooltip avec valeur**, URL mise à jour | Réutilise marqueur et tooltip du toucher mobile ; lien partageable. |
| **Loupe 🔍 et 📍 dans le bandeau**, champ dépliable sous le bandeau, raccourci `/` | Aucune place prise au repos (mobile). |
| **Noms : anglais pour le socle, nom GeoNames (écriture latine) pour le détail** | « Épinal » et non « Epinal » ; aucune écriture non latine affichée (Chine en pinyin). |
| **Données servies par Cloudflare Pages** avec le site (`web/public/geo/`), versionnées par `GEO_VERSION` | Volume de l'ordre de 5–10 Mo, sous les limites de Pages ; pas de R2. |

## 3. Données (`tools/build_geo.py`)

### 3.1 Sources

- **Natural Earth 10m populated places** : inchangé, produit `places.json` (le socle).
- **GeoNames `cities1000.zip`** (TSV, ~165 000 lignes) et **`admin1CodesASCII.txt`** (noms des
  régions, clé `CC.code`), plus **`countryInfo.txt`** (nom anglais du pays par code ISO).
  Téléchargés dans `tools/.geo-cache/` (déjà ignoré par git), comme Natural Earth. Champs
  utilisés : `name`, `asciiname`, `alternatenames`, `latitude`, `longitude`, `country code`,
  `admin1 code`, `population`.
- **Licence** : GeoNames est en **CC BY 4.0** (usage commercial permis, crédit obligatoire).
  « GeoNames » s'ajoute à `#attribution` et à la ligne des sources du panneau About.

### 3.2 Nom affiché

- Socle : inchangé (`name_en`, repli `name`).
- Détail : `name` GeoNames **s'il est en écriture latine** (lettres latines avec diacritiques,
  chiffres, espaces, `-'’.()`), sinon `asciiname`. Un test couvre les deux branches.

### 3.3 Dédoublonnage socle / détail

Une ville GeoNames est **écartée du détail** (et gardée dans la recherche avec les coordonnées et
le nom du socle) si une ville du socle est à **moins de 10 km** et que les noms normalisés
(§3.5) coïncident : nom GeoNames, `asciiname` ou l'un des `alternatenames` égal au nom normalisé
du socle. Évite « Munich » et « München » superposés.

### 3.4 Tuiles de détail : `geo/cities/5/{x}/{y}.json`

- Chaque ville restante est rangée dans `tileAt(5, lon, lat)` (grille identique à
  `tiler/grid.py`, cases de 5,625°, 64 × 32 au plus).
- Seules les tuiles non vides sont écrites (estimation : ~1 000 à 1 500 fichiers).
- Format : `{"version": 1, "places": [[lon, lat, name, pop], …]}`, coordonnées arrondies à
  0,01° comme `places.json`, **triées par population décroissante puis nom**.

### 3.5 Index de recherche : `geo/search/{préfixe}.json`

- **Normalisation** (identique Python et TypeScript, testée avec les mêmes cas) : décomposition
  NFD, suppression des diacritiques, minuscules, apostrophes et tirets → espace, espaces
  multiples réduits. `Épinal` → `epinal`, `Saint-Dié-des-Vosges` → `saint die des vosges`.
- **Clés d'une ville**, en deux listes (relecture finale du 2026-09-26, F1) :
  - **primaires** : nom affiché, `asciiname`, nom du socle s'il y a correspondance (§3.3),
    normalisés, dédoublonnés ;
  - **alternatives** : pour les villes d'au moins **100 000 habitants** seulement, leurs
    `alternatenames` en écriture latine (exonymes : « munchen » → Munich), normalisés, sans
    celles déjà présentes en primaire. Les prendre pour toutes les villes gonflerait l'index de
    plusieurs dizaines de Mo pour des noms alternatifs de villages rarement cherchés (précision
    du 2026-09-26, rédaction du plan).
  Les séparer évite qu'un surnom (« paris of the north » → Varsovie, « bei xin si tuo ke » →
  Basingstoke) fasse passer une grande ville devant les vraies Paris ou Beijing.
- **Dédoublonnage socle** : une même ligne du socle ne produit qu'une entrée — celle de la ville
  GeoNames la plus peuplée qui lui est rattachée (§3.3), avec sa région et ses clés (deux lignes
  GeoNames rattachées à Hong Kong ou Bristol donnaient deux entrées identiques).
- Seules les villes GeoNames sont indexées : une ville du socle sans correspondance GeoNames
  (§3.3) n'est pas trouvable par la recherche (cas marginal, accepté).
- **Préfixe** = 2 premiers caractères de la clé normalisée (lettres/chiffres ; le reste est
  regroupé dans `_.json`). Une ville figure dans chaque fichier de préfixe d'une de ses clés
  (primaire ou alternative).
- Format : `{"version": 2, "entries": [[name, region, country, lon, lat, pop, [clés primaires…],
  [clés alternatives…]], …]}` (dans chaque fichier, chaque liste ne porte que **les clés qui
  commencent par ce préfixe** ; l'une des deux peut être vide), triées par population
  décroissante ; `region` = nom anglais-ASCII d'`admin1CodesASCII`
  (vide si inconnu) ; `country` = nom anglais de `countryInfo.txt`.
- Estimation : ~400 à 700 fichiers de quelques dizaines de Ko (un fichier de préfixe courant
  comme `sa` peut dépasser 100 Ko non compressé : accepté, il est gzippé par Pages).

### 3.6 Version et cache

`GEO_VERSION` (`web/src/geo/loader.ts`) est recalculé comme aujourd'hui après régénération ;
toutes les URL `geo/` (socle, tuiles de détail, index) portent `?v=GEO_VERSION`.

### 3.7 Tests (pytest)

Fixtures GeoNames réduites commitées (quelques lignes, dont Épinal, Munich/München, une ville
chinoise à nom non latin, une ville de 900 hab. écartée) : filtre de population, choix du nom,
dédoublonnage à 10 km, rangement par tuile (mêmes nombres que les tests de grille), tri,
normalisation, découpage par préfixe, format. Test sur les fichiers commités : **Épinal présent**
dans la tuile qui contient (6,45 ; 48,17) et dans `search/ep.json`.

## 4. Étiquettes de détail (navigateur)

### 4.1 Module `web/src/labels/detail.ts`

- **Tuiles demandées** : `selectTiles` avec `{ maxLevel: 5, k: 0 }` (seuil nul : la
  descente est forcée jusqu'au niveau 5), donc même cadrage et même test d'horizon que les tuiles image. **Actif seulement
  sous d < 1,25** (palier `CITY_TIERS` où toutes les villes sont éligibles) et si le bouton
  Labels est actif.
- **Chargement** : 4 requêtes en parallèle au plus, annulation (`AbortController`) des tuiles
  sorties de la vue, cache LRU de 64 tuiles. **404 = tuile vide** mémorisée. Autre échec :
  réessai au prochain mouvement de caméra (même politique que les tuiles image, dette n° 19).
- Les lignes sont converties en `LabelItem` (vecteurs unitaires précalculés), comme
  `places.json`, via les fonctions existantes de `labels/data.ts`.
- Dépendances injectées (`fetchJson`, horloge) pour les tests.

### 4.2 Intégration (`labels/controller.ts`)

- À chaque sélection (toutes les 100 ms), les candidats sont **socle + villes des tuiles de
  détail visibles** ; `selectLabels` est inchangé (priorité population, anti-collision gloutonne,
  `LABEL_CAP`).
- L'arrivée d'une tuile relance une sélection (Épinal apparaît sans mouvement de caméra), par
  `LabelsController.invalidate()` : au plus une sélection toutes les 100 ms, la rafale de tuiles
  d'un zoom étant rattrapée par la sélection différée (relecture finale, F3).
- Les étiquettes de détail portent la valeur de la couche active comme les autres.
- De loin (d ≥ 1,25) : socle seul, **zéro requête** de détail.

### 4.3 Tests (Vitest)

Tuiles demandées selon d, la vue et le bouton Labels ; LRU ; annulation ; 404 → vide ; réessai ;
fusion des candidats ; relance à l'arrivée d'une tuile.

## 5. Recherche et « ma position » (interface)

### 5.1 Bandeau

Deux boutons à côté de `?` dans `#banner` : `#search-open` (🔍, `aria-label="Search for a
city"`) et `#locate` (📍, `aria-label="Go to my location"`), même taille et même style que `?`.

### 5.2 Recherche (`web/src/search/index.ts` logique, `web/src/search/ui.ts` DOM)

- La loupe ou la touche `/` (hors champ de saisie) déplie un champ sous le bandeau et y met le
  focus ; Échap ou un second clic le referme.
- À partir de **2 caractères** : normalisation (§3.5), chargement de `geo/search/{préfixe}.json`
  une seule fois (cache mémoire), filtrage local des entrées dont une clé **commence par** la
  saisie normalisée ; d'abord celles trouvées par une clé **primaire** (ordre du fichier :
  population décroissante), puis seulement celles trouvées par une clé **alternative** seule
  (§3.5), **8 résultats au plus** au total, affichés
  « Épinal — Grand Est, France » (région omise si vide).
- Clavier : ↑/↓, Entrée, Échap. ARIA : `role="combobox"`, `aria-expanded`, `aria-controls`,
  `role="listbox"` / `role="option"`, `aria-activedescendant`.
- Messages : « No matches » ; « Search unavailable » en cas d'échec réseau. `#search-message`
  (`role="status"`) reste toujours rendu, seul son texte change (vide : marge nulle), pour que
  l'annonce soit lue.
- Après un choix, le focus revient au bouton loupe ; à la réouverture, la requête est relancée
  si le champ n'est pas vide.
- Une frappe plus récente annule le résultat d'une requête plus ancienne.

### 5.3 Vol animé (`web/src/render/fly.ts`)

- Interpolation de la caméra : direction par **slerp** entre la direction actuelle et celle de
  la cible, distance interpolée jusqu'à **d = 1,15**, ~1,5 s, courbe d'accélération puis de
  freinage (ease-in-out).
- **Toute interaction utilisateur interrompt le vol** (pointeur, molette, touche de navigation).
- `prefers-reduced-motion: reduce` → saut direct (`setInitialView`).
- À l'arrivée : marqueur et tooltip existants ouverts au point, avec le **nom du lieu** et la
  valeur de la couche active (épinglé sans couche, vent ni nom, le **marqueur seul** s'affiche) ;
  **après un choix de ville seulement**, URL mise à jour (`?lon=&lat=&d=`, via
  `history.replaceState`) — jamais après « ma position » (§5.4).
- Le tooltip épinglé à l'arrivée n'est pas remplacé par le survol de la souris ; un clic sur le
  globe lève l'épingle et le survol reprend (relecture finale, F2). Le tactile ne change pas.

### 5.4 « Ma position »

`navigator.geolocation.getCurrentPosition` (`enableHighAccuracy: false`, `timeout: 10000`,
`maximumAge: 600000`). Succès → vol (§5.3), tooltip sans nom de ville (valeur seule, ou
marqueur seul sans couche). Refus, indisponibilité ou délai dépassé → « Location unavailable »
dans `#status` pendant 5 s. La position n'est **ni envoyée ni stockée** ; le paragraphe
« Privacy » du panneau About le dit. En conséquence, l'URL **n'est pas réécrite** après
« ma position » : elle se partage et reste dans l'historique du navigateur (décision de la
relecture finale, F4).

### 5.5 Mobile

Champ à la largeur du bandeau ; liste au-dessus du globe, sous les safe-areas ; cibles tactiles
≥ 40 px.

### 5.6 Tests (Vitest)

Normalisation (mêmes cas que pytest), choix du fichier de préfixe, filtrage/tri/limite,
annulation d'une requête périmée, navigation clavier (logique), interpolation du vol (début, fin,
interruption, reduced-motion), erreurs de géolocalisation. Le garde-fou `english.test.ts`
couvre les nouveaux textes.

## 6. Validation dans le navigateur (avec l'accord de l'utilisateur, RAM limitée)

- Zoom sur le Grand Est : Épinal apparaît avec sa valeur ; aucune erreur console ; images/s
  inchangées au repos.
- Recherche « epi » → Épinal parmi les résultats français (pas en tête : Épinay-sur-Seine est
  plus peuplée) ; « paris » → Paris (France) en tête ; « beijing » → Beijing en tête ;
  « munich » et « munchen » donnent la même ville ; vol, marqueur, tooltip ; URL mise à jour.
- 📍 accepté (marqueur même sans couche, URL inchangée) puis refusé ; le survol souris ne
  remplace pas le tooltip épinglé, un clic le lève.
- Largeur mobile (500 px, plancher de l'outillage) : champ, liste, boutons.

## 7. Critères d'acceptation

1. Épinal s'affiche en zoom proche sur le Grand Est et se trouve par la recherche.
2. De loin, aucune requête de tuile de détail ; la vue monde est identique à aujourd'hui.
3. La recherche trouve une ville > 1 000 hab. par son nom local, ASCII ou anglais, sans service
   externe.
4. Choisir un résultat ou sa position amène la caméra au lieu (vol, ou saut si reduced-motion),
   ouvre marqueur et tooltip, met l'URL à jour (résultat seulement, jamais sa position) ; une
   interaction interrompt le vol.
5. Géolocalisation refusée → message, aucune autre conséquence.
6. GeoNames crédité dans `#attribution` et le panneau About.
7. Tous les tests verts (vitest, pytest), `tsc` propre, build de production réussi.

## 8. Hors périmètre (à porter à la feuille de route si besoin)

Recherche plein texte ou floue (fautes de frappe), recherche de pays/régions/lieux non urbains,
noms multilingues, géocodage inverse (« ville la plus proche » de ma position), historique des
recherches.
