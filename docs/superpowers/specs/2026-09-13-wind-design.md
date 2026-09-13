# Spec — Vent animé (lot B2) : champ U/V 10 m, particules sur le globe

**Date :** 2026-09-13 · **Statut :** validée en brainstorming, à planifier
**Périmètre :** sous-projet 4, lot B2 « vent animé ». Pipeline (deux champs de plus),
contrat de données (aucun changement de schéma), front (simulation CPU, rendu
`LineSegments`, interrupteur, tooltip). Les étiquettes villes/pays (lot C) restent au
backlog. Première tâche : retrait de `gfs/latest.*` (dette n° 31 de HISTORY §8).

## 1. Objectif

Le globe affiche sept couches scalaires, une à la fois. Cette spec ajoute le **vent à
10 m animé par particules**, en **surimpression combinable** avec n'importe quelle
couche (ou avec le globe nu), façon Windy : des traînées blanches glissent sur le
satellite, sombres sur le style carte, et le tooltip gagne une ligne « Vent 23 km/h NO ».

Décisions prises en brainstorming (ne pas rouvrir) :

- **surimpression combinable** (interrupteur indépendant du radio des couches), pas une
  8e couche exclusive ni une couche scalaire « vitesse du vent » ;
- **10 m seulement** ; les niveaux de pression (850, 500, 250 hPa) pourront s'ajouter
  plus tard sans changer le contrat (deux entrées de plus par niveau) ;
- **animé partout, densité par tier** ; actif par défaut en tier `high`, inactif en
  `low` et sous `prefers-reduced-motion` ; `?wind=1|0` force ;
- **tooltip en km/h + direction d'où vient le vent**, rose à 16 points en français ;
- **approche A** (simulation CPU + `LineSegments`) plutôt que B (particules GPU
  ping-pong + traînées écran, style earth.nullschool) ou C (flèches statiques) — §2.

## 2. Approche retenue

**A — simulation CPU, traînées de K positions glissantes, un `LineSegments`.** N
particules (lon, lat) avancées en JavaScript à chaque tick à partir des pixels U/V lus
côté CPU (le même tampon que le tooltip). Chaque particule garde K positions passées ;
un seul `LineSegments` dessine toutes les traînées, alpha décroissant vers la queue.
Toute la logique (advection, spawn, respawn, échelle de vitesse) est pure et testée en
Vitest ; le rendu est validé à l'œil via DevTools MCP, comme le reste du projet.

Écartées :

- **B — particules GPU ping-pong + traînées écran** (earth.nullschool) : le plus beau
  en 2D, mais sur un globe qui tourne il faut effacer les traînées à chaque mouvement
  de caméra (le fondu écran bave), `EXT_color_buffer_float` à négocier sur mobile,
  rien de testable hors navigateur, revue plus lourde.
- **C — flèches ou barbules statiques** : pas d'animation, contraire au backlog.

Contrat de données : **deux entrées scalaires** `wind_u` / `wind_v` dans le manifeste
v2 existant, plutôt qu'un PNG RGB (R = U, G = V) qui aurait imposé un nouveau format
côté pipeline et front pour le même poids.

Fichiers touchés :

```
pipeline/
  layers.py         # +2 LayerSpec : wind_u, wind_v (UGRD/VGRD 10 m)
  metadata.py       # build_legacy supprimé
  main.py           # objets legacy supprimés
  config.py         # LEGACY_* supprimés
tests/fixtures/
  gfs_wind.grib2    # NOUVEAU : vrai fichier filtré, UGRD + VGRD 10 m (≈ 1 Mo)
tests/pipeline/     # registre, URL, quantification, dry-run 9 couches, décodage réel
web/src/
  wind/
    sim.ts          # NOUVEAU : simulation pure (état, advection, spawn, respawn, tampon)
    select.ts       # NOUVEAU : ?wind=, défaut par tier et reduced-motion
    loader.ts       # NOUVEAU : WindLoader (pixels CPU des deux PNG, pas de texture)
    controller.ts   # NOUVEAU : cadence 30 Hz, vue courante, pousse le tampon
  render/
    wind.ts         # NOUVEAU : LineSegments + ShaderMaterial
    shaders/wind.vert.glsl, wind.frag.glsl  # NOUVEAUX
    scene.ts        # onFrame(cb)
  ui/
    wind-toggle.ts  # NOUVEAU : bouton role="switch"
    layers-menu.ts  # radiogroup sur un div interne, plus sur #controls
    tooltip.ts      # setWind(), deuxième ligne
    format.ts       # formatWind(u, v)
  main.ts           # câblage : loader, contrôleur, switch, URL, tooltip
  style.css         # switch, tooltip deux lignes
web/index.html      # #controls : div radiogroup + switch
```

