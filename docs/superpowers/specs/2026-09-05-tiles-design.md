# Spec — Pyramide de tuiles, filtre température, domaine

**Date :** 2026-09-05 · **Statut :** validée en brainstorming, à planifier
**Périmètre :** sous-projet 3. Remplace l'ancienne « spec 3 relief » : l'ombrage du
relief arrive ici par les tuiles ; le déplacement 3D des sommets reste hors
périmètre. Les filtres multiples (vent, nuages…) et les étiquettes (villes, pays)
sont reportés en spec 4.

## 1. Objectif

Trois défauts constatés sur le site en ligne (2026-09-05) :

1. **Blue Marble floue** au zoom : texture 4096×2048 = 11 px/degré, agrandie ×3 dès
   qu'on cadre l'Europe.
2. **Heatmap pixelisée** : grille GFS 0,25° lue en bilinéaire natif → losanges
   visibles de près.
3. **Transparence trompeuse** : `mix(satellite, chaleur, 0,85)` laisse passer le sable
   clair du Sahara et la forêt sombre d'Europe ; deux zones à même température n'ont
   pas la même teinte. Impossible aussi de distinguer mer et terre sous la heatmap.

Cible : le comportement de Ventusky (audit du 2026-09-05, §11) sur un globe 3D :
couleur de température **à 100 %**, terre distinguée de la mer par un **masque gris
ombré par le relief**, **frontières** blanches, fond net jusqu'à un zoom d'environ
**2° de large à l'écran** (≈ 700 px/degré, 150 m/pixel, « zoom Normandie »).
Le zoom ville (Cherbourg) n'est pas visé.

Moyen : une **pyramide de tuiles géodésiques** pré-générées sur GitHub Actions,
hébergées sur R2 derrière un **domaine personnalisé**, rendues par un **quadtree de
patches** dans Three.js, avec une lecture **bicubique** de la heatmap et un bouton
**« Température »** qui remplace le curseur d'opacité.

## 2. Pyramide et formats de tuiles

### Découpage géodésique

Tuiles en lon/lat (comme la heatmap et la sphère : pas de reprojection, pôles gérés),
**512 px** de côté. Au niveau `z` : `2^(z+1)` colonnes × `2^z` lignes, chaque tuile
couvre `180 / 2^z` degrés. Colonne `x` depuis −180° vers l'est, ligne `y` depuis +90°
vers le sud :

```
lon_min = -180 + x · 180 / 2^z      lon_max = lon_min + 180 / 2^z
lat_max =   90 - y · 180 / 2^z      lat_min = lat_max - 180 / 2^z
```

Niveau 0 = 2 tuiles de 180°. Résolution : niveau 5 ≈ 91 px/degré, niveau 8 ≈
728 px/degré. Tier `high` : niveaux 0–8 ; tier `low` : 0–7.

Ces formules sont implémentées **deux fois**, `tiler/grid.py` et
`web/src/tiles/grid.ts`, et testées avec les **mêmes nombres** (même règle que
`sampling.ts` ↔ shader). Valeurs de contrôle : niveau 0, tuile (1, 0) = lon 0..180,
lat −90..90 ; niveau 8, tuile (254, 57) = lon −1,40625..−0,703125, lat
49,21875..49,921875 (est du Cotentin) ; tuile contenant (lon −1,62, lat 49,64) au
niveau 8 = (253, 57).

### Jeux de tuiles

Sous `tiles/v1/` dans le bucket `worldtemp`. Toute modification de contenu ou de
format → `tiles/v2/` (les tuiles sont servies `immutable`, un an).

| Jeu | Contenu | Niveaux | Volume estimé |
|---|---|---|---|
| `sat/{z}/{x}/{y}.jpg` | Blue Marble RGB, JPEG qualité 85. Source NASA BMNG 21600×10800 (60 px/degré, native au niveau 5). | 0–5 | 2 730 tuiles ≈ 160 Mo |
| `map/{z}/{x}/{y}.png` | PNG RGB 8 bits, 3 canaux de données : **R** ombrage du relief (128 = plat : `gdaldem hillshade -alt 30`, car 255·sin 30° = 127,5 ; azimut 315°), **G** masque terre anti-aliasé (0 mer et lacs, 255 terre), **B** intensité de frontière (0..255, trait ≈ 1,5 px à chaque niveau). | 0–8 | ≈ 50 000 tuiles terre ≈ 750 Mo |

