# Spec — Repères géographiques (lot C) : étiquettes villes/pays avec valeur, fleuves

**Date :** 2026-09-18 · **Statut :** validée en brainstorming, à planifier
**Périmètre :** sous-projet 4, lot C « étiquettes », élargi aux **fleuves** à la demande de
l'utilisateur. Outil de préparation de données (Natural Earth → `web/public/geo/`), front
(étiquettes DOM, fleuves en quads instanciés, deux interrupteurs). **Aucun changement** du
pipeline horaire, du contrat `layers/latest.json`, des tuiles ni de R2.

## 1. Objectif

Le globe affiche des couches météo et le vent, mais aucun repère nommé : pour lire la
température à Paris il faut savoir où est Paris, puis survoler. Cette spec ajoute :

- des **étiquettes de villes** portant le nom **et la valeur de la couche active**
  (« Paris » / « 23,4 °C »), façon Windy/Ventusky ;
- des **étiquettes de pays** (nom seul) ;
- les **fleuves principaux**, tracés d'une couleur distincte des frontières.

Décisions prises en brainstorming (ne pas rouvrir) :

- **ville = nom + valeur de la couche active** ; pays = nom seul ; nom seul aussi quand
  aucune couche n'est active, sous `tooltipMin`, ou pixels indisponibles ;
- **villes : Natural Earth `populated_places` 10 m** (≈ 7 300, domaine public, `NAME_FR`),
  pas GeoNames — la grille GFS fait 25 km, plus de profondeur n'apporte rien ;
- **densité par priorité + seuil selon le zoom + anti-chevauchement + plafond**, pas un
  seuil de population fixe ;
- **deux interrupteurs indépendants** « Étiquettes » et « Fleuves », actifs par défaut,
  `?labels=0|1`, `?rivers=0|1` ;
- **approche A : étiquettes en éléments HTML** positionnés par `projectToScreen`
  (`render/pick.ts`), plutôt que `CSS2DRenderer` (seconde passe, moins de contrôle) ou du
  texte GPU (`troika`, +100 Ko, surdimensionné pour ≤ 60 étiquettes) ;
- **fleuves en lignes vectorielles** (quads instanciés, comme le vent), pas dans les tuiles
  carte : leurs trois canaux sont pris, un quatrième imposerait de régénérer la pyramide ;
- **données statiques commitées** dans `web/public/geo/`, produites par un script manuel ;
  pas sur R2, pas dans la CI.

## 2. Données (`tools/build_geo.py` → `web/public/geo/`)

Script Python **stdlib seule** (`urllib`, `json`, `struct`) — tourne dans le venv Windows,
sans GDAL. Sources : GeoJSON du dépôt `nvkelso/natural-earth-vector`, **figés sur un tag**
(constante `NE_TAG = "v5.1.2"` dans le script) :

| Source | Usage |
|---|---|
| `ne_10m_populated_places.geojson` | villes : `NAME_FR` (repli `NAME`), `POP_MAX`, `FEATURECLA` (`Admin-0 capital` → capitale) |
| `ne_50m_admin_0_countries.geojson` | pays : `LABEL_X`/`LABEL_Y`, `NAME_FR` (repli `NAME`), `LABELRANK` |
| `ne_10m_rivers_lake_centerlines.geojson` | fleuves : géométrie, `scalerank` |

Lancé à la main (`python tools/build_geo.py`), il télécharge dans un cache git-ignoré et
écrit trois fichiers **commités** :

| Fichier | Forme | Taille visée |
|---|---|---|
| `places.json` | `{"version":1,"places":[[lon,lat,"nom",pop,cap],…]}` — coordonnées arrondies à 0,01°, `cap` ∈ {0,1}, **trié par priorité** : capitales d'abord, puis `pop` décroissante, puis nom (déterminisme) | ≤ 300 Ko brut |
| `countries.json` | `{"version":1,"countries":[[lon,lat,"nom",rang],…]}` trié par `rang` croissant puis nom | ≤ 15 Ko |
| `rivers.bin` | binaire, §5 | ≤ 400 Ko brut |

Les lieux sans nom ou à `POP_MAX ≤ 0` hors capitales sont écartés. Sortie **déterministe**
(même entrée → mêmes octets), en LF.

## 3. Étiquettes — sélection (`web/src/labels/select.ts`, pure)

Entrées : lieux (vecteurs unité précalculés par `labels/data.ts` dans un `Float32Array`),
`ViewState` (`tiles/lod.ts`), taille du viewport CSS, ensemble des étiquettes déjà
affichées, plafond.

**Éligibilité selon la distance caméra d** (plage 1,042–4, `render/scene.ts`) :

| d | Villes | Pays |
|---|---|---|
| ≥ 2,5 | capitales et `pop` ≥ 5 M | `rang` ≤ 3 |
| ≥ 1,6 | `pop` ≥ 1 M (et capitales) | `rang` ≤ 5 |
| ≥ 1,25 | `pop` ≥ 100 k (et capitales) | tous |
| < 1,25 | toutes | aucun |