## 3. Registre de couches (`pipeline/layers.py`)

Deux `LayerSpec` ajoutés, tout le reste réutilisé (`layer_pixels`, `layer_entry`,
`encode_png`, report, manifeste) :

| id | source | `nomads_var` | `nomads_lev` | clés eccodes | convert | plausible (brut) | `Encoding` |
|---|---|---|---|---|---|---|---|
| `wind_u` | `gfs` | `UGRD` | `10_m_above_ground` | `shortName=10u`, `typeOfLevel=heightAboveGround`, `level=10` | identité (m/s) | (−150, 150) | `(-60, 60, "linear")` |
| `wind_v` | `gfs` | `VGRD` | `10_m_above_ground` | `shortName=10v`, `typeOfLevel=heightAboveGround`, `level=10` | identité (m/s) | (−150, 150) | `(-60, 60, "linear")` |

`unit` = `m/s`, `variable` = `UGRD_10m` / `VGRD_10m`. Pas de quantification (8 bits sur 120 m/s) :
0,47 m/s ≈ 1,7 km/h ; les composantes au-delà de ±60 m/s (cœur d'un cyclone sur une
grille 0,25°, rarissime) saturent. `np.rint` côté Python et `Math.round` côté TS
diffèrent sur les demi-entiers : la table d'aller-retour des tests (B1) est étendue aux
valeurs négatives sans `.5`.

Le filtre NOMADS reçoit `var_UGRD`, `var_VGRD` et `lev_10_m_above_ground` en plus ;
le produit var × niveau ajoute quelques messages superflus (≈ 2 Mo de plus par
téléchargement), ignorés par `decode_fields`. Même fichier GFS que `temp` : même run,
même échéance, garantis par construction.

## 4. Contrat `layers/latest.json` — inchangé (schema_version 2)

Deux entrées de plus, `wind_u` et `wind_v`, au format `LayerEntry` de la spec couches
§7 (`model`, `variable`, `unit`, `run`, `forecast_hour`, `valid_time_utc`,
`generated_at`, `texture`, `encoding`, `stats`). Deux PNG 8 bits de plus :
`layers/wind_u.png`, `layers/wind_v.png`. Les clients déjà chargés ignorent les entrées
qu'ils ne connaissent pas ; côté front, `orderedLayers` ne liste que le registre, donc
`wind_*` n'apparaît jamais dans le radio et `?layer=wind_u` retombe sur `temp`.

## 5. Retrait de `gfs/latest.*` (dette n° 31)

Première tâche du plan : suppression de `build_legacy`, des clés `LEGACY_PNG_KEY` /
`LEGACY_JSON_KEY`, de la branche `if "temp" in pngs` de `main.py` et de leurs tests ;
`test_main` vérifie que les objets publiés sont exactement les PNG des couches fraîches
plus le manifeste. Les objets `gfs/latest.png` et `gfs/latest.json` encore sur R2 sont
supprimés à la main après déploiement (API Cloudflare, comme pour `r2.dev`).

## 6. Fixture et décodage réel

Le poste Windows ne décode pas de GRIB (dette n° 2). Nouvelle fixture
`tests/fixtures/gfs_wind.grib2` : téléchargée une fois à la main via
`filter_gfs_0p25_1hr.pl?var_UGRD=on&var_VGRD=on&lev_10_m_above_ground=on` (≈ 1 Mo),
commitée ; **`gfs_layers.grib2` et `gefs_chem.grib2` ne sont pas retéléchargés ni
recommités**. Test réel sur Actions (`skipUnless eccodes`) : `decode_fields(data,
[wind_u, wind_v])` renvoie deux champs 721 × 1440, `lat[0] = 90`, `lon[0] = 0`, unités
`m s**-1`, plage plausible ; le module (√(u²+v²)) maximal reste < 80 m/s.