- Une tuile `map` dont les canaux G et B sont **nuls partout** (océan pur) n'est **pas
  générée**. L'index (ci-dessous) l'indique ; le client la rend en océan uniforme
  sans requête.
- Mer plate : pas de bathymétrie, R = 128 sur l'eau. La teinte de température reste
  pure sur l'eau.
- Pas de canal alpha, pas de palette : les trois canaux sont des données, lues
  `NoColorSpace` côté client, comme la heatmap.

### Index et manifeste

- `tiles/v1/index.bin` : pour chaque niveau 0..8 du jeu `map`, une carte de bits en
  ligne (`y` majeur, `x` mineur), 1 = tuile présente. En-tête : magic `WTIX`, version
  `1` (u8), niveau max (u8), puis les cartes concaténées, chacune arrondie à l'octet.
  Taille ≈ 22 Ko. Le jeu `sat` est complet, pas d'index.
- `tiles/v1/manifest.json` :

```json
{
  "schema_version": 1,
  "tile_size": 512,
  "sets": {
    "sat": { "ext": "jpg", "max_level": 5 },
    "map": { "ext": "png", "max_level": 8, "index": "index.bin" }
  },
  "generated_at": "2026-09-06T14:00:00Z",
  "sources": ["NASA BMNG", "GEBCO 2026", "OpenStreetMap land polygons (ODbL)", "Natural Earth 10m"]
}
```

Le client ne suppose rien de ces valeurs (même principe que `latest.json`).

### Sources

| Donnée | Source | Licence | Note |
|---|---|---|---|
| Satellite | NASA Blue Marble Next Generation, 21600×10800 (Visible Earth 73776, `world.topo.bathy.200408.3x21600x10800.png`, 190 Mo) | domaine public | un seul fichier PNG |
| Relief | GEBCO 2026 (dernière version), grille 15″ (≈ 450 m), zip GeoTIFF de 4,2 Go contenant 8 dalles de 90°×90° | libre | agrandi ×3 au niveau 8, lissé |
| Côtes, lacs | OSM land polygons (`land-polygons-split-4326`, osmdata.openstreetmap.de) | ODbL | attribution « © OpenStreetMap contributors » obligatoire dans l'interface |
| Frontières | Natural Earth 10 m `admin_0_boundary_lines_land` | domaine public | pays seulement, pas de régions |