Constantes nommées et exportées (`CITY_TIERS`, `COUNTRY_TIERS`) : réglables à l'œil en
validation sans toucher à la logique.

**Visibilité :** devant l'horizon (produit scalaire avec la direction caméra > 1/d — point à
rayon 1, seuil de la spec tuiles §5), puis projection écran dans le viewport avec une marge.

**Ordre de placement :** étiquettes déjà affichées et toujours éligibles d'abord (stabilité :
pas de clignotement en rotation), puis pays, puis villes, chacun dans l'ordre du fichier.
Conséquence assumée : une ville plus importante qui entre dans la vue peut attendre qu'une
étiquette déjà posée sorte ou cesse d'être éligible ; tout changement de palier de zoom
vide l'ensemble « déjà affichées », ce qui rétablit l'ordre de priorité strict.

**Anti-chevauchement glouton :** boîte estimée sans mesure DOM — largeur =
`max(len(nom), len(valeur)) × CHAR_W + marges`, hauteur fixe (une ou deux lignes) ; une
étiquette dont la boîte touche une boîte déjà posée est rejetée. Arrêt au **plafond** :
`LABEL_CAP = { high: 60, low: 30 }`. Sous 600 px de large, le plafond est divisé par deux.

Sortie : liste `{ id, x, y, kind }`. Coût visé : ≤ 2 ms pour 7 300 lieux (high).

## 4. Étiquettes — rendu et valeurs (`web/src/labels/layer.ts`, `labels/controller.ts`)

- Conteneur `#labels` au-dessus du canvas, `pointer-events: none`, `aria-hidden="true"`
  (décoratif : le tooltip reste la voie de lecture) — tooltip, zoom et pincement inchangés.
- Réserve de `div` réutilisés. Ville : point à la position exacte, nom à droite, valeur en
  gras dessous. Pays : capitales espacées, sans point ni valeur. Texte blanc, halo sombre
  (`text-shadow`), lisible sur satellite, style carte et couches colorées.