## 7. Simulation (`web/src/wind/sim.ts`, pure)

**Entrée** : `WindField = { u, v: Uint8ClampedArray, grid, encU, encV }` — pixels RGBA
nord en haut des deux PNG (`bitmapPixels`), encodages du manifeste. Échantillonnage par
`sampleValue(pixels, grid, enc, lon, lat)` de `data/sampling.ts` (bilinéaire, bouclage
en longitude), un appel par composante et par particule.

**Paramètres par tier** (`WIND_PROFILE`) :

| tier | N particules | K positions | tick |
|---|---|---|---|
| `high` | 12 000 | 12 | 30 Hz |
| `low` | 3 000 | 8 | 30 Hz |

**État** : `lon`, `lat`, `age`, `life` (Float32/Uint16 par particule) ; tampon de
positions `Float32Array(K · N · 3)` **slot-major** `[slot][particule][xyz]`, slot 0 =
queue, slot K−1 = tête.

**Tick** (`step(dtS, view, pick, rng)`) — dt borné à 0,1 s :

1. `copyWithin(0, N·3)` : les slots 1…K−1 glissent vers 0…K−2 (une seule copie mémoire).
2. Pour chaque particule : `u`, `v` échantillonnés (m/s) ; `dlat = v · S · dt`,
   `dlon = u · S · dt / cos(lat)` ; `lon` bouclée dans [−180, 180) ; `age++`.
3. **Respawn** si `age > life`, `|lat| > 85°`, `√(u²+v²) < 0,5 m/s` (figée), ou point
   hors du champ visible (test horizon `dot(P̂, Ĉ) < 1/|C|` puis `frustum.containsPoint`).
   Nouvelle position par **tirage uniforme à l'écran** : `(x, y)` en NDC, `pick(x, y)`
   (injecté ; en production `pickSphere` de `render/pick.ts`) ; `null` = hors globe →
   nouveau tirage, 8 essais max, sinon la particule garde sa position et `age = 0`.
   `life` tirée dans [60, 120] ticks. Les **K slots** de la particule reçoivent la
   nouvelle position (segments de longueur nulle, invisibles).
4. Sinon, seul le slot K−1 reçoit `lonLatToVec3(lon, lat) · 1,002`.

**Échelle de vitesse** `speedScale(view, P)` : degrés par seconde par m/s tels que la
vitesse apparente à l'écran ne dépende pas de l'altitude :
`S = P · 2 · (d − 1) · tan(fov/2) · (180/π) / hauteurViewport`, avec `d = |C|`,
`P = 2 px/s par m/s` (20 m/s → 40 px/s). Aucune remise à zéro globale au mouvement de
caméra : les particules sorties de la vue se respawnent, la densité se recale en une
durée de vie.

**Sortie** : le tampon complet, envoyé au GPU à chaque tick (§8). `rng` est injecté
(`Math.random` en production, séquence déterministe en test).

## 8. Rendu (`web/src/render/wind.ts`) et boucle (`render/scene.ts`)

**Géométrie** : un `LineSegments`, `BufferGeometry` avec :

- `position` : `Float32BufferAttribute(K · N · 3)`, `DynamicDrawUsage`, **upload complet
  à chaque tick** (1,7 Mo en `high`, 0,3 Mo en `low`, à 30 Hz) — pas d'`updateRange` ;
- `aAlpha` : attribut statique, `slot / (K − 1)` (0 à la queue, 1 à la tête) ;
- index statique `Uint32` : pour chaque particule p et slot k < K−1, le segment
  (k, p) → (k+1, p) ; N · (K−1) segments, aucun segment de bouclage.

**Matériau** : `ShaderMaterial` `transparent`, `depthTest: true`, `depthWrite: false`,
`renderOrder = 1` ; positions à rayon 1,002 au-dessus des patches (rayon 1, le relief
est un ombrage, pas un déplacement) : le globe masque la face cachée. Fragment :
`color = mix(vec3(1.0), vec3(0.15), uMapStyle)`, `alpha = vAlpha · 0.8`. Largeur 1 px
(limite WebGL). `uMapStyle` est posé par le même `mapStyleFor(d)` que le globe.