Sources non commerciales (ex. Sentinel-2 cloudless d'EOX) **exclues** : le site
portera de la publicité.

## 3. Génération (`tiler/`, `.github/workflows/tiles.yml`)

### Workflow

`tiles.yml`, déclenchement **manuel uniquement** (`workflow_dispatch`, entrée
`version`, ex. `v1`), `concurrency: tiles` (un seul run à la fois). Matrice de
**9 jobs** parallèles sur `ubuntu-latest` (4 vCPU, 16 Go, ~14 Go de disque, 6 h max,
minutes illimitées sur dépôt public) :

- 8 jobs `map`, un par dalle GEBCO (boîtes de 90°×90° : lon −180/−90/0/90 × hémisphère
  N/S) ;
- 1 job `sat` (niveaux 0–5 depuis la Blue Marble entière) ;
- 1 job `index` après les 9 autres (`needs`), qui **assemble les 2 tuiles de niveau 0**
  depuis les 8 tuiles de niveau 1 (artefacts, océan plat si absente), fusionne les index
  partiels, écrit `index.bin` et `manifest.json`.

Un job `map` :

1. `apt install gdal-bin python3-gdal rclone` ; `pip install numpy pillow`.
2. Télécharge le zip GEBCO (4,2 Go, supprimé après extraction de sa dalle de ~1 Go par `zipfile`), les polygones terre OSM (925 Mo, découpés à la
   boîte par `ogr2ogr -clipsrc`), les lignes Natural Earth (quelques Mo).
3. Pour chaque niveau **1**–8 (une tuile de niveau 1 = une boîte ; le niveau 0 chevauche quatre boîtes), parcourt la boîte par **blocs de 8×8 tuiles** (4096² px ;
   jamais la boîte entière en mémoire). Par bloc :
   - test rapide « bloc entièrement océan » sur le masque terre rasterisé en basse
     résolution → bloc sauté avant tout autre calcul ;
   - `gdalwarp -te … -ts 4096 4096 -r cubic` du relief → `gdaldem hillshade` → canal R ;
   - masque terre : `gdal_rasterize` en 8192² puis réduction 2× (anti-aliasé) → canal G ;
   - frontières : reprojection des lignes en pixels du bloc, tracé Pillow en 2× avec
     largeur 3 px, réduction 2× → canal B (≈ 1,5 px) ;
   - découpe en 64 tuiles 512 px, PNG (`optimize`), écriture des tuiles non vides,
     bits d'index.
4. `rclone copy` vers `r2:worldtemp/tiles/{version}/map/` avec
   `--transfers 32 --header-upload "Cache-Control: public, max-age=31536000, immutable"`,
   secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
   existants (mêmes que `pipeline.yml`).
5. Index partiel publié en artefact GitHub (`index-{job}.bin`).

Durée estimée : 30 à 60 min par job. Le run entier tient largement dans les limites
(20 jobs concurrents, 6 h par job).

### Package Python `tiler/`

Même règle que `pipeline/` (approche A) : logique pure testable sous Windows, appels
GDAL isolés dans un adaptateur.

| Module | Rôle | Dépendances |
|---|---|---|
| `tiler/grid.py` | maths de tuiles (bornes, indices, tuile contenant un point, blocs) | — |
| `tiler/encode.py` | assemblage des canaux R/G/B, index binaire (écriture, fusion, lecture) | numpy |
| `tiler/cut.py` | découpe d'un bloc en tuiles, détection de tuile vide, écriture PNG/JPEG | numpy, Pillow |
| `tiler/borders.py` | tracé des lignes de frontières en pixels de bloc (supersamplé) | Pillow |
| `tiler/gdal_adapter.py` | `gdalwarp`, `gdaldem`, `gdal_rasterize`, `ogr2ogr` via `subprocess` | GDAL (Actions) |
| `tiler/sat.py` | pyramide satellite depuis l'image BMNG (réduction par niveau, découpe) | Pillow |
| `tiler/main.py` | CLI : `--set map --box N --version v1 --out DIR`, `--set sat …`, `--merge-index` | — |

`tools/history_check.py` surveille `tiler/` comme `pipeline/` et `web/`.

## 4. Diffusion (domaine, R2, Worker)

Constat : `pub-….r2.dev` est documenté par Cloudflare comme **limité en débit et
réservé au développement**. Acceptable pour un `latest.png` par visiteur, pas pour
50 à 200 tuiles par visiteur qui zoome. Choix : **domaine personnalisé**.

- **Geste manuel de l'utilisateur** : acheter le domaine au Cloudflare Registrar
  (dashboard ; la zone DNS est créée automatiquement). Le nom est noté `<domaine>`
  dans cette spec et fixé dans le plan quand il est connu.
- **Bucket `worldtemp` → `data.<domaine>`** : domaine personnalisé R2 posé par l'API
  (`PUT /accounts/{id}/r2/buckets/worldtemp/domains/custom`). Sert `gfs/latest.*` et
  `tiles/v1/…` à travers le CDN Cloudflare : tuiles `immutable` en cache de
  périphérie, `latest.*` garde `max-age=300`. Une fois le front basculé, l'URL
  `r2.dev` est **désactivée** (une seule adresse publique).
- **Worker `worldtemp` → `<domaine>`** : `routes: [{ "pattern": "<domaine>",
  "custom_domain": true }]` dans `web/wrangler.jsonc`, appliqué par le job `deploy`.
  `www.<domaine>` redirigé 301 vers la racine (règle de redirection Cloudflare, par
  API). `workers.dev` conservé pendant la transition puis coupé (`"workers_dev":
  false`) : une seule URL canonique.
- **CORS du bucket** : origine `https://<domaine>` ajoutée (les tuiles deviennent des
  textures WebGL, `crossOrigin = "anonymous"` obligatoire) ; `http://localhost:5173`
  conservé ; l'origine `workers.dev` retirée à la coupure.
- **Front** : `config.ts` — `DATA_BASE_URL` = `https://data.<domaine>/gfs`,
  `TILES_BASE_URL` = `https://data.<domaine>/tiles/v1`, tous deux surchargeables par
  `VITE_*`. Au démarrage le client lit `manifest.json` puis `index.bin`.
- **Secrets** : aucun nouveau.

## 5. Moteur de tuiles (`web/src/tiles/`)

Approche retenue : **quadtree de patches** (schéma Cesium / Google Earth). Le globe
n'est plus une sphère unique : chaque tuile visible est un petit maillage sphérique
avec ses textures. Alternatives écartées : texture virtuelle (clipmap : déformation
aux hautes latitudes, antiméridien, recomposition sur canvas à chaque déplacement) ;
Cesium (~2,5 Mo de JS, composition heatmap × ombrage impossible dans ses couches
d'imagerie, abandon du travail Three.js).

| Module | Rôle | Testable en Vitest |
|---|---|---|
| `tiles/grid.ts` | miroir de `tiler/grid.py` : bornes, parent, enfants, tuile d'un point | oui, mêmes nombres |
| `tiles/manifest.ts` | lecture et validation de `manifest.json` | oui |
| `tiles/index.ts` | lecture de `index.bin`, `has(z, x, y)` | oui |
| `tiles/lod.ts` | sélection des feuilles à afficher pour une caméra donnée | oui (caméras synthétiques) |
| `tiles/loader.ts` | file de priorité, téléchargement, annulation, cache LRU par budget | oui (`fetch` simulé) |
| `tiles/patch.ts` | géométrie d'un patch (grille, jupes, attributs lon/lat) | oui |
| `render/globe.ts` | groupe de patches, matériau partagé, uniforms par patch | à l'œil |

### Sélection (`lod.ts`)

Exécutée seulement quand la caméra a bougé ou qu'une tuile vient d'arriver (le rendu
reste **à la demande**, spec 2 §4). Parcours depuis les 2 racines :

1. **Hors champ** : sphère englobante du patch contre le frustum → écartée.
2. **Sous l'horizon** : tuile écartée si tous ses coins sont au-delà du limbe
   (`dot(normale_coin, direction_caméra_depuis_coin) < 0` pour les 4 coins et le
   centre, avec marge d'un demi-patch).
3. **Descente** : si la tuile projetée à l'écran dépasse `512 · k` px
   (`k` = 1 en `high`, 1,5 en `low`) et `z < niveau max du tier` → examiner ses
   4 enfants ; sinon la tuile est une feuille.

Taille projetée = diagonale géodésique de la tuile (en unités de sphère) rapportée à
la distance caméra–centre de tuile et à la hauteur du viewport en pixels.

### Chargement (`loader.ts`)

- Les feuilles sélectionnées **et leurs ancêtres** sont demandés (raffinement progressif,
  jamais d'écran vide) ; file de priorité : niveau grossier d'abord, puis distance au
  centre de l'écran.
- Concurrence : 8 en `high`, 4 en `low`. `fetch` + `createImageBitmap`
  (`colorSpaceConversion: "none"` pour `map`, `imageOrientation: "flipY"` comme la
  heatmap), textures avec mipmaps et anisotropie pour `sat`, mipmaps sans anisotropie
  pour `map`.
- Annulation (`AbortController`) quand la tuile sort de la sélection avant d'être
  arrivée.
- Échec réseau ou décodage : 2 nouvelles tentatives (2 s, 8 s), puis marquage
  « en échec » jusqu'à ce que la tuile ressorte puis rentre dans la sélection.
- **Cache LRU par budget mémoire GPU** : 256 Mio en `high`, 96 Mio en `low` (une
  texture 512² RGBA avec mipmaps ≈ 1,4 Mio). Évince les tuiles hors sélection les
  moins récemment vues ; jamais une tuile affichée ni un ancêtre servant de repli.
  `dispose()` de la texture et `close()` du bitmap à l'éviction (dette n° 12 respectée).

### Patches (`patch.ts`, `globe.ts`)

- Grille **32×32** (16×16 en `low`) plaquée sur la sphère unité, **jupes** de
  profondeur `0,5 %` du côté de tuile pour masquer les fissures entre niveaux
  voisins. Attributs : position, normale, `uv` (0..1 dans la tuile), `lonlat`
  (degrés). Géométrie créée à la demande (33×33 sommets, négligeable) et libérée
  avec la tuile.
- Un seul `ShaderMaterial` partagé ; par patch, les uniforms sont portés par le mesh
  (`onBeforeRender` ou un matériau cloné léger) : `uSat`, `uSatRect`, `uMap`,
  `uMapRect`, `uHasMap`.
- **Repli sur l'ancêtre** : une feuille sélectionnée dont la texture n'est pas
  arrivée affiche la texture de son **meilleur ancêtre chargé**, avec le
  sous-rectangle UV correspondant (`uSatRect`/`uMapRect` = offset + échelle). Pas de
  trou, pas de fondu. Les ancêtres ne sont jamais rendus en même temps que leurs
  descendants (pas de z-fighting).
- Le jeu `sat` s'arrête au niveau 5 : au-delà, `uSat` porte toujours l'ancêtre de
  niveau 5 (magnifié), le style carte (§6) prend le relais visuellement.

### Caméra (`render/scene.ts`)

- `minDistance` = **1,042** (2° de large à l'écran pour un FOV vertical de 45°),
  `maxDistance` 4 inchangé.
- Plans `near` / `far` recalculés à chaque changement : `near = max(0,002,
  (d − 1) · 0,3)`, `far = d + 2`, où `d` est la distance caméra–centre.
- `rotateSpeed` proportionnel à l'altitude `(d − 1)` (borné), sinon ingérable de
  près ; `zoomToCursor = true`.

### Tiers

| | `high` | `low` |
|---|---|---|
| Niveau max `map` | 8 | 7 |
| Grille de patch | 32×32 | 16×16 |
| Budget tuiles GPU | 256 Mio | 96 Mio |
| Téléchargements simultanés | 8 | 4 |
| Seuil de descente `k` | 1 | 1,5 |
| Pixel ratio (spec 2) | 2 | 1,5 |

`SphereGeometry` et les segments `768×384` / `256×128` de la spec 2 disparaissent.

## 6. Shader des patches et composition

Entrées par fragment : `sat` RGB (sRGB décodée par le GPU), `map` (R ombrage,
G terre, B frontière, `NoColorSpace`), heatmap globale + LUT (spec 2, inchangées),
uniforms `uFilter` (0/1), `uMapStyle` (0..1), `uLightDir`.

### Heatmap bicubique

`t` est lu en **bicubique Catmull-Rom** via **9 prélèvements bilinéaires** (Catmull-Rom
« 9 taps ») sur `uHeatmap`, en coordonnées de grille cellulaire de la spec
pipeline §4 (formule `heatmapUv` conservée, appliquée au centre des 4 prélèvements).
`sampling.ts` reste bilinéaire : il sert aux lectures ponctuelles (tooltip, spec 4),
le lissage visuel est une affaire de rendu.

### Filtre température actif (`uFilter = 1`)

```glsl
vec3 heat  = texture2D(uLut, vec2(t, 0.5)).rgb;           // couleur à 100 %
float shade = map.r;                                       // 0,5 = plat
float land  = map.g;
float tone  = 0.8 + 0.6 * (shade - 0.5);                   // terre : 0,5 .. 1,1
vec3 color  = heat * mix(1.0, tone, land);                 // mer : teinte pure
color = mix(color, vec3(1.0), map.b * 0.7);                // frontières blanches
color *= 0.85 + 0.15 * lambert;                            // limbe à peine assombri
```

Deux zones à même température ont la **même teinte** ; la terre est ~20 % plus
sombre que la mer et modulée ±30 % par le relief ; jamais de mélange avec la Blue
Marble.

### Filtre inactif (`uFilter = 0`)

`uMapStyle` est calculé côté TS depuis la distance caméra : 0 au-dessus de
`d = 1,25`, 1 en dessous de `d = 1,12`, linéaire entre (fondu autour du niveau 5, pas
de bascule brutale).

```glsl
vec3 satCol = texture2D(uSat, satUv).rgb * (0.25 + 0.75 * lambert);   // spec 2
vec3 mapCol = mix(vec3(0.72, 0.80, 0.88),                              // mer bleu clair
                  vec3(0.85, 0.83, 0.78) * tone,                       // terre beige × ombrage
                  land);
vec3 color  = mix(satCol, mapCol, uMapStyle);
color = mix(color, vec3(1.0), map.b * mix(0.35, 0.7, uMapStyle));      // frontières, discrètes sur le satellite
```

Cas sans tuile `map` (`uHasMap = 0`, océan pur ou repli) : `shade = 0,5`, `land = 0`,
`map.b = 0`.

`#include <colorspace_fragment>` reste obligatoire en fin de fragment (spec 2 §4).

## 7. Interface (`ui/overlay.ts`, `index.html`)

- Le curseur `#opacity` **disparaît** (et `setOpacity`, `onOpacity`,
  `initialOpacity`). À sa place un bouton **`#filter-temperature`** « Température »,
  `aria-pressed`, **actif par défaut**, dans le panneau `#controls`. Il pilote
  `uFilter`. Le menu de filtres multiples (spec 4) le remplacera.
- Légende affichée seulement quand le filtre est actif.
- Ligne d'attribution dans le bandeau, petite : « © OpenStreetMap contributors ·
  NASA · GEBCO · Natural Earth » (ODbL).
- Inchangés : bandeau de fraîcheur, statut, repli des panneaux, `#ad-slot`, `#fatal`.

## 8. Gestion d'erreurs (navigateur)

Règle inchangée : **le globe s'affiche toujours** ; aucune exception non attrapée.

| Situation | Comportement |
|---|---|
| `manifest.json` ou `index.bin` indisponibles ou invalides | Globe au niveau 0 avec la Blue Marble 4K locale (`/textures/blue-marble-4k.jpg`, conservée pour ce repli seulement) en `uSat` sur les 2 racines, filtre et heatmap fonctionnels, statut « Détail de la carte indisponible », nouvel essai avec le cycle de 15 min des données |
| Tuile en échec réseau ou indécodable | Ancêtre conservé, 2 nouvelles tentatives (2 s, 8 s), puis abandon jusqu'au retour de la tuile dans la sélection |
| Tuile `map` absente de l'index | Océan uniforme (`uHasMap = 0`), aucune requête |
| Budget mémoire dépassé | LRU évince les tuiles hors sélection ; jamais une tuile affichée ni un ancêtre de repli |
| Heatmap indisponible avec filtre actif | `uHasHeatmap = 0` → style carte sans couleur (gris neutre × ombrage), statut existant « Données indisponibles… » |
| `webglcontextlost` | Inchangé (écran fatal, rechargement) |
| Tuile arrivée après que la vue a changé | Mise en cache, pas de rendu forcé si hors sélection |

## 9. Budget

- Premier chargement **< 2 Mo** : JS, `manifest.json`, `index.bin`, 2 tuiles racines
  `sat` + `map`, heatmap. La Blue Marble 4K n'est plus chargée qu'en repli.
- ≤ 120 patches rendus (typiquement 20 à 60), un appel de dessin par patch.
- 60 fps sur desktop, ≥ 30 fps sur mobile `low`.
- Stockage R2 ≈ 1 Go (plan gratuit : 10 Go), écritures ≈ 55 000 une fois (1 M/mois),
  lectures cachées en périphérie par le domaine personnalisé.

## 10. Tests

- **pytest `tests/test_tiler_*.py`** : `grid` (bornes, indices, nombres de contrôle
  §2), `encode` (canaux, index : écriture → fusion → lecture, arrondi à l'octet),
  `cut` (bloc synthétique 2×2 tuiles : découpe, tuile vide sautée, bits d'index),
  `borders` (une ligne tracée donne des pixels non nuls sur son passage,
  anti-aliasés), `sat` (niveaux d'une image synthétique). Adaptateur GDAL testé
  **réellement sur Actions** contre une mini-boîte (GeoTIFF de fixture 2°×2°,
  quelques polygones), `skipUnless` sous Windows (dette n° 2 étendue, même
  approche).
- **Vitest `web/tests/`** : `grid` (mêmes nombres que Python), `manifest`
  (validation, rejets), `index` (lecture, `has`), `lod` (caméras synthétiques : vue
  globale → 2 racines ou leurs enfants, vue Normandie → feuilles de niveau 8
  attendues, tuiles derrière l'horizon écartées), `loader` (ordre de priorité,
  annulation, tentatives, éviction LRU par budget, protection des tuiles affichées),
  `patch` (nombre de sommets, jupes, lon/lat des coins).
- **Rendu vérifié à l'œil** (DevTools MCP, comme en spec 2) : coutures entre
  niveaux, zoom Normandie, filtre on/off, fondu `uMapStyle`, tier `low`.
- `history_check` sur `tiler/`, `web/`, `pipeline/`.

## 11. Audit Ventusky (2026-09-05) — référence

Constaté par inspection réseau et script (`static.ventusky.com/media/script-fr.js`) :

- Moteur Canvas 2D maison (5 canvas empilés), carte plate Web Mercator, tuiles XYZ
  512 px. Aucune bibliothèque cartographique, pas de WebGL.
- Données météo : un JPEG **niveaux de gris 8 bits** par variable, modèle et heure
  (ICON global 720×360 soit 0,5°, ICON-EU 400×240, tuiles `tilled_world` 275×220 au
  zoom élevé ; vent = 2 JPEG u/v), cache 6 h. Lissage par
  `imageSmoothingQuality = "high"`. Résolution **inférieure** à notre GFS 0,25°.
- Fond : tuiles statiques de 2019 — `land` (masque gris + ombrage + lacs, mer
  blanche), `border` (frontières blanches), `cities` (JSON villes avec population),
  `countries_regions/fr` (noms de pays). Au-delà du zoom ~11, tuiles raster type
  OpenStreetMap (`map.ventusky.com`, zooms 7–19). Pas de satellite en fond.
- Composition : couleur à 100 % assombrie par le gris de la terre ; mer en teinte
  pure ; frontières par-dessus.

## 12. Critères d'acceptation

1. `tiles.yml` vert ; `manifest.json`, `index.bin`, ≈ 50 000 tuiles `map` et 2 730
   `sat` sur `https://data.<domaine>/tiles/v1/`, volume total < 1,5 Go.
2. Zoom Normandie (≈ 2° de large) : côtes, frontières et relief nets, aucun pixel
   visible, ≥ 30 fps sur desktop.
3. Filtre actif : Sahara et Europe à même température → même teinte (contrôle d'une
   capture contre la LUT) ; mer, terre et frontières lisibles.
4. Aucun losange bilinéaire visible sur la heatmap au zoom max.
5. Tuiles coupées (blocage réseau de `data.<domaine>/tiles`) → globe utilisable au
   niveau 0 avec statut ; rétablies → tuiles reviennent sans rechargement.
6. Téléphone tier `low` : navigation fluide, niveau 7 max, < 100 Mio de tuiles GPU.
7. Site sur `https://<domaine>`, données sur `https://data.<domaine>`, `r2.dev` et
   `workers.dev` coupés, CORS vérifié (`access-control-allow-origin` sur une tuile
   et sur `latest.json`).
8. Premier chargement < 2 Mo (onglet réseau, cache vide).
9. pytest, Vitest, `history_check` verts.

## 13. Hors périmètre

- Déplacement 3D des sommets par heightmap (relief en volume), atmosphère,
  auto-rotation.
- Filtres multiples (vent, nuages, humidité, pression, qualité de l'air…) et le
  menu de couches façon Ventusky → spec 4.
- Étiquettes de villes et de pays → spec 4.
- Tooltip de température (utilisera `sampling.ts::heatmapUv`) → spec 4.
- Zoom ville (Cherbourg, > niveau 8), fond type OpenStreetMap, bathymétrie.
- Tuiles de données météo (heatmap tuilée), modèle plus fin que GFS 0,25° (ICON).
- Régions administratives (admin-1), routes, rivières.