- Apparition/disparition en fondu 150 ms ; aucun fondu si `prefers-reduced-motion`.
- **Cadence** (`controller.ts`, inscrit sur `SceneHandle.onFrame` seulement quand
  l'interrupteur est actif) : sélection recalculée quand la caméra a bougé, au plus toutes
  les 100 ms ; repositionnement des étiquettes visibles à chaque frame rendue, par
  `transform: translate3d`. Le contrôleur ne demande **jamais** de rendu WebGL.
- **Valeurs :** `sampleValue` sur les pixels bruts de la couche active + `def.format`,
  comme le tooltip ; recalculées seulement quand la couche, ses données ou la sélection
  changent. Nom seul : aucune couche, valeur < `tooltipMin`, pixels `null`. Le vent
  n'ajoute rien à l'étiquette.

## 5. Fleuves (`web/src/rivers/data.ts`, `web/src/render/rivers.ts`)

**`rivers.bin`** (little-endian, esprit de `index.bin` WTIX) : magic `WTRV`, `u16` version
(1), `u32` nombre de lignes ; puis par ligne `u8` rang, `u8` réservé (0), `u16` n, puis n ×
(`i16` lon, `i16` lat) en centièmes de degré. Lignes **triées par rang croissant**. Le
script simplifie chaque polyligne (Douglas-Peucker, tolérance de départ 0,02°) et écarte
les lignes de moins de 2 points ; la tolérance est relevée jusqu'à tenir le budget.

**`rivers/data.ts`** (pure) : valide magic, version, bornes (|lon| ≤ 18 000, |lat| ≤ 9 000,
taille cohérente) ; produit les segments 3D au **rayon 1,001** (sous le vent à 1,002),
subdivise tout segment > 2° (sinon la corde passe sous la surface), renvoie
`{ starts, ends, ranks, countByRank }` où `countByRank[r]` = nombre de segments de rang ≤ r.

**Budget : ≤ 25 000 segments** après subdivision (leçon du 2026-09-18 : le coût par
instance est sensible sur l'UHD 620). Le script affiche le compte ; un test le vérifie sur
le fichier commité.

**`render/rivers.ts`** : un `Mesh` de quads instanciés (tampons statiques, envoyés une
fois), `renderOrder` sous le vent. Le GLSL d'élargissement en espace écran est **extrait
dans un fragment partagé** par `wind.vert.glsl` et `rivers.vert.glsl` (concaténation des
`?raw` côté TS), pour ne pas diverger.

**Apparition selon le zoom :** rang maximal `RIVER_TIERS` — d ≥ 2,5 → 3 ; d ≥ 1,6 → 5 ;
d ≥ 1,25 → 7 ; en dessous → tous. `instanceCount = countByRank[rangMax]` (préfixe, grâce au
tri) ; le dernier rang admis apparaît en fondu (uniform `uMaxRank` flottant, `smoothstep`
sur un rang) plutôt que d'un coup. Mis à jour par le même `onFrame`, sans tick propre.

**Style :** 1,5 px CSS × pixel ratio, bords anti-crénelés ; couleur bleu-cyan clair
`(0,55 ; 0,82 ; 1,0)` sur satellite, bleu soutenu `(0,25 ; 0,50 ; 0,85)` en style carte
(`uMapStyle`), alpha 0,8 — distincte du blanc des frontières. Dessinés au-dessus des
couches, comme les frontières.

## 6. Interface, URL, état initial

- `ui/wind-toggle.ts` est généralisé en **`ui/toggle.ts`** (`createToggle(button, onChange)`),
  utilisé par « Vent », « Étiquettes », « Fleuves ». Correction au passage du défaut noté en
  dette n° 38 : `setDisabled(true)` ramène `aria-checked` à `false` et conserve `title`.
- Deux boutons sous « Vent » dans le panneau. `?labels=0|1`, `?rivers=0|1`, mis à jour par
  `history.replaceState`. **Actifs par défaut en `high` comme en `low`** (coût faible,
  plafonds réduits en `low`).
- Chargement des fichiers `geo/` **après le premier rendu**, sans bloquer le démarrage ;
  un interrupteur éteint au départ ne charge son fichier qu'à la première activation.
  Chargement non réentrant, une seule fois par session.

## 7. Gestion d'erreurs

| Cas | Comportement |
|---|---|
| `places.json`/`countries.json` absent ou invalide | interrupteur « Étiquettes » grisé, `title` « Étiquettes indisponibles », `console.warn` ; reste de l'app intact, pas de bandeau |
| `rivers.bin` absent ou invalide | idem pour « Fleuves » |
| un seul des deux fichiers d'étiquettes en échec | l'autre s'affiche (villes sans pays ou l'inverse) |
| pixels de la couche illisibles | étiquettes en nom seul |
| `webglcontextlost` | three renvoie la géométrie des fleuves ; les étiquettes sont du DOM |

## 8. Tests

**pytest** (`tests/test_build_geo.py`) : tri par priorité, arrondi, repli `NAME_FR` → `NAME`,
écartement des lieux sans nom, Douglas-Peucker sur une polyligne connue, encodage/relecture
de `rivers.bin`, déterminisme ; **validité des fichiers commités** (schéma, ordre, Paris et
Tokyo présents, ≤ 25 000 segments, tailles sous budget). Aucun accès réseau dans les tests.

**Vitest :** `labels/select` (seuils par d, horizon, hors viewport, chevauchement, plafond,
plafond mobile, stabilité des déjà-affichées, ordre pays/villes) ; `labels/data` (valide /
invalide) ; texte d'étiquette (valeur, nom seul ×3 cas) ; `rivers/data` (magic, version,
bornes, subdivision ≤ 2°, `countByRank`) ; `render/rivers` (`instanceCount` par d, uniforms,
tampons statiques) ; `ui/toggle` (dont `aria-checked` désactivé) ; paramètres d'URL.
Rendu DOM et WebGL à l'œil, comme toujours.

## 9. Critères d'acceptation

Validation navigateur sur **`vite build` + `vite preview`** (jamais en mode dev — HISTORY §6) :

1. France à d = 1,35, couche température : Paris, Lyon, Marseille, Toulouse, Bordeaux…
   affichées, valeur identique à celle du tooltip au même point.
2. Aucun chevauchement d'étiquettes, à 1440 px comme à 500 px de large.
3. Rotation et zoom : pas de clignotement, rien d'affiché au-delà de l'horizon.
4. Loire, Seine, Rhône, Garonne visibles à d ≤ 1,35 ; seuls les très grands fleuves à d = 3 ;
   couleur distincte des frontières sur satellite et en style carte.
5. Interrupteurs et URL cohérents (`?labels=0&rivers=0` au chargement, bascule sans rechargement).
6. Machine de référence (UHD 620, 1440×830, `high`), vent + étiquettes + fleuves : 60 fps,
   sélection ≤ 2 ms.
7. Bundle ≤ **+8 Ko gzip** par rapport à 156,08 Ko.
8. Fichier `geo/` absent (renommé en local) : interrupteur grisé, rien d'autre ne casse.
9. **Profil `low` sur mobile** : contrôle émulé (`?tier=low`, viewport mobile tactile :
   plafond réduit respecté, pas de débordement, pincement et tap-tooltip inchangés), puis
   **validation manuelle par l'utilisateur sur un vrai téléphone** (lisibilité, fluidité) —
   condition du merge.

## 10. Hors périmètre

Noms de mers/océans, régions, lacs nommés, noms de fleuves ; clic sur une étiquette ;
recherche de ville ; langues autres que le français ; valeur du vent dans l'étiquette ;
GeoNames ; fleuves dans les tuiles ; mise à jour automatique des données Natural Earth.