**Boucle** : `SceneHandle.onFrame(cb: (nowMs: number) => boolean)` ; la boucle rAF
appelle chaque callback avant `controls.update()` et rend si l'un renvoie `true`. Le
contrôleur (`wind/controller.ts`) accumule le temps, exécute un tick quand ≥ 33 ms se
sont écoulées (30 Hz), recalcule `viewStateFrom(camera, hauteur)` à chaque tick (µs),
pose `position.needsUpdate` et renvoie `true`. Vent inactif → contrôleur désinscrit →
**0 draw call au repos conservé**. Onglet caché : rAF s'arrête ; au retour, dt borné à
0,1 s. `webglcontextlost` arrête le contrôleur.

**Chargement** (`wind/loader.ts`) : `WindLoader.load(entryU, entryV, grid)` réutilise
`fetchBitmap`, `bitmapPixels`, `textureUrl`, `needsTextureFetch` de `data/loader.ts` ;
les PNG **ne deviennent jamais des textures GPU**, seuls les deux tableaux RGBA (8 Mo)
sont gardés, hors du LRU des couches. Chargement paresseux : rien n'est téléchargé
tant que le vent est inactif ; rafraîchi quand `generated_at` change et que le vent
est actif ; les deux PNG sont remplacés ensemble (jamais un U neuf avec un V ancien).
`bitmapPixels` → `null` sur l'un des deux = échec (§11).

## 9. Interrupteur, URL, état initial

**DOM** (`index.html`, `ui/layers-menu.ts`, `ui/wind-toggle.ts`) : `#controls` contient
un `div` portant `role="radiogroup"` (le menu actuel, inchangé par ailleurs) puis un
bouton `role="switch"` « Vent », `aria-checked`, désactivé (`disabled`) si le manifeste
n'a pas `wind_u` et `wind_v` ou si leur chargement a échoué.

**État initial** (`wind/select.ts`, pur) :
`parseWindParam(search, tier, reducedMotion)` : `?wind=1` → actif, `?wind=0` → inactif ;
sinon `reducedMotion` → inactif ; sinon `high` → actif, `low` → inactif.
`withWindParam(search, on)` réécrit seulement `wind` (`1`/`0`), résultat préfixé `?`,
indépendant de `layer`. Basculer appelle `history.replaceState`, sans rechargement.

## 10. Tooltip

Deuxième ligne « Vent 23 km/h NO » quand le vent est actif et le champ chargé, au
survol comme au tap. `formatWind(u, v)` (`ui/format.ts`, pur) : vitesse
`round(3,6 · √(u²+v²))` km/h, direction **d'où vient** le vent (convention météo)
`dir = (270 − atan2(v, u) · 180/π) mod 360`, arrondie au point de rose le plus proche
parmi N, NNE, NE, ENE, E, ESE, SE, SSE, S, SSO, SO, OSO, O, ONO, NO, NNO (22,5° par
point, N couvre [348,75 ; 11,25[). Vitesse < 1 km/h → « Vent calme ». `Tooltip.setWind(
field | null)` ; le tooltip est visible si la couche **ou** le vent fournit une valeur
(aujourd'hui il se cache sans couche) ; sans couche, seule la ligne vent s'affiche.

Bandeau et légende inchangés (même run GFS que `temp` ; particules monochromes).

## 11. Gestion d'erreurs

| Situation | Comportement |
|---|---|
| `UGRD`/`VGRD` absents ou invraisemblables dans le GRIB | Source primaire : run en échec (exit 3), rien de publié — comme `temp` |
| Manifeste sans `wind_u`/`wind_v` | Switch désactivé, aucun téléchargement, sept couches intactes |
| PNG U ou V en échec (HTTP, taille ≠ grille, pixels illisibles) | Statut « Vent indisponible », switch désactivé, retentable au prochain `generated_at` (même mécanique `failed` que les couches) ; l'ancien champ, s'il existe, reste animé |
| `?wind=1` en tier `low` ou sous reduced-motion | Respecté (choix explicite) |
| `pickSphere` → `null` 8 fois | La particule garde sa position, `age = 0` |
| Contexte WebGL perdu | Contrôleur arrêté, écran fatal existant |
| Vent actif puis désactivé | Callback désinscrit, `LineSegments.visible = false`, pixels conservés (rafraîchis à la réactivation si `generated_at` a changé) |

## 12. Tests

**pytest** (`tests/pipeline/`) : registre à 9 specs, `wind_u`/`wind_v` sur `gfs` ;
`build_url` contient `var_UGRD`, `var_VGRD`, `lev_10_m_above_ground` sans doublon ;
quantification ±60 (−60 → 0, 0 → 128, +60 → 255, aller-retour sans `.5`) ; `test_main`
dry-run 9 couches, objets publiés = PNG frais + manifeste, plus aucun objet `gfs/` ;
`build_manifest` 9 entrées ; décodage réel de `gfs_wind.grib2` sur Actions.

**Vitest** (logique pure seulement) :

- `sim.ts` : advection nord (v > 0 → lat croît) et est ; `cos(lat)` (même u → dlon
  double à 60°) ; bouclage à 179,9° + est → −180 ; respawn pôle, hors vue, figée,
  `age > life` ; `pick` null ×8 → position conservée ; slots après respawn tous égaux ;
  tampon : après un tick, slot K−1 = nouvelle position, slots 0…K−2 = anciens décalés ;
  `speedScale` : 20 m/s → 40 px/s à d = 4 et à d = 1,1 (calcul inverse en px).
- `select.ts` : table `?wind` × tier × reduced-motion ; `withWindParam` préserve
  `layer`, `lon`, `lat`, `d`.
- `format.ts` : `formatWind` — (0, 10) → « 36 km/h S » (vient du sud), (−10, 0) → « E »,
  (0,1 ; 0) → « Vent calme », frontières de rose (11,25° → NNE), arrondi km/h.
- `render/wind.ts` : tailles des attributs, index sans segment (K−1 → 0), `aAlpha`
  0 et 1 aux extrémités.
- `controller.ts` : aucun tick sans champ ; un tick par tranche de 33 ms ; `true`
  seulement après un tick ; dt borné.
- `wind/loader.ts` : deps factices — deux fetch, remplacement atomique, `null` pixels
  = rejet, pas de refetch si `generated_at` inchangé.
- `history_check` ✓ (§3 de HISTORY nomme `web/src/wind/`).

Rendu, occlusion, vitesse apparente et draw calls : DevTools MCP (§13).

## 13. Critères d'acceptation

1. Vent actif sur `temp` et sur « Aucune » : particules blanches sur satellite, sombres
   en style carte (d < 1,14), jamais visibles à travers le globe (limbe et face cachée).
2. Vitesse apparente d'un vent de 20 m/s ≈ 40 px/s à d = 4 comme à d = 1,1 (mesure
   DevTools sur une zone de vent connu, tolérance ±25 %).
3. Tooltip vent à ±2 km/h et ±1 point de rose d'un recalcul depuis les PNG publiés.
4. Vent inactif → 0 draw call au repos (mesure 3 s) ; actif → ≤ 30 rendus/s.
5. `?wind=0` désactive sur desktop ; `?tier=low` démarre inactif ; le switch met l'URL
   à jour sans rechargement.
6. Manifeste sans `wind_*` (fichier de dry-run édité) → switch grisé, 7 couches
   intactes, aucune requête `wind_*.png`.
7. `gfs/latest.png` et `gfs/latest.json` ne sont plus écrits par le pipeline ;
   `layers/latest.json` reste en schema 2 avec 9 entrées.
8. Vitest et pytest verts, `history_check` ✓, `index-*.js` ≤ +12 Ko gzip par rapport à
   150,70 Ko ; tick `high` ≤ 4 ms mesuré sur desktop (`performance.now()` autour de
   `step`).

## 14. Hors périmètre

- Niveaux d'altitude (850, 500, 250 hPa), rafales (`GUST`), couche scalaire « vitesse
  du vent », légende de vent.
- Traits plus larges que 1 px (quads orientés), coloration des particules par vitesse.
- Étiquettes villes/pays (lot C).
- Dettes §8 de HISTORY autres que la n° 31 et celles touchées en passant.
