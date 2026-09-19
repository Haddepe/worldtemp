# HISTORY — Globe 3D des températures mondiales

> Trace de continuité du projet. Se met à jour **après chaque session**, **chaque
> exécution de plan** et **chaque modification du site** — voir §10.
>
> 💡 Ne pas lire ce document en entier. Passer par le sommaire, puis n'ouvrir que
> la section utile.

## Sommaire

1. [Résumé du projet](#1-résumé-du-projet)
2. [Stack technique](#2-stack-technique)
3. [Structure du dépôt](#3-structure-du-dépôt)
4. [Architecture & principe directeur](#4-architecture--principe-directeur)
5. [Décisions de développement (quoi + pourquoi)](#5-décisions-de-développement-quoi--pourquoi)
6. [Problèmes rencontrés & solutions](#6-problèmes-rencontrés--solutions)
7. [Historique par plan (chronologie)](#7-historique-par-plan-chronologie)
8. [Dette technique connue](#8-dette-technique-connue)
9. [État actuel & prochaine action](#9-état-actuel--prochaine-action)
10. [Comment maintenir ce document](#10-comment-maintenir-ce-document)

---

## 1. Résumé du projet

Site web affichant un **globe 3D interactif** (type Google Earth) portant deux
couches :

- le **relief terrestre** en 3D — displacement map + normal map, exagération
  verticale réglable ;
- une **heatmap des températures actuelles** du monde entier, issue du modèle
  météo **GFS (NOAA)**, grille 0,25°, régénérée toutes les heures par un pipeline
  automatisé.

Contrainte transverse : **navigation fluide y compris sur mobile modeste**, via
deux niveaux de subdivision de sphère choisis selon le GPU détecté.

Les données GFS sont du **domaine public** (NOAA), donc compatibles avec une
monétisation par publicité. Leur latence est de ~4-6 h sur le temps réel : c'est
une propriété du modèle, acceptée et affichée à l'utilisateur, pas un défaut à
corriger.

## 2. Stack technique

| Couche | Choix | Note |
|---|---|---|
| Pipeline de données | Python (**3.12 sur Actions**, venv local **3.14**) | `eccodes` (bindings Python, décodage GRIB direct par clés — plus de `xarray`/`cfgrib` dans le code, §5), `numpy`, `Pillow`, `requests`, `boto3` (client S3 pour R2, §5) |
| Dépendances pipeline | `pipeline/requirements.txt` (numpy, Pillow, requests, boto3 — installe sur **Windows**) vs `pipeline/requirements-grib.txt` (`cfgrib`, `eccodeslib`, `xarray` — **Actions seulement**, pas de roue Windows) | `eccodes` seul est appelé (`pipeline/grib_adapter.py::_message_keys` sur `import eccodes`) depuis la spec couches (2026-09-12) ; `cfgrib`/`xarray` ne sont plus référencés dans `pipeline/`/`tests/` mais restent listés dans `requirements-grib.txt` pour fournir `eccodeslib` — élagage possible, dette n° 30 (§8) |
| Sources de données | NOMADS / **GFS 0,25°** (NOAA, 5 couches, horaire) ; NOMADS / **GEFS-Aerosols 0,25°** (NOAA, `pm25`/`dust`, 4 cycles/jour, pas 3 h) | GFS : script de filtrage `filter_gfs_0p25_1hr.pl`, run+échéance à l'heure courante (§5) ; GEFS-chem : `filter_gefs_chem_0p25.pl`, retenu contre CAMS/GEOS-CF (§5, spec couches 2026-09-12) |
| Repères géographiques *(lot C, mergé 2026-09-19)* | **Natural Earth v5.1.2** (domaine public) : `populated_places` 10 m, `admin_0_countries` 50 m, `rivers_lake_centerlines` 10 m | transformés **à la main** par `tools/build_geo.py` (stdlib seule, cache git-ignoré `tools/.geo-cache/`) en trois fichiers statiques commités sous `web/public/geo/` ; ni R2, ni CI, ni pipeline horaire |
| Frontend | Vite 8, TypeScript 5.9, Three.js 0.185, Vitest 4, Wrangler 4, Node 24 (Actions et local) | vanilla, shaders GLSL custom, pas de framework lourd ; `web/` livré le 2026-09-02 (branche `feat/globe-heatmap`, §3) |
| Sortie | Fichiers statiques (PNG + JSON) | **aucun serveur applicatif** ; `latest.json` porte aussi `encoding` et `grid` (§5) |
| Hébergement | **GitHub Actions** (cron horaire, Linux) → **Cloudflare R2** (textures + tuiles) + **Cloudflare Workers Static Assets** (site) | tranché le 2026-08-29 (§5) ; **R2 en service depuis le 2026-09-02** : bucket `worldtemp` (WEUR) ; **domaine personnalisé Cloudflare Registrar `globelayers.com`** (acheté 2026-09-05) : site sur `https://globelayers.com` (Worker, `custom_domain`, `www` redirigé 301), données/tuiles sur `https://data.globelayers.com` (R2 custom domain + Cache Rule « cache tout, TTL origine ») ; anciens `worldtemp.geoviz.workers.dev` et `pub-….r2.dev` encore actifs, à couper après le merge (§8, §9) ; **Workers Static Assets remplace Cloudflare Pages** (2026-09-02, §5) : déploiement par le job `deploy` de `.github/workflows/test.yml`, sur push `master` uniquement, après `test` et `web` verts ; `eccodeslib` s'installe en pip sur Linux, pas sur Windows ; repo passé **public** le 2026-08-30 (§5) |
| Génération des tuiles | **GDAL CLI** (`gdaldem`, `gdalwarp`, `gdal_rasterize`, `ogr2ogr` — Actions seulement, absent du venv Windows) + **rclone** (upload R2) | orchestré par `.github/workflows/tiles.yml` (`workflow_dispatch`, 9 jobs `map`/`sat` + `index`) ; sources : **GEBCO 2026** (bathymétrie/relief), **OSM land polygons** (ODbL, masque terre + lacs), **Natural Earth 10 m** (frontières), **NASA Blue Marble (BMNG) 21600×10800** (satellite) — §5 |
| CI | `.github/workflows/test.yml` : job `test` (pytest + `history_check` + dry-run NOMADS réel, **installe GDAL** pour tester réellement `tiler/gdal_adapter.py`), job `web` (npm ci, typecheck, vitest, build), job `deploy` (`wrangler deploy`, push `master` seulement, après `test`+`web`) ; `pipeline.yml` (cron horaire) ; `tiles.yml` (génération manuelle des tuiles, doit résider sur `master` pour `workflow_dispatch`, §6) | jobs `web`/`deploy` ajoutés le 2026-09-02 ; GDAL ajouté à `test.yml` le 2026-09-05 |
| Outillage dépôt | Python stdlib seule | `tools/history_check.py` (`CODE_ROOTS` inclut désormais `tiler`), tests `unittest` |

## 3. Structure du dépôt

> ⚠️ Cette section décrit **ce qui existe**, jamais ce qui est prévu. L'arbre
> cible du projet vit dans `docs/PLAN.md`. Un fichier planifié écrit ici est un
> fichier fantôme, et `tools/history_check.py` le signale.

```
.claude/skills/updating-history/
  SKILL.md                     # procédure de mise à jour de ce document
docs/
  PLAN.md                      # plan d'implémentation en 7 phases (arbre cible inclus)
  superpowers/
    specs/2026-08-30-pipeline-gfs-design.md   # contrat pipeline (spec)
    specs/2026-09-02-globe-heatmap-design.md  # contrat globe + heatmap (spec 2)
    specs/2026-09-05-tiles-design.md          # pyramide de tuiles, filtre, domaine (spec 3, §11 audit Ventusky)
    specs/2026-09-06-navigation-design.md     # zoom ancré sur l'altitude, pincement, tooltip, fondu (spec 4 lot A)
    specs/2026-09-12-layers-design.md         # 7 couches scalaires, pipeline à deux sources, manifeste v2 (spec 4 lot B1)
    plans/2026-08-30-pipeline-gfs.md          # plan d'exécution (12 tâches)
    plans/2026-09-02-globe-heatmap.md         # plan d'exécution (10 tâches)
    plans/2026-09-05-tiles.md                 # plan d'exécution (20 tâches)
    plans/2026-09-06-navigation.md            # plan d'exécution (10 tâches)
    plans/2026-09-12-layers.md                # plan d'exécution (16 tâches)
tiler/                          # génération des tuiles, Actions seulement (dépend de GDAL)
  __init__.py
  grid.py                       # pyramide géodésique 512 px : tile_at, tile_bounds, tile_range, box_for_job
  encode.py                     # index binaire WTIX (canaux R/G/B), compose_channels, TileIndex.from_bytes
  cut.py                        # cut_block : découpe un bloc raster en tuiles
  borders.py                    # frontières GeoJSON → lignes rasterisées (canal B)
  gdal_adapter.py                # GdalBackend : hillshade (-alt 30 -s 111120), land_mask, ocean_only, clip_vector, extract_gebco_tile
  sat.py                         # pyramide satellite découpée dans la Blue Marble (open_source, sat_tile, iter_sat_tiles)
  main.py                        # orchestration blocs → tuiles → index, CLI (extract-gebco/map/sat/merge-index), build_level0
  requirements.txt               # numpy, Pillow (+ GDAL CLI, hors pip, installé par apt sur Actions)
pipeline/
  config.py                    # clés R2 layers/, délais par source, versions de schéma ; legacy `gfs/latest.*`/`LEGACY_SCHEMA_VERSION` retirés (spec vent, dette n° 31 résolue)
  layers.py                    # registre LayerSpec des 9 couches (spec couches 2026-09-12 + `wind_u`/`wind_v` UGRD/VGRD 10 m, spec vent 2026-09-13, `Encoding(-60, 60, "linear")`), LAYERS, by_source
  sources.py                   # NOUVEAU : SourceSpec des 2 sources NOMADS (GFS, GEFS-chem), SOURCES
  run_selection.py             # candidates(step_hours=…), candidates_for(source, now) — deux cadences (1 h, 3 h)
  nomads.py                    # build_url(source, candidate, specs) multi-variables, téléchargement, retry sur 429
  grib_adapter.py              # seul module dépendant d'eccodes ; decode_fields(data, specs) par clés (bindings eccodes directs, plus de cfgrib/xarray)
  texture.py                   # validate_grid/validate_range, convert, quantize(min,max,scale) linéaire ou racine, layer_pixels
  metadata.py                  # layer_entry, build_manifest (schéma v2, multi-couches) ; `build_legacy` (schéma v1) retiré (spec vent, dette n° 31 résolue)
  publish.py                   # Object, upload_r2(cfg, objects) d'une liste ordonnée, read_current(cfg, key)
  main.py                      # orchestration à deux sources (primaire GFS, secondaire GEFS-chem tolérante), report chem, manifeste v2 (publication legacy `gfs/latest.*` retirée, spec vent T1)
  requirements.txt             # Windows OK : numpy, Pillow, requests, boto3
  requirements-grib.txt        # Actions seulement : cfgrib, eccodeslib, xarray (non référencés dans le code, dette n° 30 §8)
tools/
  history_check.py             # contrôle mécanique de HISTORY.md contre le dépôt
  prepare_bluemarble.py        # télécharge/redimensionne la texture Blue Marble NASA (source, licence)
  build_geo.py                 # lot C : Natural Earth → web/public/geo/ (villes triées par priorité, pays avec rang majoré pour les micro-États et écartés au-delà de `MAX_COUNTRY_RANK` = 7 (jamais affichables), fleuves simplifiés Douglas-Peucker + format binaire WTRV) ; `fit_budget` borné à 40 itérations ; lancé à la main, déterministe
tests/
  test_history_check.py        # 30 tests unittest de la logique du contrôle
  test_build_geo.py            # lot C : 21 tests pytest — logique pure de build_geo (tri, arrondi, repli NAME_FR, DP, WTRV) et validité des trois fichiers commités (schéma, ordre, budgets)
  fixtures/gfs_tmp2m.grib2     # fixture GRIB legacy (~514 Ko, test_grib_adapter.py), exception au .gitignore
  fixtures/gfs_layers.grib2    # NOUVEAU (spec couches) : fixture réelle filtrée, 5 variables GFS (≈ 5,7 Mo), exception au .gitignore
  fixtures/gefs_chem.grib2     # NOUVEAU : fixture réelle filtrée, PMTF + PMTC surface GEFS-Aerosols (≈ 3,1 Mo), exception au .gitignore
  fixtures/gfs_wind.grib2      # NOUVEAU (spec vent) : fixture réelle NOMADS, UGRD/VGRD 10 m (1,9 Mo), exception au .gitignore
  fixtures/tiler/borders.geojson  # fixture frontières pour test_tiler_borders.py
  pipeline/                    # tests pytest des modules ci-dessus (1 fichier par module, dont test_layers.py, test_sources.py)
  tiler/                       # tests pytest de tiler/ (1 fichier par module ; GDAL skip sous Windows)
    test_tiler_grid.py
    test_tiler_encode.py
    test_tiler_cut.py
    test_tiler_borders.py
    test_tiler_gdal_adapter.py  # dont test_ocean_only_catches_subpixel_islet (all_touched)
    test_tiler_sat.py
    test_tiler_main.py
.github/workflows/
  test.yml                     # jobs test (pytest+history_check+dry-run, installe GDAL), web (npm/vitest/build), deploy (wrangler, master)
  pipeline.yml                 # cron horaire (minute 12) + workflow_dispatch
  tiles.yml                    # génération manuelle des tuiles : 8 jobs map (matriciel) + sat + index ; doit résider sur master (§6)
pytest.ini                     # testpaths = tests
HISTORY.md                     # ce document
.gitattributes                 # LF partout, quelle que soit la config git locale
.gitignore                    # `web/public/dev-data/` ignoré (spec vent T11a : données dry-run CI pour la validation navigateur)
web/                          # frontend (branche feat/globe-heatmap, 2026-09-02) : web/src/, web/tests/, web/public/
  index.html                   # squelette DOM : canvas, overlay (bandeau/statut/légende/bouton), #tooltip + #marker hors overlay, #fatal ; `#layers-menu` + `#wind-toggle` (spec vent §9) remplacent l'ancien `#controls` générique
  package.json                 # scripts (dev/build/test/typecheck/deploy), deps three/vite/vitest/wrangler
  package-lock.json
  tsconfig.json                # strict, noUncheckedIndexedAccess, cible ES2022/bundler
  vite.config.ts                # config Vitest (fichiers de tests sous web/tests/) ; server.strictPort (spec 3)
  wrangler.jsonc                # Worker Static Assets ; routes: globelayers.com (custom_domain), workers_dev: true (§8)
  public/
    _headers                   # cache : /assets immutable 1 an, /textures 1 jour, / et /index.html no-cache
    geo/                       # lot C : données statiques Natural Earth, commitées, servies avec le site (cache 1 jour) — places.json (7 332 villes, 251 Ko), countries.json (206 pays, 6 Ko), rivers.bin (2 365 lignes, 45 663 segments, 202 Ko)
    textures/blue-marble-4k.jpg  # texture couleur NASA Blue Marble, domaine public (repli si les tuiles échouent)
  src/
    main.ts                    # bootstrap + câblage multi-couches (spec couches 2026-09-12) : ManifestLoader, LayerCache LRU, createLayersMenu, activate(id, fromUser), applyData() ; tiles loader, tier GPU, vue par URL, overlay, tooltip, crochet `window.__worldtemp` en dev ; câblage vent (spec vent §11) : `applyWind` recalcule `present`/`windFailedNow`/`usable` après l'attente réseau et conserve l'ancien champ (jamais coupé sur un second échec au même `generated_at`), `windNotice` = « Vent indisponible » posé dès que `windOn && windFailedNow` (switch laissé actif dans ce cas, déviation assumée de la spec §11) ; `let stopWind` déclaré avant le gestionnaire `webglcontextlost` (plus de TDZ) ; crochet dev `window.__worldtempWind` ; repères géographiques délégués à `geo/wiring.ts` (`setupGeo`, dette n° 42 : 495 → 411 lignes)
    config.ts                  # DATA_BASE_URL (data.globelayers.com/layers, spec couches) /TILES_BASE_URL, REFRESH_MS, STALE_AFTER_MS
    style.css                  # mise en page overlay (grille 4 lignes en mobile, panneaux), menu de couches (rangée défilable ≤ 600 px), attribution avec lien OSM, #tooltip/#marker fixes ; interrupteur « Vent » (spec vent §9)
    controls/
      zoom.ts                    # zoom maison sur l'altitude a = d − 1 : normalizeWheel, nextAltitude, pinchAltitude, keepAnchor, anchorRotate, PinchTracker, attachZoom (OrbitControls garde la rotation)
    layers/                     # NOUVEAU (spec couches 2026-09-12) : registre et sélection de couche, indépendants du chargement réseau
      registry.ts                 # LayerDef (label, unit, format, palette RGBA, isolignes, `soften` = σ du flou de rendu — nuages 1,2 seulement) des 7 couches, ordre du menu
      select.ts                   # pur : orderedLayers, parseLayerParam, withLayerParam
      cache.ts                    # LayerCache : LRU de 2 LayerLoader (active + précédente), dispose à l'éviction
    data/
      manifest.ts                # NOUVEAU, remplace l'ancien module de métadonnées v1 : parseManifest (schéma v2, multi-couches, `layers: {id: entrée}`)
      encoding.ts                # NOUVEAU : encode/decode linéaire et racine (miroir exact de pipeline/texture.py::quantize)
      sampling.ts                # sampleValue générique (remplace sampleTemperature) : lecture bilinéaire CPU, decode par couche
      loader.ts                  # ManifestLoader (manifeste v2, non réentrant) + LayerLoader par couche (PNG → texture + pixels CPU, non réentrant ; `soften` > 0 → `softenedTexture` : DataTexture RedFormat floutée, pixels bruts conservés pour le tooltip)
      pixels.ts                  # bitmapPixels : ImageBitmap → RGBA nord en haut via canvas 2D réutilisé (null si impossible)
      blur.ts                    # blurRedChannel : flou gaussien séparable du canal R (bouclage en longitude, bornage en latitude, `flipRows` pour l’ordre texture), logique pure
    gpu/
      tier.ts                    # detectTier : faisceau d'indices (renderer, cœurs, UA, pixel ratio, ?tier=)
    tiles/                       # spec 3 : pyramide géodésique de tuiles (miroir TS de tiler/)
      grid.ts                    # miroir de tiler/grid.py : tileBounds, tileSpan, children, parent, tileKey, subRect
      manifest.ts                # lecture du manifeste JSON des tuiles (TilesManifest {sat, map})
      index.ts                   # lecture de l'index binaire WTIX (isOcean par ancêtre le plus profond couvert)
      lod.ts                     # selectTiles (frustum, horizon, taille projetée en px CSS), mapStyleFor (MAP_FADE_START/END 1,20 → 1,14), ViewState
      loader.ts                  # chargeur de tuiles : priorité, concurrence par tier, tentatives, LRU par budget mémoire
      patch.ts                   # géométrie des patches (quadtree) avec jupes orientées vers l'extérieur, lonLatToVec3
    wind/                       # NOUVEAU (spec vent 2026-09-13) : simulation CPU du vent, indépendante du rendu
      sim.ts                      # WindSim : advection U/V, tampon slot-major [K][N][xyz] glissant (copyWithin), respawn (pickSphere), WIND_PROFILE par tier (high 5000/K9, low 1500/K5, `stride` 3 : la traînée ne glisse qu’un tick sur trois, la tête suit chaque tick ; P = 3 px/s par m/s — révisé le 2026-09-18) ; WindField `{ uv: Uint8Array entrelacé [u,v], grid, encU, encV }` (2 Mo) et `sampleUV` fusionné sans allocation (revue finale + vague de correction, `e4b4d6a`) remplacent deux appels `sampleValue` par particule/tick ; seuil d'horizon `isVisible` exact au rayon 1,002 (`73b3687`)
      select.ts                   # pur : parseWindParam (`?wind=1|0`, défaut par tier, reduced-motion), withWindParam
      loader.ts                   # WindLoader : pixels CPU des deux PNG U/V fusionnés en un seul tampon entrelacé `WindField.uv` (jamais de texture GPU, plus de tampons RGBA 8 Mo conservés), remplacement atomique, garde dispose en vol, non réentrant
      controller.ts               # WindController : step cadencé à TICK_MS (30 Hz), dt borné MAX_DT_S et égal au temps réellement consommé par le tick (le reste d'accumulateur est reporté sans être recompté, `a68d44b`), inscrit sur SceneHandle.onFrame seulement quand le vent est actif
    geo/                        # lot C : chargement et paramètres des repères géographiques
      loader.ts                   # once (promesse mémorisée, succès comme échec), loadLabelSet (un seul des deux fichiers en échec n'empêche pas l'autre), loadRivers ; accès réseau injectés
      params.ts                   # pur : parseFlag / withFlag (`?labels=0|1`, `?rivers=0|1`, actifs par défaut)
      wiring.ts                   # `wireGeo` (dépendances injectées, testable en Node) : deux interrupteurs, URL, chargement paresseux, création non réentrante des fleuves, écouteur de vue inactif éteint ; `setupGeo({ ui, scene, canvas, tier })` : assemblage de production (LabelsController, obstacles = `ui.panelRects()`, crochet dev `__worldtempGeo`)
    labels/                     # lot C : étiquettes villes/pays en DOM
      data.ts                     # parseurs stricts de places.json / countries.json (GeoDataError) + LabelSet (pays puis villes, vecteurs unité précalculés)
      select.ts                   # pur : paliers de zoom (CITY_TIERS, COUNTRY_TIERS), horizon + marge de limbe (LIMB_FRACTION 0,92), anti-chevauchement glouton par boîtes estimées, plafond (LABEL_CAP 60/30, × 2/3 sous 600 px), stabilité des déjà-affichées
      text.ts                     # labelValue : même lecture que le tooltip (sampleValue sur pixels bruts + format), null sous tooltipMin
      layer.ts                    # DOM seul : un div par étiquette, réserve réutilisée, fondu 150 ms, variante sombre (setDark)
      controller.ts               # cadence : re-sélection ≤ toutes les 100 ms (caméra ou taille changée), rattrapage à l'arrêt, valeurs en cache, repeinture seulement si la pose a changé ; ne demande jamais de rendu WebGL
    rivers/                     # lot C : fleuves
      data.ts                     # parseur de rivers.bin (WTRV) → segments 3D au rayon 1,001, subdivision > 2° le long du grand cercle, cumul par rang (RiversError)
    render/
      scene.ts                   # THREE.Scene/Camera/Renderer/OrbitControls (enableZoom = false, zoom délégué à controls/zoom.ts, enableRotate coupé pendant un pincement), rendu à la demande ; `onFrame(cb)` (spec vent) : rendu continu seulement si un abonné est actif, 0 draw call au repos conservé sinon ; boucle `loop()` isolée par callback (`try/catch`, `9458c3d`) : un tick de vent qui lève ne prive plus la frame du rendu
      pick.ts                    # picking analytique sur la sphère unité : pickSphere, vec3ToLonLat, projectToScreen, ndcFromCanvas
      globe.ts                   # globe tuilé : quadtree de patches, un seul ShaderMaterial partagé + uniformsNeedUpdate par patch ; setLayer(texture|null, w, h)/setIsoStep(step) remplacent setHeatmap/setFilter (spec couches)
      colormap.ts                # buildLut(def, enc)/legendGradientCss(def, enc) génériques par couche (registre `layers/registry.ts`), LUT 256×1 sRGB
      wind.ts                    # WindLayer : un Mesh de quads instanciés (un par segment de traînée, 2 px CSS + liseré), `aStart`/`aEnd` = le tampon slot-major de wind/sim.ts lu deux fois, décalé de N sommets (InstancedInterleavedBuffer, sans copie), uniforms viewport/largeur posés dans onBeforeRender, markDirty envoie le tampon entier
      shaders/patch.vert.glsl    # vertex shader par patch (remplace l'ancien vertex shader du globe, retiré en spec 3)
      shaders/patch.frag.glsl    # fragment shader : composition satellite/carte, bicubique Catmull-Rom 9 taps, hillshade, LUT, composition alpha par couche + isolignes (`isoline(t, spacing)`, spec couches)
      shaders/wind.vert.glsl     # élargit chaque segment en quad dans l’espace écran (segment nul → aire nulle), alpha dérivé de gl_InstanceID (k/(K−1) → (k+1)/(K−1))
      shaders/wind.frag.glsl     # blanc (satellite) / gris foncé (carte) selon uMapStyle, liseré de teinte opposée, bords anti-crénelés (smoothstep sur la distance à l’axe)
      rivers.ts                  # lot C : RiversLayer, quads instanciés statiques ; instanceCount = préfixe des rangs admis au zoom (RIVER_TIERS interpolés), dernier rang en fondu ; renderOrder 1 (vent 2)
      shaders/screen-quad.glsl   # lot C : fragment GLSL partagé vent/fleuves — élargissement d'un segment en quad dans l'espace écran (préfixé par concaténation des ?raw)
      shaders/rivers.vert.glsl   # lot C : horizon exact au rayon R, fondu du rang (uMaxRank flottant)
      shaders/rivers.frag.glsl   # lot C : bleu-cyan clair (satellite) / bleu soutenu (carte), bords anti-crénelés
    ui/
      layers-menu.ts              # NOUVEAU : createLayersMenu, radiogroup DOM des 7 couches + Aucune, tabindex roulant, disponibilité
      toggle.ts                   # lot C : createToggle générique (role="switch"), remplace l'ancien interrupteur propre au vent ; désactivé = aria-checked false + titre d'indisponibilité, titre d'origine rendu à la réactivation
      format.ts                  # formatBanner(entry, nowMs, tz) par source (sans paramètre `def`), legendTicks(def, encoding), formatTemperature déplacée dans registry ; NOUVEAU `formatWind(u, v)`/`windDirection`/`compassPoint` (rose 16 points, spec vent §10)
      overlay.ts                 # createOverlay : bandeau, statut, légende par couche (plus de bouton filtre unique), repliage mobile ; exporte byId ; `layersMenu`/`windToggle` remplacent l'ancien `controls` unique (spec vent §9) ; `panelRects()` (rectangles des panneaux visibles, évités par les étiquettes) et `onLayoutChange(cb)` (repli/dépli)
      tooltip.ts                 # TapDetector, placeTooltip, createTooltip : setData(def, pixels, grid, encoding), une lecture {lon, lat} projetée à chaque rendu, aria-live selon le mode ; NOUVEAU setWind(field) ajoute une 2ᵉ ligne « Vent … » (spec vent §10)
  tests/
    fixtures.ts                  # SAMPLE : manifeste de test v2 (même contrat que le pipeline), réutilisées par plusieurs suites ; NOUVEAU WIND_ENTRIES (wind_u/wind_v, hors MANIFEST, spec vent)
    manifest.test.ts             # NOUVEAU, remplace l'ancienne suite de métadonnées v1 : parseManifest v2 (strict, couches partielles, rejet v1)
    encoding.test.ts             # NOUVEAU : encode/decode, table de cas partagée avec pytest (demi-entiers)
    registry.test.ts             # NOUVEAU : LayerDef des 7 couches, ordre du menu
    select.test.ts               # NOUVEAU : orderedLayers, parseLayerParam, withLayerParam
    cache.test.ts                # NOUVEAU : LRU de 2 (éviction, réactivation, dispose)
    sampling.test.ts
    colormap.test.ts
    tier.test.ts
    loader.test.ts               # ManifestLoader + LayerLoader (non réentrance des deux, dont le correctif `b63c9d2`)
    format.test.ts
    tiles-grid.test.ts            # miroir des nombres de contrôle de tiler/grid.py
    tiles-manifest.test.ts
    tiles-index.test.ts
    tiles-patch.test.ts           # dont l'orientation des jupes
    tiles-lod.test.ts
    tiles-loader.test.ts          # concurrence, éviction LRU, isOcean clampé
    tiles-globe.test.ts
    pick.test.ts                  # rayon → sphère, inverse de lonLatToVec3, horizon
    zoom.test.ts                  # courbe (35 crans), pincement, PinchTracker, keepAnchor, convergence d'ancre (< 0,5 px)
    pixels.test.ts
    blur.test.ts                  # blurRedChannel : σ = 0 identité, champ uniforme stable, masse conservée, bouclage en longitude, flipRows
    tooltip.test.ts               # TapDetector, placeTooltip
    wind-sim.test.ts              # NOUVEAU : advection exacte pour u = 0, dérive bornée, spawn/respawn ; tolérances Float32 (T6, `toBeCloseTo(RADIUS, 6)`) et vitesse représentable 8 bits (v = 12) ; `sampleUV` accordé à 1e-9 avec `sampleValue` sur le même maillage cellulaire, seuil d'horizon exact au rayon 1,002
    wind-select.test.ts           # NOUVEAU : parseWindParam (défaut par tier, reduced-motion), withWindParam
    wind-loader.test.ts           # NOUVEAU : WindLoader, remplacement atomique, garde dispose en vol (rechargement raté sur la même instance) ; ancien champ conservé sur échec au même `generated_at`, tampon `uv` entrelacé
    wind-layer.test.ts            # WindLayer : instances N·(K−1), aStart/aEnd sur le même tampon décalés de 3N, uniforms N/K, onBeforeRender (viewport, largeur × pixel ratio), garde de taille
    wind-controller.test.ts       # NOUVEAU : WindController, cadence 30 Hz, dt borné MAX_DT_S ; Σ dt ≤ temps écoulé (reste d'accumulateur non recompté, `a68d44b`)
    toggle.test.ts                # lot C : interrupteur générique sur faux bouton (Vitest sans DOM)
    geo-params.test.ts            # lot C : parseFlag / withFlag
    geo-loader.test.ts            # lot C : once, échec partiel des étiquettes, binaire invalide
    geo-wiring.test.ts            # dette n° 42 : wireGeo — URL, chargement paresseux, bascule pendant le téléchargement, réentrance I1, échecs, écouteur de vue éteint
    labels-data.test.ts           # lot C : parseurs (7 refus), LabelSet
    labels-select.test.ts         # lot C : paliers, horizon sans projection, marge de limbe, chevauchement, plafond, stabilité
    labels-text.test.ts           # lot C : valeur, nom seul (aucune couche, sous tooltipMin)
    labels-layer.test.ts          # lot C : faux DOM minimal écrit dans le test — un div recyclé ne garde pas la valeur précédente
    labels-controller.test.ts     # lot C : cadence 100 ms, rattrapage (dont rattrapage périmé), redimensionnement, setDark, pas de repeinture à pose inchangée
    rivers-fixture.ts             # lot C : encodeRivers, helper partagé, volontairement hors des fichiers de test pour ne pas rejouer ses describe chez l'importeur
    rivers-data.test.ts           # lot C : WTRV valide/invalide (8 refus), subdivision, cumul par rang, antiméridien (angle mesuré par la corde)
    rivers-layer.test.ts          # lot C : riverMaxRank, instanceCount par zoom, uniforms, fragment partagé
```

## 4. Architecture & principe directeur

**Principe directeur : tout ce qui est cher se fait hors ligne, tout ce qui est
vivant se fait sur GPU.**

```
NOAA NOMADS ──(cron horaire)──> pipeline Python ──> PNG gris + metadata.json
                                                            │
                                                    fichiers statiques + CDN
                                                            │
                                                            v
                              navigateur ── Three.js ── shaders GLSL ── globe
```

Trois conséquences qui structurent tout le reste :

- **Aucun serveur applicatif.** Le pipeline dépose des fichiers, le front les
  lit. Rien entre les deux, donc rien à opérer ni à mettre à l'échelle.
- **La température voyage en niveaux de gris**, décodée dans le fragment shader
  sur une plage fixe. Le GPU fait la colorisation, l'interpolation et le
  hillshading ; le CPU ne touche jamais un pixel de heatmap (sauf le canvas 2D de
  lecture du tooltip, Phase 6).
- **La géométrie est figée au démarrage** selon le tier GPU détecté. Aucune
  régénération pendant la navigation.

L'arbre des phases et leurs critères d'acceptation : `docs/PLAN.md`.

## 5. Décisions de développement (quoi + pourquoi)

| Décision | Pourquoi |
|---|---|
| **Plage de température FIXE [-90 °C, +60 °C]**, encodée 8 bits (`pixel = (T+90)/150*255`) | Une plage dynamique obligerait le shader à lire des métadonnées par frame. La plage fixe couvre les records mondiaux (Vostok ≈ -89 °C, Vallée de la Mort ≈ +57 °C) au prix de ~0,59 °C par niveau. **Source de vérité unique**, à recopier avec commentaire croisé dans `grib_to_texture.py`, les shaders et `colormap.js`. « *— supplantée le 2026-08-30 : `encoding` voyage dans `latest.json`, voir plus bas.* » |
| **ShaderMaterial custom dès la Phase 2**, même trivial | Tout le projet finit dans ces shaders. Partir d'un matériau standard imposerait une migration au moment précis où la scène devient complexe. |
| **Colormap en LUT 1D (texture 256 × 1)**, pas de rampe codée en dur | Changer de palette sans toucher au shader, et une seule source de vérité entre le rendu et la légende. |
| **Arrêts de couleur concentrés entre -45 °C et +45 °C** | 99 % des pixels y vivent. Une rampe linéaire sur toute la plage rendrait la carte terne au quotidien pour couvrir des extrêmes qui n'apparaissent presque jamais. |
| **Le tier `low` est un citoyen de première classe**, testé régulièrement via `?tier=low` | Un fallback qu'on ne regarde jamais se dégrade en silence. La normal map est conservée en `low` : c'est elle, pas la densité de maillage, qui porte la qualité perçue. |
| **Détection GPU par faisceau d'indices**, jamais un seul signal | `WEBGL_debug_renderer_info` est souvent masqué, `hardwareConcurrency` ment sur mobile, le micro-benchmark coûte des frames. Aucun n'est fiable seul ; le paramètre d'URL permet de forcer pour tester. |
| **Le pipeline ne casse jamais le site** : sur échec NOMADS, la dernière texture valide reste en place | Une panne côté fournisseur ne doit pas se voir côté visiteur. Écriture atomique (temporaire + rename) et idempotence pour la même raison. |
| **Ordre strict des phases**, critères d'acceptation validés visuellement avant de continuer | Le rendu 3D se débogue mal en couches empilées : un artefact de la Phase 4 est indiscernable d'un artefact de la Phase 5 si les deux arrivent ensemble. |
| **`history_check` en Python stdlib**, pas en TypeScript *(2026-08-29)* | Le portage TS depuis le projet d'origine imposait un `package.json` + `node_modules` à la RACINE (tsx, typescript, vitest) juste pour vérifier un document — en plus du `node_modules` de `web/`. La version stdlib tourne sur un dépôt nu, et Python est déjà la Phase 1. |
| **Le plan web n'est pas exécuté tel quel : brainstorming → spec → plan réécrit** *(2026-08-29)* | `docs/PLAN.md` vient d'une session web Claude, sans passer par le workflow superpowers. L'utilisateur veut le chemin complet (questions, approches, design, spec, writing-plans) avant tout code. Le plan initial reste la référence produit, pas la feuille de route d'implémentation. |
| **Deux specs : pipeline d'abord, globe ensuite** *(2026-08-29)* | Deux sous-systèmes indépendants reliés par un seul contrat (PNG 1440 × 721 + `metadata.json`). Le contrat est figé dans la spec pipeline ; le globe peut démarrer sur une texture factice. |
| **Pipeline sur GitHub Actions, données sur Cloudflare R2, site sur Cloudflare Pages** *(2026-08-29)* | Zéro serveur à maintenir, rien à installer sur le PC de dev. R2 plutôt que commit horaire (dépôt gonflerait de ~4 Go/an) ou GitHub Pages (cache non configurable). Rétention : **dernière texture valide seulement** (`latest.png` + `latest.json` écrasés) — YAGNI, un historique s'ajoutera plus tard si un curseur temporel est voulu. |
| **Approche A : décodage GRIB isolé derrière un adaptateur, tout le reste en fonctions pures** *(2026-08-29)* | `eccodeslib` n'a aucune roue Windows (vérifié sur PyPI 2.48.0.26) ; le dev local est un venv Windows sans Docker. Donc `decode_grib()` est le seul code non testable localement : testé sur Actions, `skipUnless` en local. Sélection du run, roll, K→°C, normalisation, écriture atomique, upload : pures, testées sur `numpy`. Bonus : le GRIB devient un détail d'entrée remplaçable (NODD/S3). |
| **Les dossiers surveillés par le contrôle sont dérivés de `git ls-files`**, pas du disque | Le gitignoré (`node_modules/`, `.venv/`, `web/public/data/`) n'est jamais réclamé au document, et une racine encore vide ne produit aucun bruit. La version d'origine lisait le disque et devait exclure des dossiers en dur. |
| **Prévision valide à l'heure courante** (run R + échéance fh tel que R+fh ≈ heure courante, délai de disponibilité 3 h 30, 4 candidats testés) plutôt que l'analyse f000 du dernier run *(2026-08-30)* | `valid_time` reste proche de l'heure réelle et la carte change visiblement à chaque cron horaire. f000 du dernier run disponible aurait 4 à 9 h de retard : le cron horaire tournerait pour rien la plupart du temps. |
| **Contrat de données étendu : `encoding` et `grid` portés par `latest.json`**, le front ne recopie aucune constante *(2026-08-30)* | Résout **par construction** la dette n° 3 (triple duplication Python/GLSL/JS de la plage d'encodage, §8) : une seule source de vérité, côté pipeline, lue à l'exécution plutôt que recopiée à la main. |
| **Mise en place R2 par API via le plugin Claude Code `cloudflare@cloudflare`** (bucket, `r2.dev`, CORS), **token R2 de type *Account* créé au dashboard** *(2026-09-02)* | L'OAuth du MCP Cloudflare n'a pas le droit « API Tokens » (erreur 9109) : le token passe par le dashboard, ce qui garde le secret hors du chat. Token *Account* plutôt que *User* : survit aux changements du compte utilisateur, recommandé pour la CI. Nom `worldtemp-github-actions`, permission Object Read & Write restreinte au bucket. Secrets posés côté PC par `Get-Clipboard \| gh secret set …` (rien de tapé, rien dans l'historique). |
| **Idempotence via `get_object` S3** (mêmes secrets R2 que la publication) plutôt que l'URL publique du bucket *(2026-08-30)* | Évite un 5ᵉ secret GitHub rien que pour lire ce qu'on vient d'écrire. |
| **Repo passé public le 2026-08-30** | Minutes GitHub Actions illimitées sur dépôt public ; le cron horaire consomme environ 1 500 min/mois, au-dessus du quota gratuit de 2 000 min d'un dépôt privé une fois `pipeline.yml` et `test.yml` cumulés. |
| **429 NOMADS traité comme erreur transitoire (retry)**, ajouté en revue *(2026-08-30)* | Un run/échéance pas encore prêt répond parfois 429 avant le 200 ; le traiter comme une panne définitive ferait échouer des runs qui auraient réussi à la tentative suivante. |
| **`if: always()` sur l'étape dry-run de `test.yml`** *(2026-08-30)* | L'artefact `out/` du dry-run est l'outil de diagnostic principal en cas d'échec (PNG produit, visible sans repasser par R2) : il doit exister même quand une étape précédente (tests ou `history_check`) tombe, sinon le diagnostic manque justement quand il sert le plus. |
| **Cloudflare Workers Static Assets plutôt que Cloudflare Pages** *(2026-09-02)* | Cloudflare recommande Workers pour tout nouveau projet depuis 2026 ; Pages est gelé. `wrangler.jsonc` déclare un Worker sans script, uniquement des assets (`./dist`). Déploiement par le job `deploy` de `test.yml`, après `test` et `web`, sur push `master` seulement. |
| **TypeScript plutôt que JavaScript** pour le frontend *(2026-09-02)* | Le contrat `latest.json` (schéma pipeline) et les signatures inter-modules (`heatmapUv`, `decideTier`, `DataLoader`…) se prêtent à un typage strict ; `tsconfig.json` en `strict` + `noUncheckedIndexedAccess`. |
| **Un seul `ShaderMaterial` custom dès le premier commit du globe**, plutôt qu'un matériau standard puis migration | Le relief/hillshading (spec 3, dette n° 4) s'ajoutera dans le même shader sans réécrire le pipeline de rendu ni la scène. |
| **Blue Marble NASA 4K committée sous `web/public/textures/`, pas sous `web/public/assets/`** *(2026-09-02)* | `_headers` donne aux fichiers hachés de `assets/` un cache `immutable` 1 an ; la texture, servie sous un nom stable, doit rester invalidable (`_headers` : `/textures/*` → `max-age=86400`). La loger sous `assets/` la figerait derrière un cache qu'on ne peut pas casser sans renommer le fichier. |
| **LUT de couleur en `SRGBColorSpace` `DataTexture`** *(2026-09-02)* | Le GPU décode alors la LUT en linéaire avant le mélange avec la heatmap dans le shader, au lieu de mélanger des octets sRGB bruts — évite un dégradé de légende visuellement différent du rendu 3D. |
| **Heatmap chargée en `ImageBitmap` avec `imageOrientation: "flipY"`** *(2026-09-02)* | Three.js ignore l'option `flipY` d'une `THREE.Texture` quand la source est un `ImageBitmap` ; l'orientation doit donc être corrigée en amont, au décodage. |
| **Rendu à la demande** (la boucle `requestAnimationFrame` ne dessine que sur mouvement des contrôles ou `requestRender()` explicite), pas une boucle continue *(2026-09-02)* | Le globe est une scène statique entre deux interactions (pas d'animation permanente) : dessiner en continu gâche batterie et GPU sur mobile pour rien. |
| **Pas de micro-benchmark GPU** pour choisir le tier ; ordre de priorité URL (`?tier=`) → nom du renderer WebGL → faisceau d'indices heuristique (§5 ligne « détection GPU ») *(2026-09-02)* | Un micro-benchmark coûte des frames au démarrage et son résultat varie avec la charge du moment ; le faisceau d'indices est immédiat et suffisant, le paramètre d'URL couvre les cas où il se trompe. |
| **`DataLoader.refresh()` non réentrant** : une promesse en vol est partagée plutôt que de relancer un fetch *(2026-09-02, trouvé en revue, §6)* | L'intervalle de 15 min et l'écouteur `visibilitychange` peuvent se déclencher au même instant ; sans garde, deux fetch concurrents pour la même donnée. |
| **Vitest réservé à la logique pure**, le rendu WebGL validé à l'œil et via Chrome DevTools MCP par les sous-agents d'implémentation *(2026-09-02)* | Un canvas WebGL ne s'assert pas utilement en test unitaire ; les 59 tests couvrent `metadata`, `sampling`, `colormap`, `tier`, `loader`, `format` (logique déterministe), pas la scène Three.js elle-même. |
| **`encoding` et `grid` lus depuis les métadonnées publiées par le pipeline côté front**, aucune constante recopiée *(2026-09-02)* | Honore côté front la dette n° 3 (§8), déjà résolue côté pipeline le 2026-08-30 : source de vérité unique, des deux côtés du contrat. |
| **Pyramide géodésique de tuiles 512 px, niveaux 0–8 pour `map`, 0–5 pour `sat`** *(2026-09-05)* | 512 px équilibre nombre de tuiles et poids réseau ; niveau 8 = zoom Normandie sans pixel visible (critère 2), niveau 5 suffit pour la Blue Marble (moins de détail utile que le relief/heatmap). |
| **Trois canaux de données par tuile `map` (R = hillshade, G = masque terre, B = frontières)**, un seul fichier PNG par tuile | Un seul fetch réseau par tuile porte tout ce dont le shader a besoin (relief + terre/mer + tracé des frontières), au lieu de trois requêtes. |
| **Index binaire `WTIX`** (bitmap y-majeur, 1 bit/tuile, LSB-first, arrondi à l'octet, jusqu'au niveau max de `map`) plutôt qu'un `HEAD` réseau par tuile | Savoir qu'une tuile est intégralement océan (donc non écrite, §5 ligne suivante) sans un aller-retour HTTP par tuile candidate — décisif pour la sélection LOD qui teste des dizaines de tuiles par frame. |
| **Tuiles `map` entièrement océan non écrites sur R2** | La majorité des tuiles aux niveaux fins sont de l'océan pur (aucune variation) : les omettre économise l'essentiel des 70 161 tuiles `map` et du volume R2 ; l'absence est distinguée d'un échec réseau par l'index WTIX, pas par un 404 interprété à la volée. |
| **Niveau 0 de `map` assemblé à part par le job `index`** (`build_level0`), pas généré comme les autres niveaux | Une tuile de niveau 0 (hémisphère entier) chevauche 4 dalles GEBCO à la fois ; l'assembler après coup à partir des blocs déjà découpés évite de retélécharger/recouper une géométrie différente juste pour ce niveau. |
| **Globe tuilé en quadtree de patches, un seul `ShaderMaterial` partagé entre tous les patches**, uniforms réécrits par patch (`uniformsNeedUpdate = true`) avant chaque tirage | Un matériau par patch multiplierait les compilations de shader et les changements d'état GPU ; le partage impose en contrepartie de repousser explicitement les uniforms au GPU à chaque patch, faute de quoi tous les patches affichent les données du dernier tracé (bug trouvé en revue, §6). |
| **Repli sur l'ancêtre** quand la tuile exacte n'est pas encore chargée (patch affiché avec la texture du parent recadrée via `subRect`), plutôt qu'un patch vide | Évite un trou visible pendant le chargement progressif ; le contenu est visuellement correct en moins précis, jamais absent. |
| **Filtrage bicubique Catmull-Rom en 9 prélèvements bilinéaires**, coordonnées en texels (`patch.frag.glsl`) | Élimine les losanges de l'interpolation bilinéaire native sur la heatmap au zoom maximal (critère 4) ; 9 taps bilinéaires reproduit un noyau 4×4 à moitié moins de textures lues qu'un Catmull-Rom naïf en 16 prélèvements ponctuels. |
| **Bouton « Température » qui remplace l'opacité par un binaire filtre on/off** (`uMapStyle` 0 ↔ 1, fondu linéaire piloté par la distance caméra, pas par l'utilisateur) | Un slider d'opacité laisse l'utilisateur choisir un mélange à mi-chemin en permanence, où le biais de perception (Sahara semblant plus chaud que l'Europe à cause de la texture satellite claire, §11 audit Ventusky de la spec) reste actif ; un binaire force soit la lecture pure de la température (LUT seule), soit la carte, jamais les deux mélangés par choix utilisateur. |
| **Hillshade GDAL sans exagération verticale** (`-alt 30`, pas de `-z`), `-s 111120` pour la conversion degrés→mètres | Une exagération (`-z` > 1) avait été ajoutée en cours d'exécution pour faire passer une fixture de test plate, puis rejetée (§6) : elle aurait saturé le relief réel en production. `-s 111120` convertit la résolution angulaire de GEBCO en mètres, faute de quoi le calcul de pente serait faux d'un facteur ~111 000. |
| **`zoomToCursor` retiré** (caméra centrée uniquement, pas de zoom vers le point sous le curseur) | `OrbitControls` avec `screenSpacePanning` déplace la cible pendant un zoom vers le curseur, ce qui invalide la garde de distance à l'origine (1,042) censée fixer l'altitude minimale ; reporté à la spec 4 plutôt que réimplémenté avec une cible fixe recalculée. |
| **Sélection LOD basée sur la hauteur CSS du canvas (`canvas.clientHeight`)**, pas la hauteur framebuffer | Choix de budget : sur un écran à `devicePixelRatio` élevé, éviter de charger le niveau le plus fin juste parce que le framebuffer est physiquement grand. Conséquence assumée et vérifiée (T17) : le niveau 8 n'est atteint qu'à partir d'environ 1200 px CSS de haut, donc invisible sur un portable 1280 × 800 aussi bien en tier `high` qu'en `low`. |
| **`mapStyleFor` avec le dénominateur `(1,25 − 1,12)`** plutôt que le littéral `0,13` | Mêmes constantes que la spec, mais écrites comme différence pour éviter un écart de précision IEEE-754 à la borne du fondu (ruling de revue, coût nul si faux). |
| **`isOcean` clampé à la profondeur de l'index WTIX** (retombe sur l'ancêtre le plus profond réellement couvert par l'index, pas sur `false` par défaut) | L'index ne descend pas jusqu'au niveau maximal de zoom ; sans clamp, une tuile plus fine que l'index se voyait attribuer `isOcean = false` par défaut, ce qui pouvait déclencher des requêtes pour des tuiles océan jamais écrites (§5 ligne tuiles océan). |
| **Génération des tuiles sur GitHub Actions** (`tiles.yml`, `workflow_dispatch` manuel, 8 jobs `map` matriciels + `sat` + `index`, ~3 h au total) plutôt qu'en local | GDAL n'a pas de roue Windows simple pour ce pipeline (même raison que `eccodes`, dette n° 2) ; matricer les 8 boîtes GEBCO en jobs parallèles ramène le temps total (3 h 01 mesuré) au temps du job le plus long plutôt qu'à leur somme (~15 h). |
| **Domaine personnalisé `globelayers.com` (Cloudflare Registrar)**, `data.globelayers.com` en front du bucket R2 | `r2.dev` est documenté par Cloudflare comme réservé au développement (« dev only », pas de garantie de disponibilité) ; un domaine personnalisé est nécessaire avant toute mise en production sérieuse, et regroupe site + données sous un même nom de marque. |
| **Cache Rule Cloudflare « cache tout, TTL selon `Cache-Control` d'origine » sur `data.globelayers.com`** | Un domaine personnalisé R2 ne met rien en cache edge par défaut (seuls certains types de fichiers le sont) ; sans cette règle, chaque lecture de tuile retourne à R2 au lieu d'être servie depuis le edge Cloudflare, ce qui coûte des lectures R2 (quota gratuit 10 M/mois) et de la latence. |
| **Dolly maison sur l'altitude `a = d − 1`** (`controls/zoom.ts`, `enableZoom = false`), OrbitControls conservé pour la rotation *(2026-09-06)* | OrbitControls multiplie la distance au centre `d` (`radius *= scale`) : à `d = 1,1` un pincement de 10 % double l'altitude, à `d = 4` il ne fait rien — cause structurelle de la dette n° 23. Une courbe en altitude donne 35 crans uniformes du globe entier au zoom Normandie (mesuré : rapports d'agrandissement 1,44 à `d` = 3, 1,5 et 1,1). Forker OrbitControls (1 900 lignes) ou tout réécrire aurait coûté plus pour 30 lignes changées. |
| **Zoom ancré par rotation de la caméra autour de l'origine** (`anchorRotate`, ≤ 6 itérations, arrêt sous 1e-3 px), cible OrbitControls jamais déplacée *(2026-09-06)* | `zoomToCursor` déplace la cible et casse la garde d'altitude (spec 3). Ramener le point saisi sous le curseur par `setFromUnitVectors` puis `lookAt(0,0,0)` garde la cible à l'origine ; `lookAt` annule le roulis et décale le point, d'où l'itération (convergence linéaire mesurée : 12 / 0,25 / 0,005 px à 30° du centre). |
| **Ancre conservée pendant un geste de molette tant que le curseur bouge de moins de 1 px** (`keepAnchor`) *(2026-09-06, validation navigateur)* | Reprendre l'ancre à chaque cran grave le résidu de convergence dans la nouvelle ancre, amplifié ensuite par le zoom restant (×71 en altitude) : dérive mesurée de 5 à 198 px au cadrage final selon la cadence des crans, 0,0002–0,3 px avec la garde. |
| **`enableRotate` d'OrbitControls coupé pendant un pincement** (`onPinch`), écouteurs `pointerup`/`pointercancel` de `attachZoom` en phase de capture *(2026-09-06, trouvés en revue, §6)* | À deux doigts avec `enableZoom` et `enablePan` faux, OrbitControls reste en état `TOUCH_ROTATE` et tourne depuis le milieu des doigts (saut au début du geste, double rotation). La capture fait passer `onPinch(false)` avant l'écouteur `pointercancel` d'OrbitControls (enregistré le premier sur le canvas), qui réarme sinon la rotation depuis une position périmée. |
| **Picking analytique sur la sphère unité** (`render/pick.ts`), pas de raycast sur les meshes *(2026-09-06)* | Indépendant des patches chargés, des jupes et de `frustumCulled = false` ; une intersection rayon–sphère coûte quelques multiplications, un raycast parcourt le quadtree. |
| **Valeurs du tooltip lues sur le CPU dans les pixels du PNG heatmap** (canvas 2D réutilisé, `bitmapPixels`, ≈ 4 Mo par rafraîchissement) plutôt qu'un `readPixels` WebGL *(2026-09-06)* | Une lecture GPU par frame bloque le pipeline de rendu ; le PNG est déjà décodé en `ImageBitmap`, le redessiner une fois toutes les 15 min dans un canvas 2D coûte une fraction de seconde et sert toutes les lectures suivantes. Le bitmap étant créé `flipY`, le dessin re-retourne pour livrer des lignes nord en haut, comme le PNG. |
| **Un seul modèle de tooltip** : une lecture `{lon, lat}` ancrée sur le globe, projetée à chaque rendu ; seule l'entrée diffère (survol souris, tap tactile) *(2026-09-06)* | Le tooltip suit le globe quand on tourne et disparaît derrière l'horizon sans code spécifique par mode ; `aria-live` « polite » seulement en mode épinglé (un survol annoncerait chaque mouvement de souris au lecteur d'écran). |
| **Fondu satellite → carte resserré à `d` ∈ [1,20 ; 1,14]** (constantes `MAP_FADE_START/END`) *(2026-09-06)* | Plage 1,25 → 1,12 jugée molle ; validé à l'œil (satellite pur à 1,20, carte pure à 1,14, aucun réglage supplémentaire). |
| **Volume mesuré ≈ 4,5 Go accepté pour la v1** (70 161 tuiles `map`, PNG RGB peu compressible) malgré l'estimation initiale de la spec (< 1,5 Go) | Reste sous les 10 Go du plan R2 gratuit ; compression (palette/quantification) à revoir en v2 plutôt que de retarder la v1 pour une optimisation non bloquante. |
| **Approche A : pipeline généralisé, un PNG 8 bits par couche, un manifeste unique** *(2026-09-12, spec couches)* | Écarte B (empaquetage RGB de trois variables : PNG plus lourd, cadences GFS 1 h / GEFS 3 h incompatibles dans un même fichier) et C (un workflow + un manifeste par source : double plomberie CI, secrets dupliqués, fusion de manifestes côté front). A isole déjà les sources en modules Python (`layers.py`/`sources.py`) et tolère l'échec de la source secondaire sans double infrastructure. |
| **Encodage 8 bits à la racine (`sqrt`) pour pluie/PM2.5/poussière**, linéaire pour temp/nuages/pression/humidité | Donne la finesse là où elle compte (pluie 0–2 mm/h sur 51 niveaux au lieu de 10, PM2.5 sur 67 niveaux au lieu de 18) à coût nul au rendu : la LUT reste indexée par l'octet brut, le shader ne change pas côté échantillonnage. |
| **Une seule couche affichée à la fois** (radio, façon Ventusky), pas d'empilement | Décision de brainstorming ré-confirmée en spec : empiler des couches multiplierait les seuils de transparence à arbitrer et rendrait la légende ambiguë ; l'empilement reste au backlog (spec §16). |
| **GEFS-Aerosols (NOMADS) plutôt que CAMS (ADS) ou GEOS-CF (NASA)** pour `pm25`/`dust` | Même mécanique de téléchargement que GFS, aucune clé API à gérer (CAMS en réclame une) ; GEOS-CF vu instable en reconnaissance. Coût : résolution plus grossière (0,25°) et cadence 3 h au lieu de 1 h, documenté par `valid_time_utc` par couche. |
| **Poussière = PM10 (`PMTC` Dust Dry)**, pas PM2.5 fine | Les tempêtes de sable, cas d'usage visé, sont dominées par les particules 2,5–10 µm ; `PMTC` les capture, `PMTF` (déjà utilisé pour `pm25`) non. |
| **Source secondaire (GEFS-chem) tolérante** : un échec reporte les entrées `pm25`/`dust` du manifeste courant (PNG intacts, `generated_at`/`valid_time_utc` anciens) plutôt que de faire échouer le run | La qualité de l'air est une couche parmi sept, pas critique comme la température ; faire échouer tout le run pour une source secondaire pénaliserait les 5 couches GFS pour rien. Sans manifeste courant, les couches chem sont simplement omises (pas de bouton). |
| ~~`gfs/latest.*` (schema 1) republié une version supplémentaire~~ en plus de `layers/latest.json` (v2) | Clients déjà chargés sur l'ancien contrat. **Retiré le 2026-09-13** (`596b247`, T1 de la spec vent, dette n° 31 §8 résolue) : `LEGACY_PNG_KEY`/`LEGACY_JSON_KEY`/`LEGACY_SCHEMA_VERSION`/`build_legacy` supprimés, objets R2 à effacer à la main après déploiement. |
| **Vent en surimpression combinable** (switch « Vent » indépendant du radio de couches, `?wind=1\|0`), pas en 8ᵉ couche *(2026-09-13, spec vent §1)* | Le vent complète n'importe quelle couche affichée (ou aucune) plutôt que de s'exclure avec elle ; un radio supplémentaire aurait forcé un choix entre température et vent. |
| **10 m seulement pour le vent**, pas d'altitude sélectionnable *(2026-09-13)* | Seule variable disponible aux deux cadences GFS (1 h) sans coût de contrat supplémentaire ; une sélection d'altitude est un backlog séparé (lot C ou au-delà). |
| **Approche A : simulation CPU (`WindSim`) + un seul `LineSegments`** (tampon slot-major `[K][N][xyz]`, `copyWithin`, upload complet par tick, `aAlpha` statique) plutôt que des particules GPU en ping-pong *(2026-09-13)* | Des traînées écran en ping-pong doivent être effacées à chaque rotation de caméra (sans quoi elles restent peintes sur un canvas qui n'est plus le bon repère), réclament des render targets flottants (extensions WebGL non garanties sur mobile) et ne sont testables qu'à l'œil ; la simulation CPU est pure, testée par Vitest, et les positions vivent directement sur la sphère (rayon 1,002), sans dépendre du point de vue. |
| **Deux entrées scalaires `wind_u`/`wind_v`** (`Encoding(-60, 60, "linear")`) plutôt qu'un PNG RGB combiné *(2026-09-13)* | Le pipeline généralisé (spec couches) traite déjà chaque variable comme une couche scalaire indépendante ; encoder U/V dans les canaux d'un même PNG aurait exigé un format de sortie spécial pour une seule paire de couches. |
| **Upload complet du tampon de positions à chaque tick**, pas de `updateRange`/sous-plage *(2026-09-13)* | `copyWithin` décale la totalité du tampon slot-major à chaque tick (toutes les positions changent de slot) : une mise à jour partielle n'aurait rien économisé pour la complexité qu'elle ajoute. |
| **Vitesse apparente constante : 2 px CSS/s par m/s** (`PX_PER_S_PER_MS`), indépendante du zoom *(2026-09-13)* | Une vitesse à l'échelle du globe (en radians/s) rendrait les traînées quasi immobiles dézoomé et follement rapides zoomé ; fixer la vitesse en pixels écran garde une lecture visuelle cohérente à toute distance. |
| **Spawn uniforme en NDC via `pickSphere`**, pas uniforme sur la sphère (lon/lat) *(2026-09-13)* | Un spawn uniforme en lon/lat sur-échantillonne les pôles vus en projection ; repartir du picking écran existant (`render/pick.ts`) donne une densité visuelle uniforme à l'écran, qui est ce que l'œil compare. |
| **Vent actif par défaut seulement en tier `high`**, inactif en `low` et sous `prefers-reduced-motion` *(2026-09-13)* | 12 000 particules à 30 Hz est un budget CPU/GPU jugé trop lourd pour le tier `low` (déjà dégradé sur d'autres axes, §5 ligne tier low) ; `prefers-reduced-motion` est un signal d'accessibilité explicite de l'utilisateur, prioritaire sur la détection de tier. |
| **`SceneHandle.onFrame(cb)`** : rendu continu seulement tant qu'au moins un abonné est actif, sinon rendu à la demande inchangé *(2026-09-13)* | Préserve le « 0 draw call au repos » (§5 ligne rendu à la demande, spec 2) quand le vent est inactif, sans dupliquer la boucle rAF de `scene.ts`. |
| **LRU de 2 `LayerLoader`** (couche active + précédente), pas plus | Change-and-forget entre deux couches typique de l'usage (comparer A puis B) sans garder les sept en mémoire ; l'éviction dispose texture et pixels CPU. |
| **LUT 256×1 indexée par l'octet brut, inchangée côté échantillonnage du shader** | La racine ne coûte rien au rendu : `buildLut(def, enc)` précalcule `decode(i)` par texel, le shader continue de lire `texture2D(uLut, vec2(t, 0.5))` comme pour la température seule. |
| **Isobares dans le shader** (`isoline(t, spacing)`, `fwidth`), pas de couche vectorielle séparée | `t` (octet normalisé) encode déjà la pression ; une fonction de distance au multiple de pas le plus proche, anti-aliasée par `fwidth`, évite de calculer/streamer un tracé de lignes séparé pour un seul usage. |
| **`formatBanner(entry, nowMs, timeZone?)` sans paramètre `def`** *(T11, ruling de revue)* | Le bandeau ne dépend que de la source (modèle, run, échéance), jamais de la couche affichée ; porter `def` dans la signature était un paramètre mort du plan. |
| **Bornes plausibles pm25/dust élargies** `(0, 2000)`/`(0, 5000)` µg/m³ → `(0, 20 000)`/`(0, 50 000)` *(T7, post-revue)* | Un run réel a produit `pm25` = 3 187 µg/m³, au-delà de la borne T4 : GEFS-chem échouait donc sa validation systématiquement en conditions réelles. Garde-fou d'ordre de grandeur seulement ; `Encoding` d'affichage (`sqrt` 0→500 / 0→2000) inchangé, l'octet sature au-delà (dette n° 32, §8). |
| **`WindField` en un seul tableau d'octets entrelacé `uv` (2 Mo) + `sampleUV` fusionné sans allocation**, plutôt que deux tampons RGBA décodés séparément par `sampleValue` *(2026-09-13, revue finale + vague de correction, `e4b4d6a`)* | Le tick mesuré en revue finale coûtait 9–15 ms avec un champ réel (24 000 appels `sampleValue`/tick, chacun une closure allouée, un `decode()`, un `Math.hypot` et une allocation `vec3ToLonLat`) contre 4,57 ms mesurés sur une grille de test 8×5 cache-chaude, non représentative. `sampleUV` réutilise le même maillage cellulaire que `sampleValue` (accord vérifié à 1e-9) mais décode u et v en une seule passe, sans allocation ; le tampon entrelacé réduit aussi l'empreinte mémoire de 8 à 2 Mo et met u/v d'un même pixel sur la même ligne de cache. |
| **Seuil d'horizon exact** `(1 + √((d²−1)(R²−1))) / (d·R)` **pour un point à rayon R**, plutôt que `1/d` (valable seulement pour R = 1) *(2026-09-13, revue finale, `73b3687`)* | Les traînées de vent vivent au rayon 1,002 (au-dessus de la sphère unité) ; le seuil `1/d` hérité du picking (spec tuiles §5, où R = 1) laissait une bande de surface d'environ 3,6° se dessiner au-delà du limbe visible. |
| **Statut « Vent indisponible » affiché avec le switch laissé actif**, même quand l'ancien champ continue de s'animer après un second échec au même `generated_at` *(2026-09-13, ruling du contrôleur pendant la vague de correction, confirmé par la re-revue, déviation assumée de la spec §11)* | La spec §11 prévoit un switch désactivé sur échec ; un switch grisé empêcherait l'utilisateur de couper lui-même une animation qu'il ne veut plus voir, sans rien y gagner puisque le statut informe déjà de l'indisponibilité. |
| **Critère 8 de la spec vent révisé par l'utilisateur** : « tick ≤ 4 ms » → « 30 ticks/s tenus et tick + rendu ≤ 50 % du budget de frame (≤ 16 ms) sur la machine de référence » *(2026-09-13, après validation navigateur)* | Un tick seul de 10,9–13,2 ms était mesuré aussi bien en dev qu'en build de prod sur la machine de référence (Intel UHD 620, 4 cœurs), avec un micro-benchmark de lectures brutes à 1 ms (donc le moteur JS n'est pas en cause) et un bench Node du relecteur à 6,2 ms pour le seul échantillonnage : 4 ms n'est pas atteignable sur ce matériel avec un champ réel, alors que la fluidité perçue (30 ticks/s, rAF 60 Hz, 0 jank) est tenue. Le critère révisé mesure ce qui compte réellement (le budget de frame partagé avec le rendu), pas un chiffre absolu hérité d'une estimation optimiste. |
| **Traînées de vent en quads instanciés de 2 px** (plus liseré de teinte opposée) plutôt que `LineSegments` *(2026-09-18, demande utilisateur)* | `gl.lineWidth` est ignoré par ANGLE : un `LineSegments` reste à 1 px et se perdait sur la température jaune-orange, surtout sur terre. `aStart`/`aEnd` lisent le **même** tampon de simulation décalé d'un slot (offset d'`InterleavedBufferAttribute` > stride, non borné par three) : aucune copie CPU, un seul upload. |
| **Profils vent révisés : 5 000/K9 `high`, 1 500/K5 `low`, `stride` 3, P = 3 px/s par m/s** — remplace 12 000/12, 3 000/8, P = 2 de la spec vent §7 *(2026-09-18, demande utilisateur, réglé à l'œil sur la France)* | « Trop nombreuses et trop petites ». À P = 2 un vent de 5 m/s donnait une traînée de 4 px (un point). `stride` : à 30 Hz un segment par tick mesure ≤ 2 px, et chaque segment est une instance à dessiner — 115 000 instances (essai 5 000/K24) coûtaient ~10 ms GPU sur l'UHD 620 en dev ; 40 000 segments de 3 ticks donnent la même longueur (24 ticks). Tick 6,4 ms (11 avant), 60 fps sur le build. |
| **Nuages adoucis par un flou gaussien CPU au chargement** (`LayerDef.soften`, σ = 1,2 cellule, `data/blur.ts`) plutôt qu'un noyau plus large dans le shader ou un flou dans le pipeline *(2026-09-18, demande utilisateur)* | Le Catmull-Rom était déjà appliqué aux nuages : les bords carrés viennent de la **donnée** (TCDC saute de 0 à 100 % entre cellules voisines). Flou une fois par PNG, coût nul par frame, σ réglable par couche ; la donnée publiée et le tooltip (pixels bruts) restent exacts. Activable pour la pluie en une ligne. |
| **Pluie adoucie aussi, σ = 0,8 cellule** plutôt que le 1,2 des nuages *(2026-09-18, demande utilisateur, à juger en prod)* | Même défaut de fronts raides. Un σ de 1,2 ramène une cellule isolée à ~11 % de son octet : en encodage racine, un cœur d'averse d'une ou deux cellules disparaîtrait de la palette. 0,8 en garde ~25 %. |
| **σ de la pluie ramené de 0,8 à 0,4** *(2026-09-18, verdict utilisateur sur la prod)* | À 0,8 « trop flou, on perd trop d'information » : les bandes spiralées et les cœurs d'un cyclone au sud du Japon, nets sans flou, se fondaient. À 0,4 le noyau garde ~92 % du poids sur la cellule centrale : il casse juste l'arête des marches. La structure fine de la pluie est de l'information, contrairement aux bords des nuages. |
| **Flou retiré de la pluie : `soften` reste propre aux nuages** *(2026-09-18, verdict utilisateur final)* | À 0,4 « pratiquement aucune différence avec ou sans » ; à 0,8 trop flou. Aucun σ utile entre les deux : le rendu bicubique brut de la pluie convient, sa structure fine est de l'information. Ne pas reproposer de flou sur la pluie. |
| **Lot C : étiquette de ville = nom + valeur de la couche active**, pays = nom seul ; deux interrupteurs indépendants « Étiquettes » / « Fleuves » actifs par défaut *(2026-09-18, brainstorming)* | Lire la température à Paris sans survoler, façon Windy. La valeur vient de la lecture CPU déjà faite pour le tooltip : coût marginal. Interrupteurs séparés : on peut vouloir les noms sans les fleuves, ou une vue dégagée. |
| **Étiquettes en éléments HTML positionnés par `projectToScreen`**, plutôt que `CSS2DRenderer` ou du texte GPU *(2026-09-18)* | ≤ 60 étiquettes : le DOM suffit, texte net, accents et halo en CSS, zéro dépendance ; l'anti-chevauchement est une fonction pure testable. `troika` = +100 Ko pour rien. |
| **Densité des villes par priorité + palier de zoom + anti-chevauchement + plafond**, pas un seuil de population fixe ; **Natural Earth** plutôt que GeoNames *(2026-09-18)* | Un seuil fixe rend l'Europe illisible et la Sibérie vide. La grille GFS fait 25 km : plus de 7 300 villes n'apporte rien. |
| **Fleuves en lignes vectorielles** (quads instanciés, fragment GLSL partagé avec le vent), pas dans les tuiles carte *(2026-09-18)* | Les trois canaux des tuiles sont pris ; un quatrième imposerait de régénérer la pyramide. Données statiques commitées : versionnées avec le code, hors R2 et hors CI. |
| **Budget des fleuves relevé de 25 000 à 50 000 segments** (tolérance 0,02°, 45 663 segments) *(2026-09-18, accord utilisateur après validation)* | À 0,045° les méandres étaient anguleux sous d ≈ 1,2. Coût mesuré non mesurable : 56 fps avec vent + fleuves contre 55 sans (UHD 620). |
| **Micro-États rétrogradés par la population** : pays < 200 000 hab. → rang + 2 (hors palier) ; capitale < 100 000 hab. → garde `cap` = 1 (toujours éligible) mais se classe par population *(2026-09-18, validation navigateur)* | « Cité du Vatican » masquait Rome, puis « Monaco » masquait Marseille. `LABELRANK` 6 mélange micro-États et vrais pays, `TINY` est incohérent : la population est le seul critère fiable. Les petites capitales s'affichent encore là où rien ne leur dispute la place (États insulaires). |
| **Plafond des écrans étroits aux deux tiers** (40/20) au lieu de la moitié validée en spec ; **marge de limbe** 0,92 ; **variante sombre** des étiquettes en style carte sans couche *(2026-09-18, validation navigateur ; plafond confirmé par l'utilisateur sur vrai téléphone le 2026-09-19 : « tout est bon »)* | Mobile `low` sous-rempli à 15 étiquettes dont 8 pays ; texte débordant hors du disque à d = 3 ; blanc illisible sur le fond clair du style carte. |
| **Câblage geo extrait en `wireGeo` à dépendances injectées** + `setupGeo` pour l'assemblage réel, plutôt qu'un simple déplacement de code *(2026-09-19, dette n° 42)* | Le défaut de `main.ts` n'était pas sa longueur mais l'absence de test : I1 (lot C) et le TDZ (lot vent) étaient des bugs de réentrance invisibles à Vitest. Boutons, scène, réseau et URL injectés → la bascule pendant un téléchargement se teste en Node. |
| **Les étiquettes évitent les panneaux de l'interface et le bord de l'écran par la boîte estimée**, dans `selectLabels` (`bounds`, `obstacles`), pas par une marge fixe dans `projectToScreen` *(2026-09-19, dette n° 41)* | Les panneaux changent de taille et de place (mobile, légende, repli) : leurs rectangles réels ouvrent la liste des boîtes occupées, même test que l'anti-chevauchement. Re-sélection forcée au repli/dépli (`relayout`). |
| **Variante sombre des étiquettes indexée sur « une couche est affichée »** (`layerShown`), plus sur la présence de pixels lisibles ; **pays de rang > 7 non écrits** dans `countries.json` (`MAX_COUNTRY_RANK`, miroir de `COUNTRY_TIERS`) *(2026-09-19, dette n° 41)* | Une couche sans pixels CPU colore quand même le globe : texte sombre illisible. 36 lignes qu'aucun palier n'affiche : poids mort ; à relever en même temps que les paliers. |

## 6. Problèmes rencontrés & solutions

*(Y consigner les défauts non triviaux, surtout ceux trouvés par une revue plutôt
que par un test : ce sont eux qui se reproduisent.)*

| Date | Problème | Solution / leçon |
|---|---|---|
| 2026-08-29 | **Hypothèse « NOMADS OpenDAP `tmp2m`, zéro GRIB, zéro eccodes »** proposée pour contourner l'absence d'`eccodes` sur Windows. Vérifiée par `curl` avant d'être recommandée : **le service OpenDAP/GrADS de NOMADS est retiré** (avis NOAA SCN25-81, HTTP 301 vers une page de retrait). | Le GRIB2 est inévitable ; d'où l'approche A (§5). Leçon : **vérifier un endpoint externe avant de bâtir une approche dessus**, un `curl` coûte moins qu'une spec à réécrire. `filter_gfs_0p25_1hr.pl` vérifié vivant le même jour (516 Ko pour `TMP` 2 m, un pas horaire). |
| 2026-08-30 | Deux défauts trouvés en revue (aucun par test, hors CI) pendant l'exécution subagent-driven : un `pytestmark` **au niveau module** sur `test_grib_adapter.py` sautait aussi le test d'importabilité censé prouver que le module se charge sans `cfgrib` ; l'étape dry-run de `test.yml` était sautée dès que `history_check` échouait, privant le diagnostic de son artefact. | Corrigés respectivement en isolant le skip sur le seul test qui dépend de `cfgrib`, et en ajoutant `if: always()` (§5). Leçon : **un skip au niveau module désactive aussi les tests qui prouvent l'absence de dépendance** — à réserver au cas par cas. |
| 2026-09-02 | `#fatal { display: grid }` en CSS écrasait la règle UA `[hidden] { display: none }` sur le même élément : page entièrement noire au tout premier lancement (avant tout fetch), l'écran d'erreur fatale restant visible par-dessus le canvas alors qu'il portait l'attribut `hidden`. | Corrigé par `#fatal[hidden] { display: none }` (et symétriquement `#overlay[hidden]`). Leçon : dès qu'une règle CSS fixe `display` sur un sélecteur d'ID, l'attribut `[hidden]` a besoin d'un override explicite au même niveau de spécificité, sinon `display` gagne. |
| 2026-09-02 | `DataLoader.refresh()` réentrant, trouvé en revue : l'intervalle de rafraîchissement (15 min) et l'écouteur `visibilitychange` peuvent se déclencher au même instant et déclenchaient chacun un fetch, doublant la requête. | Corrigé par une promesse en vol partagée (guard de réentrance) — voir §5. |
| 2026-09-02 | Sur mobile (≤ 600 px), la légende et le slider se chevauchaient : les deux panneaux occupaient la même 3ᵉ ligne de la grille CSS. Trouvé par la validation visuelle propre à la tâche (pas en revue). | Corrigé en ajoutant une 4ᵉ ligne à la grille de l'overlay (`web/src/style.css`). La revue de la même tâche a par ailleurs ajouté le bouton de rechargement sur `webglcontextlost` et le repli (collapse) de l'overlay que le plan avait laissé tomber depuis la spec §5. |
| 2026-09-02 | Revue finale de branche : `#status` sans `grid-row`/`align-self` était auto-placé dans la ligne `1fr` de la grille et s'étirait sur toute la hauteur avec `pointer-events: auto`, bloquant la rotation du globe précisément dans les états dégradés de la spec §7. | `align-self: start` ; leçon : dans une grille avec une ligne `1fr`, tout panneau flottant doit fixer son alignement, sinon il remplit la ligne. |
| 2026-09-02 | Revue finale : le statut « Mise à jour impossible » posé par le `catch` de `applyData()` était effacé sous 60 s par le timer du bandeau, qui recalculait le statut sans connaître l'échec. | Drapeau `updateFailed` levé dans le `catch`, abaissé au prochain `refresh()` réussi, lu par `refreshBanner()`. Leçon : un état affiché par deux chemins doit dériver d'une seule variable, pas de deux écritures concurrentes. |
| 2026-09-05 | `workflow_dispatch` de `tiles.yml` renvoyait `404 workflow not found` : GitHub n'expose le déclenchement manuel que pour les workflows présents sur la branche par défaut, quelle que soit la `--ref` visée. `tiles.yml` n'existait que sur `feat/tiles`. | Résolu par la **PR #1** (branche `ci/register-tiles-workflow`, uniquement le fichier de workflow) mergée sur `master` par l'utilisateur (`d83e05e`) — un push/merge direct vers `master` était bloqué par le classificateur de permissions de la session. Leçon : enregistrer un nouveau workflow manuel sur `master` **avant** de développer dessus, sur une branche dédiée minimale. |
| 2026-09-05 | Téléchargement de la Blue Marble NASA (190 Mo) coupé en cours de transfert par le serveur (`curl: (18) transfer closed with N bytes remaining`), non couvert par `--retry` (curl ne classe pas l'erreur 18 comme transitoire). | `curl -C -` (reprise du fichier partiel) + `--retry-all-errors` + boucle de secours à 3 tentatives, sur les 4 téléchargements du job `map` (commit `9725961`). |
| 2026-09-05 | Le job `map (2)` (boîte la plus terrestre) a pris 2 h 55 sur le run v1, dominé par des téléchargements CEDA lents (GEBCO), proche de la limite de 6 h d'un job Actions. | Accepté sans optimisation pour la v1 (ruling explicite) ; si un futur run dépasse la limite, relancer boîte par boîte avec `--min-level`. |
| 2026-09-05 | `rclone copyto` a rencontré une erreur transitoire 501 `NotImplemented` sur les 4 petits objets du job `index` (2 tuiles niveau 0, `index.bin`, `manifest.json`), résolue au 2ᵉ essai par les retries internes de rclone. | Aucune action requise (le run a terminé vert) ; `--retries 5` explicite ajouté par précaution sur les deux `rclone copyto` concernés (`f18a90c`). |
| 2026-09-05 | `cf-cache-status: DYNAMIC` persistant sur les requêtes `HEAD` (`curl -I`) contre `data.globelayers.com`, malgré une Cache Rule confirmée correcte côté plan de contrôle (API Request Trace). | Fausse alerte : les requêtes `HEAD` ne sont jamais mises en cache par Cloudflare. En `GET` réel, le comportement est `MISS` puis `HIT` avec `Age` croissant — vérifié par le contrôleur sur les tuiles et `index.bin`. |
| 2026-09-05 | Dérive de la cible de caméra avec `zoomToCursor` activé : `OrbitControls` déplace la cible (`screenSpacePanning`), invalidant la garde de distance minimale à l'origine. | `zoomToCursor` retiré, caméra recentrée sur l'origine (§5) ; réimplémentation possible en spec 4 avec une cible fixe recalculée. |
| 2026-09-05 | **Jupes des patches de tuiles inversées** (orientées vers l'intérieur au lieu de l'extérieur) dans le code fourni par le plan — prouvé par calcul (produit vectoriel des sommets) par le reviewer, pas par un test qui existait déjà. | Corrigé immédiatement (T11, pas reporté) avec un test d'orientation dédié (`eefd53b`) ; sans lui, des fissures seraient apparues entre patches adjacents à l'usage. |
| 2026-09-05 | Un sous-agent d'implémentation avait ajouté `-z 40` (exagération verticale GDAL) pour faire passer une fixture de test au relief trop plat, réglant ainsi le code de production sur le test. | Rejeté en revue ; corrigé en rendant la fixture elle-même pentue (`-scale`, Float32) plutôt qu'en exagérant le rendu réel — un `-z` par niveau reste une option future si le hillshade grossier paraît trop doux à l'œil. |
| 2026-09-05 | **Uniforms non renvoyés au GPU** avec un `ShaderMaterial` partagé entre patches : sans `uniformsNeedUpdate = true` avant chaque tirage, tous les patches affichaient la texture/les paramètres du dernier patch dessiné. Trouvé en revue finale (Important), pas par un test. | Corrigé (`ffc0d71`) : `uniformsNeedUpdate = true` posé juste avant chaque appel de rendu par patch. Leçon : partager un matériau entre objets qui varient par uniform exige de forcer explicitement leur re-synchronisation, Three.js ne le fait pas seul. |
| 2026-09-05 | `ocean_only()` avec les réglages de rasterisation par défaut (sans `-at`, centre de pixel) manquait des îlots plus petits qu'un pixel de la sonde 64×64, les classant à tort comme océan pur (donc tuile non écrite alors qu'elle contient de la terre). Trouvé en revue finale (Important). | `all_touched=True` (`-at`) ajouté spécifiquement à la sonde de `ocean_only`, le masque terre normal (rendu des tuiles) reste inchangé ; test dédié avec un îlot de 0,002° (`f18a90c`). |
| 2026-09-06 | **OrbitControls reste en `TOUCH_ROTATE` à deux doigts** quand `enableZoom` et `enablePan` sont faux (`_onTouchStart` cas 2 retourne avant de changer l'état) : pendant un pincement, il tournait depuis le milieu des doigts, avec un saut d'environ 20° au premier mouvement. Trouvé en revue T3 (Important), prouvé sur la source vendorisée, pas par un test. | `ZoomOptions.onPinch(active)` → `controls.enableRotate = !active` (`f5f041a`). Leçon : désactiver une fonction d'OrbitControls ne vide pas sa machine à états ; lire le code du gestionnaire concerné avant de coexister avec lui sur le même canvas. |
| 2026-09-06 | Ordre des écouteurs : sur `pointercancel`, l'écouteur d'OrbitControls (enregistré le premier sur le canvas) réarmait `_rotateStart` pendant que `enableRotate` était encore faux, puis notre `onPinch(false)` le rétablissait — saut au prochain mouvement du doigt survivant. Trouvé en re-revue. | Écouteurs `pointerup`/`pointercancel` de `attachZoom` en phase de capture (`ab888e7`) : sur la cible elle-même, la capture précède les écouteurs bubble quel que soit l'ordre d'enregistrement. |
| 2026-09-06 | **Dérive du zoom ancré au cadrage final** (critère 1 en échec : 5 px à 1 cran/500 ms, 16 px à 60 ms, 198 px à 30 ms) alors que l'erreur par cran restait sous 0,1 px. Trouvé par la validation navigateur (DevTools MCP), reconstruit arithmétiquement (Σ résidu × a_i/a_final ≈ 13,9 vs 14,0 mesuré). | Garde `keepAnchor` (ancre conservée si le curseur bouge de moins de 1 px) + ε 0,1 → 1e-3 px, 6 itérations (`3ee3c2a`) : 0,0002 px re-mesuré. Leçon : un critère « < 2 px » se mesure avec le geste réel (cadence des crans), pas seulement par cran. |
| 2026-09-06 | Revue finale : la spec décrivait encore « nouvelle ancre à chaque événement », 4 itérations / 0,1 px, et ignorait `onPinch`, `keepAnchor`, `hitMarker`, `ndcFromCanvas`, la capture — six écarts nés des rulings d'exécution. | Spec resynchronisée (`2454f3e`) ; leçon : chaque ruling de revue qui change un comportement documenté doit toucher la spec dans le même round, sinon la « source de vérité » contredit le code. |
| 2026-09-05 | Un run partiel (moins de 8 boîtes) avec `upload=true` aurait écrasé `index.bin`, le niveau 0 et `manifest.json` sur R2 avec un jeu incomplet, invalidant l'index pour tout le monde. Trouvé en revue finale (Important). | Step d'envoi R2 conditionné à `FULL_SET` (les 8 boîtes exactement) ; avertissement explicite sinon (`f18a90c`). |
| 2026-09-12 | **Unités PMTF/PMTC déjà en µg/m³ dans le GRIB réel** — la spec supposait kg/m³ (`convert = ×1e9`). Clé eccodes `units` du message = `(10**-6 g) m**-3`, maxima observés 502 et 2416 sur la fixture. | `convert` fixé à l'identité pour `pm25`/`dust`, plages plausibles ajustées en conséquence (T4) ; spec §3 corrigée en T16 avec la mention « corrigé à l'exécution ». |
| 2026-09-12 | `typeOfLevel` réel de `TCDC` (nuages) est `atmosphere`, pas `entireAtmosphere`/`atmosphereSingleLayer` supposé par la spec ; en plus, le fichier NOMADS porte `TCDC:entire atmosphere` **deux fois** (instantané et moyenne 0–4 h). | `grib_keys` fixées sur la fixture réelle (`shortName tcc`, `typeOfLevel atmosphere`, `stepType instant`) pour lever l'ambiguïté entre les deux messages (T4) ; spec §3 corrigée en T16. |
| 2026-09-12 | Bornes plausibles `pm25`/`dust` de T4 `(0, 2000)`/`(0, 5000)` µg/m³ trop étroites : le dry-run CI contre NOMADS réel (run 34709677549) a produit `pm25` = 3 187 µg/m³, rejeté par la validation, chem reportée systématiquement en conditions réelles. | Élargies à `(0, 20 000)`/`(0, 50 000)` µg/m³ (T7 post-revue, commit `85ab007`) ; run suivant (34710076060) vert avec les 7 couches (`pm25` max 2 684, `dust` max 13 377). Encodage d'affichage (`sqrt` 0→500/0→2000) inchangé, sature au-delà (dette n° 32, §8). |
| 2026-09-12 | Demi-entiers de quantification : `np.rint` (arrondi au pair) côté Python et `Math.round` côté JS divergent exactement sur les .5 — un cas de test `roundtrip` initial (15 °C → pixel 178,5) tombait sur cette frontière. | Cas de test déplacé à une valeur qui ne tombe pas sur un .5 exact (20 °C → 187) dans la table de cas partagée Python/TS (T3/T8, corrigé avant exécution, cf. ledger). |
| 2026-09-12 | `float32` 273,15 : `ramp_row[...] − 273.15` en `float32` (NEP 50, promotion faible) donne un résultat légèrement différent du chemin réel du pipeline (`float64` avant soustraction), juste assez pour changer l'arrondi 8 bits à une valeur de test tombée pile sur une frontière de quantification (25,0 °C → x·255 = 195,5). Trouvé en TDD (T7). | Fixture de test castée en `float64` avant soustraction pour reproduire exactement `layer_pixels` ; `main.py` non modifié (écart de fixture, pas de pipeline). |
| 2026-09-12 | Fixture `test_chem_failure_carries_over_previous_entries` « à jour » sans le vouloir : le manifeste courant simulé ne surchargeait pas `chem`, qui restait donc déjà à jour (idempotence par source) — le test ne testait pas ce que son nom prétendait (0 téléchargement chem au lieu de l'échec attendu). Trouvé en TDD (T7). | Fixture corrigée pour que `chem` soit réellement périmé (même motif que le test voisin), exerçant réellement le mock d'échec de téléchargement. |
| 2026-09-12 | Trailers de commit `Co-Authored-By: Claude Haiku 4.5` sur 3 commits poussés (`ea54908`, `680525a`, `7194396`) — modèle d'implémenteur incorrect dans le trailer. | Réécriture prévue par `msg-filter` + force-push de `feat/layers` avant merge (branche personnelle) — ruling T5, non encore exécutée à la date de cette entrée. |
| 2026-09-12 | Agent de validation navigateur coupé par la limite de session après le câblage `main.ts` (T15), puis `mcp__claude-in-chrome__*` et `chrome-devtools-mcp` tous deux injoignables dans la session suivante. | Signalé BLOCKED sans boucler (consigne de la brief) ; validation reprise dans une session ultérieure où `mcp__brave-devtools__*` fonctionnait — 9/9 points mesurés (`.superpowers/sdd/2026-09-12-layers/validation-report.md`). |
| 2026-09-12 | Revue de code sur `activate()` (`web/src/main.ts`, `0f8f1dc`) : (1) `ui.setStatus("Couche indisponible")` non gardé par `activeId === id`, un statut d'échec tardif pouvait écraser celui d'une couche déjà activée entre-temps ; (2) repli récursif `activate(previous, …)` sans vérifier l'ensemble `failed`, risque de rebond réseau indéfini entre deux couches en échec persistant (panne R2). | Statut et repli conditionnés à `activeId === id` ; repli exclu explicitement de `failed` en plus de `previous`/`id` (`51c5d4a`). |
| 2026-09-13 | Le plan de la spec vent (tests T6) supposait à tort que Float32 stocke `RADIUS = 1,002` avec assez de précision pour `toBeCloseTo(RADIUS, 9)`, et qu'une vitesse ronde (10 m/s, 0 m/s) survit exactement à un aller-retour par l'octet 8 bits de l'`Encoding(-60, 60, "linear")`. Aucun des deux n'est vrai : 10 m/s décode 10,1176 m/s après quantification, 0 m/s tombe sur l'octet 128 qui décode 0,235 m/s. Trouvé en TDD (T6), pas en revue. | Tolérance `toBeCloseTo(RADIUS, 6)` ; tests « vitesse > 0 »/« dt borné » réécrits avec `v = 12` (octet 153, exact) et la dérive attendue calculée plutôt que supposée ronde. Code de production inchangé — écart de test seulement. |
| 2026-09-13 | Un sous-agent d'implémentation haiku a substitué son propre nom dans le trailer `Co-Authored-By` d'un commit malgré une instruction explicite le fixant à un autre modèle. | Message de commit réécrit par le contrôleur avant tout push (local seulement, aucun commit poussé avec le mauvais trailer) ; les dispatchs suivants ajoutent un `grep -c` obligatoire sur le trailer attendu avant d'accepter un commit d'implémenteur. |
| 2026-09-13 | Aucun navigateur joignable pour la validation de la spec vent (T11b) : `mcp__claude-in-chrome__list_connected_browsers` vide, `brave-devtools` et `chrome-devtools` en `CONNECT_TIMEOUT` sur toute la session d'exécution. | T11 scindée (ruling, ledger) : T11a (câblage, tests, build, budget) livrée ; T11b (critères spec §13 n° 1–6 et 8, mesure du tick `high` en conditions réelles) reportée à une session où un Chrome est connecté — voir §9. |
| 2026-09-13 | Revue finale de branche (I1) : le tick `high` mesuré à 4,57 ms (T6) venait d'une grille de test 8×5 cache-chaude, non représentative ; avec un champ réel le tick coûtait 9–15 ms, dominé par 24 000 appels `sampleValue`/tick (closure allouée, `decode()`, `Math.hypot`, allocation `vec3ToLonLat`). | `sampleUV` fusionné sans allocation, tampon `WindField.uv` entrelacé (§5, `e4b4d6a`). Leçon : un temps de tick mesuré sur une fixture de test minuscule ne prédit rien du budget réel avec des données de production. |
| 2026-09-13 | Revue finale de branche (I2) : `applyWind` — au second échec avec le même `generated_at`, `available` retombait à faux → `stopWind()` coupait l'ancien champ encore animé, et « Vent indisponible » n'était effacé que sur un chargement réussi (jamais quand le vent était coupé ou qu'un nouveau `generated_at` arrivait). | `present`/`windFailedNow`/`usable` recalculés à chaque `applyWind`, ancien champ conservé et toujours animé, statut = `windOn && windFailedNow`, `refreshBanner()` unique en fin (`2e77ec7`, `0996837`) ; déviation assumée de la spec §11 : switch laissé actif dans ce cas. |
| 2026-09-13 | Revue finale (I3) : `webglcontextlost` référençait `stopWind` avant sa déclaration `const`, avec des `await` entre les deux — `ReferenceError` possible au tout premier déclenchement de l'événement au démarrage. | `let stopWind` déclaré avant le gestionnaire (`2e77ec7`). Leçon : une déclaration `const` capturée par une closure enregistrée plus tôt dans le fichier reste en zone morte tant que l'exécution linéaire ne l'a pas atteinte, même si la closure n'est appelée que bien plus tard. |
| 2026-09-13 | Revue finale (I4) : seuil d'horizon `1/d` (valable pour un point à rayon 1) appliqué aux traînées de vent au rayon 1,002 — une bande de surface d'environ 3,6° se dessinait au-delà du limbe visible. | Seuil exact `(1 + √((d²−1)(R²−1)))/(d·R)` (§5, `73b3687`). |
| 2026-09-13 | Validation navigateur (T11b) : un correctif mineur de la vague de correction (report du reste d'accumulateur entre deux ticks) comptait ce reste deux fois dans `dt` — la simulation tournait 10 à 30 % trop vite selon la gigue du rAF, invisible en test unitaire mais mesurable au ratio px/s. | `dt = acc − carry` au lieu de `acc` (`a68d44b`), test « Σ dt ≤ temps écoulé » ajouté. Leçon : un correctif de dernière minute sur une formule d'accumulateur mérite le même test de conservation qu'un bug initial. |
| 2026-09-13 | Outillage de validation navigateur (Brave via `mcp__brave-devtools__*`) : sans `select_page`/`bringToFront`, Brave bride `requestAnimationFrame` à 1–2 Hz alors que `document.visibilityState` reste « visible » ; `resize_page` plafonne à 500 px de large (dette n° 35 déjà connue) mais `emulate(1000×800, dpr 1)` fonctionne ; `VITE_DATA_BASE_URL=/dev-data/...` passé en variable d'environnement est réécrit en chemin Windows par Git Bash avant d'atteindre Vite, imposant une URL absolue. | Onglet ramené au premier plan avant toute mesure de cadence ; `emulate` préféré à `resize_page` pour un viewport mobile précis ; `VITE_DATA_BASE_URL` toujours passée en URL absolue complète, jamais en chemin relatif, sous Git Bash. Les ratios px/s mesurés 2–3 s après une navigation étaient en outre faussés par le plafond de `dt` pendant le décodage des tuiles — mesurer en régime établi. |
| 2026-09-18 | Mesure de fps du nouveau rendu du vent : 27–57 fps très instables sur le serveur **dev** Vite (deux onglets animés, machine chaude), alors que la prod tenait 60 | Mesurer sur `vite build` + `vite preview` dans le même état machine : 60 fps stables. Ne jamais conclure sur un fps mesuré en mode dev ; comparer en A/B entrelacé (visible/caché) plutôt qu'en séquence. |
| 2026-09-18 | `TaskStop` sur un `npx vite` lancé en arrière-plan tue le shell mais **pas** le processus node : les ports 5173/4173 restaient pris, le serveur suivant échouait (`--strictPort`, exit 1) pendant que l'ancien continuait de servir la page | Inoffensif pour la validation (Vite dev relit les sources sur disque — vérifié par `curl /src/layers/registry.ts`), mais à nettoyer : `netstat -ano \| grep :5173` puis `taskkill //PID <pid> //F`. |
| 2026-09-18 | Validation du lot C sur `vite preview --port 4173` : plus de frontières ni de détail satellite | Le CORS du bucket R2 n'autorise que `localhost:5173` et la prod : sur tout autre port (ou par l'IP du PC pour un téléphone) les tuiles sont refusées et le site se rabat sur Blue Marble 4K. Pas une régression : **valider sur le port 5173**. Pour servir à la fois `localhost` et l'IP LAN, builder avec `VITE_DATA_BASE_URL=/dev-data/layers` **depuis PowerShell** (Git Bash réécrit un chemin absolu) puis `vite preview --port 5173 --strictPort --host`. |
| 2026-09-18 | Revue finale du lot C (C1) : un `div` d'étiquette recyclé gardait la valeur de l'étiquette précédente — « France » affichant « 23,4 °C », une ville sèche affichant la pluie d'une autre | La validation navigateur ne l'avait pas vu : faite en température, où chaque ville réécrit sa valeur. Remise à zéro du `span` à la réutilisation + test sur faux DOM minimal (`labels-layer.test.ts`). **Toujours valider les étiquettes sur une couche à `tooltipMin` (pluie) avec des pays visibles.** |
| 2026-09-18 | Revue finale du lot C (I1) : `applyRivers` réentrant — un clic pendant le démarrage créait deux maillages, le premier impossible à masquer | La garde était testée avant l'`await` et la variable assignée après ; `once()` ne dédupliquait que le téléchargement. Création + `scene.add` + écouteur regroupés dans un `once`. Même famille que le TDZ du lot vent : **relire chaque `await` de `main.ts` comme un point de réentrance.** |
| 2026-09-18 | Plan du lot C : trois défauts de **mon plan** trouvés par les revues, pas par les tests du plan — `rAF` différé posant `.on` après un retrait de la même frame (étiquette orpheline), rattrapage périmé re-sélectionnant 4 ms après une sélection naturelle, test d'angle par `acos(dot)` en Float32 mal conditionné à 0,2° | Le code complet dans un plan n'est pas une preuve : les implémenteurs le transcrivent fidèlement, défauts compris. Les revues de tâche et la consigne « ne force pas un test au vert, signale » ont fait leur travail. Mesurer un petit angle par la corde `2·asin(|s−e|/2R)`, jamais par `acos`. |

## 7. Historique par plan (chronologie)

| Date | Plan / branche | Statut | Merge | Tests |
|---|---|---|---|---|
| 2026-08-30 | feat/pipeline-gfs — pipeline GFS → texture (spec + plan superpowers) | ✅ mergé | `aa29c6f` | 94 local / 95 Actions |
| 2026-09-02 | feat/globe-heatmap — spec 2 globe + heatmap (spec + plan superpowers) | ✅ mergé, déployé | `fcaf208` | 60 vitest + 94 pytest local (1 skipped) / 95 pytest Actions |
| 2026-09-05 | PR #1 — enregistrement de `tiles.yml` sur `master` (débloque `workflow_dispatch` pour `feat/tiles`, §6) | ✅ mergé | `d83e05e` | sans objet (workflow seul) |
| 2026-09-05 | feat/tiles — spec 3 tuiles : pyramide géodésique, filtre température, domaine `globelayers.com` (spec + plan superpowers, 20 tâches) | ✅ mergé et déployé | `dcca866` | 91 vitest + 127 pytest local (5 skipped) / attendu 132 pytest Actions |
| 2026-09-06 | feat/navigation — spec 4 lot A : zoom ancré sur l'altitude, pincement, tooltip, fondu (spec + plan superpowers, 10 tâches) | ✅ mergé, déployé par CI | `aa4ab6e` | 146 vitest + 127 pytest local (5 skipped) |
| 2026-09-12 | feat/layers — spec 4 lot B1 : 7 couches scalaires, pipeline à deux sources (GFS + GEFS-Aerosols), manifeste v2 (spec + plan superpowers, 16 tâches) | ✅ mergée, déployée | `cd667bd` | 173 passed / 9 skipped pytest local (Windows) ; 171 vitest (21 fichiers) |
| 2026-09-13 | spec 4 lot B2 vent animé — spec `2026-09-13-wind-design.md` (`38e5f27`, critère 8 révisé en `d31a2a8`) + plan `2026-09-13-wind.md` (`cda0f39`, 12 tâches), exécutée subagent-driven sur `feat/wind` | ✅ mergée, déployée | `c120f81` | 236 passed vitest (26 fichiers) ; 184 passed / 9 skipped pytest local (Windows), 195 Actions |
| 2026-09-18 | feat/wind-clouds-polish — vent en quads instanciés (moins de particules, plus épaisses et plus longues) + nuages adoucis ; chemin borné (design en chat, pas de spec ni de plan) | ✅ mergée, déployée par CI | `0cc0d52` | 248 passed vitest (27 fichiers) ; pytest inchangé (aucun fichier Python touché) |
| 2026-09-18 | feat/rain-soften — `soften` 0,8 sur la pluie (une ligne de registre + test) | ✅ mergée, déployée par CI | `39ca638` | 248 passed vitest (27 fichiers) |
| 2026-09-18 | fix/rain-soften-04 — `soften` pluie 0,8 → 0,4 (verdict utilisateur) | ✅ mergée, déployée par CI | `1c66add` | 248 passed vitest (27 fichiers) |
| 2026-09-18 | fix/rain-no-soften — flou retiré de la pluie (verdict utilisateur final) | ✅ mergée, déployée par CI | `5c9b060` | 248 passed vitest (27 fichiers) |
| 2026-09-19 | feat/labels-rivers — lot C : étiquettes villes/pays avec valeur de couche, fleuves (spec `2026-09-18-labels-rivers-design.md` `fae97ec`, plan `2026-09-18-labels-rivers.md` `d545af6`, 12 tâches, subagent-driven le 2026-09-18 ; validée sur vrai téléphone par l'utilisateur le 2026-09-19) | ✅ mergée, déployée par CI | `c4ed59e` | 326 passed vitest (37 fichiers) ; 204 passed / 10 skipped pytest local (Windows) ; bundle 160,65 Ko gzip |
| 2026-09-19 | refactor/geo-wiring — dettes n° 42 (câblage geo extrait de `main.ts`, testable en Node) et n° 41 (étiquettes hors cadre ou sous un panneau, variante sombre, reliquats du lot C) ; chemin borné (design en chat, TDD, pas de spec ni de plan) | ✅ mergée, déployée par CI | `116991f` | 348 passed vitest (38 fichiers) ; 206 passed / 10 skipped pytest local (Windows) ; bundle 161,62 Ko gzip |

## 8. Dette technique connue

| # | Dette | Impact | Statut |
|---|---|---|---|
| 1 | ~~Cible d'hébergement non tranchée~~ | — | ✅ résolu 2026-08-29 : GitHub Actions + Cloudflare R2/Pages (§5) ; R2 mis en service le 2026-09-02 (dette n° 7) |
| 2 | **`cfgrib` exige `eccodes`, sans roue Windows** (`eccodeslib` : Linux/macOS seulement) | `decode_grib` (`pipeline/grib_adapter.py`) ne tourne pas sur le PC de dev, skip local (`skipUnless`) | 🟡 contenu par l'approche A (§5) : `decode_grib` testé **réellement** sur Actions contre la fixture commitée `tests/fixtures/gfs_tmp2m.grib2` (test vert, pas un mock) — seul le poste Windows reste aveugle |
| 3 | ~~Encodage température dupliqué en trois endroits~~ (Python, GLSL, JS) sans garde mécanique | — | ✅ résolu par construction le 2026-08-30 (pipeline) et **honorée côté front le 2026-09-02** : `web/src/data/metadata.ts` lit `encoding`/`grid` depuis les métadonnées publiées, aucune constante recopiée |
| 4 | ~~Aucune source de heightmap fixée~~ | — | ✅ résolu 2026-09-05 : **GEBCO 2026** retenu (spec 3), relief encodé en hillshade GDAL (canal R des tuiles `map`), pas de displacement map séparée |
| 5 | ~~Pas de CI~~ : les tests ne tournaient qu'à la main | — | ✅ résolu 2026-08-30 : `.github/workflows/test.yml` exécute pytest + `history_check` + un dry-run NOMADS réel sur chaque push/PR |
| 6 | **GitHub désactive les workflows planifiés (`schedule`) après 60 jours sans commit** sur le dépôt | `pipeline.yml` s'arrêterait silencieusement si le dépôt reste inactif deux mois | 🔴 ouvert ; se réveille via un `workflow_dispatch` manuel ou un simple commit — à surveiller si le projet marque une pause |
| 7 | ~~R2 non activé~~ | — | ✅ résolu 2026-09-02 : bucket `worldtemp`, `r2.dev`, CORS, token, 4 secrets GitHub posés ; **`pipeline.yml` réactivé** (`gh workflow enable`), premier run réel publié (§9) |
| 8 | **`actions/checkout@v4`, `actions/setup-python@v5`, `actions/upload-artifact@v4`** tournent sur Node 20, déprécié côté GitHub Actions | Migration future vers les majeures suivantes à prévoir (pas encore annoncée comme bloquante) | 🟡 à surveiller |
| 9 | **Critère 6 de la spec (secret R2 invalide → run rouge exit 4, `latest.*` intact) non testé de bout en bout** : le Secret Access Key n'a pas été conservé côté utilisateur, le casser aurait imposé de recréer le token | Le chemin est couvert par les tests unitaires de `publish.py` (exit 4) mais pas vérifié contre R2 réel | 🟡 ouvert — à faire à la prochaine rotation du token : poser une valeur fausse, `gh workflow run`, vérifier, remettre la vraie |
| 10 | **Le job `deploy` de `test.yml` reconstruit le frontend** (`npm ci` + `npm run build`) au lieu de réutiliser l'artefact `web-dist` déjà produit par le job `web` | Double build à chaque déploiement ; quelques dizaines de secondes de CI perdues, pas de risque fonctionnel | 🟡 mineur, ouvert |
| 11 | **Aucun test unitaire sur `web/src/ui/overlay.ts`** : ni le repli/dépli de l'overlay, ni l'affichage du statut d'échec de rafraîchissement (`refresh()` qui échoue) ne sont couverts par Vitest, seulement validés à l'œil | Une régression sur ces deux comportements ne casserait aucun test | 🟡 ouvert |
| 12 | ~~`ImageBitmap` de la heatmap remplacée non fermé~~ | — | ✅ résolu 2026-09-02 (revue finale) : `close()` après `dispose()` de la texture précédente, test `loader` dédié |
| 14 | **Reliquats mineurs de la revue finale de branche (2026-09-02)**, non corrigés : `uGridSize` semé à (1440, 721) dans `globe.ts` ; `resize()` ne réapplique pas `setPixelRatio` (changement d'écran) et n'a pas de garde `h = 0` ; boucle rAF et `setInterval` continuent après `webglcontextlost` ; échec de chargement de la Blue Marble → écran fatal au lieu du globe seul (cas absent de la table §7 de la spec) ; `#ad-slot` masqué sans hauteur réservée (spec §5 ambiguë, phase 6 tranchera) ; légende `min-width: 16rem` (224 px) au lieu de 256 px ; repères `stats` en texte aux extrémités, pas positionnés sur la barre ; regex de tier `Arc|Xe` trop courte (spec §4) ; asymétrie `num()`/`str()` dans `metadata.ts` ; pas de `concurrency` sur le job `deploy` ; `_headers` sans `nosniff`/`Referrer-Policy` | Polish, aucun impact sur les critères d'acceptation ; à prendre au fil des specs 3 et 4 | 🟡 ouvert |
| 13 | **`navigator.hardwareConcurrency === 0` traité comme « aucun signal »** dans `web/src/gpu/tier.ts`, alors que la spec écrit littéralement « ≤ 4 → tier low » | Cas surtout théorique (peu de navigateurs renvoient 0 plutôt que `undefined`) ; un appareil qui renverrait 0 recevrait le tier `high` au lieu de `low` par ce seul critère | 🟡 théorique, ouvert |
| 15 | **Volume réel des tuiles `map` ≈ 4,5 Go**, contre l'estimation initiale de la spec (< 1,5 Go) : PNG RGB peu compressible | Sous les 10 Go du plan R2 gratuit pour l'instant, mais la marge fond plus vite que prévu si un futur jeu de données s'ajoute | 🟡 ouvert — compression à revoir en v2 (palette indexée, quantification) |
| 16 | **Hillshade calculé avec un `-s` (échelle degrés→mètres) constant**, alors que la distance réelle d'un degré de longitude diminue vers les pôles | Le relief est légèrement sous-estimé aux hautes latitudes (l'axe est-ouest y est compressé par rapport à l'axe nord-sud, non compensé) | 🟡 mineur, ouvert |
| 17 | **Coutures possibles aux bords des 8 boîtes GEBCO** : chaque boîte est traitée indépendamment, sans marge de recouvrement au découpage | Non observé à l'œil lors de la validation T17 (les jonctions testées tombaient à l'intérieur d'une boîte), mais pas garanti à toutes les frontières de boîte | 🟡 ouvert — marge de recouvrement (`margin`) à ajouter en v2 si une couture est repérée |
| 18 | **Les lacs restent classés « terre »** dans le masque terre/mer (canal G), faute de source dédiée — le masque vient des polygones de côtes OSM, qui ne découpent pas les lacs | Un lac apparaît hillshadé/coloré comme la terre environnante au lieu d'être traité comme de l'eau | 🟡 mineur, ouvert, documenté dans la spec §2 |
| 19 | **Une tuile en échec de chargement n'est réessayée que si la caméra bouge** (aucune tentative périodique en arrière-plan) | Un blocage réseau transitoire peut laisser une tuile manquante affichée en repli sur l'ancêtre jusqu'au prochain mouvement de caméra | 🟡 mineur, ouvert |
| 20 | **`r2.dev` et `worldtemp.geoviz.workers.dev` encore actifs** en plus du domaine personnalisé `globelayers.com` | Deux points d'accès non officiels au même contenu restent joignables après le lancement du domaine définitif | ✅ résolu 2026-09-05 (après merge) : `r2.dev` désactivé par API (401), origine `workers.dev` retirée du CORS, `workers_dev: false` déployé |
| 21 | **Critère 6 de la spec 3 (tier `low` fluide, < 100 Mio) validé uniquement en simulation desktop** (`?tier=low` sur Chrome DevTools), pas sur un téléphone réel | `?tier=low` force le profil de rendu mais ne reproduit ni le GPU mobile, ni la mémoire, ni le `devicePixelRatio` d'un appareil réel | ✅ résolu 2026-09-05 (soir) : validé par l'utilisateur sur son téléphone — fluide la plupart du temps, léger lag occasionnel |
| 22 | **Mineurs différés de l'exécution de la spec 3** (liste non exhaustive, détail dans le ledger d'exécution git-ignoré) : `patchSphere` recalculé à chaque patch à chaque frame plutôt que mis en cache par `tileKey` ; `pump()` (chargeur de tuiles) retrie toute la file à chaque appel ; une promesse rejetée dans `loader.start()` (`onLoad` qui lève) n'est pas gérée ; `resize()` de la scène sans garde sur une largeur nulle ; `tiler/grid.py::tile_range` suppose une boîte déjà alignée sur la grille (arrondit silencieusement sinon) ; `HAS_GDAL` ne vérifie la présence que de `gdalwarp`/`ogr2ogr`, pas de `gdaldem`/`gdal_rasterize` | Polish et robustesse marginale, aucun impact sur les critères d'acceptation de la spec 3 | 🟡 ouvert |
| 23 | ~~Zoom à deux doigts trop sensible sur téléphone~~ (cause : OrbitControls multiplie `d`, pas l'altitude) | — | ✅ résolu 2026-09-06 côté code (dolly sur l'altitude, spec 4 lot A, §5) ; **confirmé sur téléphone réel le 2026-09-12** par l'utilisateur (critères 3 et 5 de la spec ✅) |
| 24 | **Le tooltip et le marqueur ignorent les `safe-area-inset-*`** : `placeTooltip` borne au canvas seul (`#overlay`, lui, respecte les insets) | Sur un téléphone à encoche, un tooltip près du bord haut ou d'un bord en paysage peut passer sous l'encoche | 🟡 ouvert — marges par côté alimentées par `env(safe-area-inset-*)` |
| 25 | **Reflows forcés sur les chemins chauds** : `getBoundingClientRect()` à chaque frame d'ancre (`zoom.ts`) et par doigt par mouvement (`main.ts`), `offsetWidth/Height` du tooltip à chaque survol | Jusqu'à ~4 reflows par événement d'entrée ; aucun jank mesuré (0 draw call au repos), assurance à prendre en cachant le rect du canvas pendant un geste | 🟡 mineur, ouvert |
| 26 | **Pincement trackpad macOS non compensé** : il arrive en `wheel` avec `ctrlKey` et de petits deltas (OrbitControls multiplie par 10 dans ce cas, `normalizeWheel` non) | Zoom trackpad ~10× moins sensible que voulu ; le défilement à deux doigts (geste usuel) n'est pas touché | 🟡 ouvert, hors périmètre spec 4 lot A |
| 27 | **Colorimétrie de la lecture CPU vérifiée sur Chrome seul** : le bitmap `colorSpaceConversion: "none"` traverse un canvas 2D `srgb` ; ±0,02 °C mesuré sur Chrome | Un décodage géré en couleur (Firefox/Safari) décalerait toutes les valeurs du tooltip | 🟡 ouvert — contrôle d'une valeur sur Firefox et Safari après déploiement |
| 28 | **Mineurs différés de l'exécution de la spec 4 lot A** (détail dans le ledger git-ignoré) : `ZoomControl.dispose()` sans appelant (pas de teardown de scène) ; moitié événementielle de `attachZoom`, `createTooltip` et câblage `main.ts` sans test (règle Vitest logique pure) ; test « limbe 80° » qui démarre derrière l'horizon ; `TapDetector` : `up` d'un id inconnu décrémente le compteur sans resynchroniser ; convergence molette testée sur `aNew` (facteur 4/3) ; `projectToScreen` sans test `ndc.z ≥ −1` | Polish, aucun impact sur les critères d'acceptation | 🟡 ouvert |
| 29 | ~~`tiles.yml` invalide depuis `f18a90c` (2026-09-05)~~ : ligne 149, `run: echo "… : index.bin, …"` en scalaire YAML nu contenant `: ` → « Invalid workflow file », run rouge de 0 s à chaque push et **tout `workflow_dispatch` futur aurait échoué** (le dernier run manuel réussi, 33976497547, précède ce commit) | Régénération des tuiles impossible tant que non corrigé ; découvert par le faux rouge après le merge de la spec 4 | ✅ résolu 2026-09-06 (`b64a0da` puis correctif réel) : scalaire bloc `run: \|` ; en prime `fromJSON(inputs.boxes \|\| '[0,1,2,3,4,5,6,7]')` |
| 30 | **`cfgrib`/`xarray` toujours listés dans `pipeline/requirements-grib.txt`** alors que le décodage GRIB (`grib_adapter.py`) appelle désormais `eccodes` directement par clés (spec couches, 2026-09-12) ; `grep -rn "cfgrib\|xarray" pipeline tests` ne trouve plus que ce fichier | Dépendance installée pour rien sur Actions (`eccodeslib` suffit) | 🟡 ouvert — élaguer `requirements-grib.txt` une fois confirmé qu'aucun outillage annexe ne s'appuie encore sur `xarray`/`cfgrib` |
| 31 | ~~`gfs/latest.png`/`gfs/latest.json` (schema 1) republiés en parallèle de `layers/latest.json` (v2)~~, pour les clients déjà chargés sur l'ancien contrat | Deux formats de sortie à maintenir, deux fois plus d'objets R2 pour `temp` | ✅ résolu 2026-09-13 (commit `596b247`, T1 spec vent) : code retiré (`config.py`, `metadata.py`, `main.py`) ; **objets R2 `gfs/latest.*` à supprimer à la main après déploiement** |
| 32 | **Encodage 8 bits `pm25`/`dust` sature au-delà de 500/2 000 µg/m³** alors que la plage plausible brute a été élargie à 20 000/50 000 (T7, §5) — seule la validation d'ordre de grandeur a bougé, pas l'`Encoding` d'affichage | Un panache de pollution exceptionnel (> 500 µg/m³ pm25 ou > 2 000 µg/m³ dust, déjà observé une fois à 2 684/13 377 sur un run réel) s'affiche à la couleur du maximum de la légende au lieu d'une couleur distincte | 🟡 ouvert — revoir `Encoding.max` de `pipeline/layers.py` si ces dépassements se répètent |
| 33 | **`except Exception` large dans `pipeline/main.py::_process_source`** (mandaté par le plan) | Une exception inattendue et non liée aux échecs source/décodage/validation prévus serait avalée comme un simple échec de source secondaire | 🟡 mineur, ouvert |
| 34 | **`grib_adapter.py::_message_keys` avale les exceptions eccodes** (mandaté par le plan) | Une clé GRIB manquante ou un message corrompu se traduit en clé absente plutôt qu'en erreur explicite, potentiellement masquant un problème de fichier NOMADS | 🟡 mineur, ouvert |
| 35 | **Disposition mobile validée à 500 px, pas 400 px** : le pont `mcp__brave-devtools__*` impose une largeur de fenêtre minimale de 500 px (`resize_page(400, …)` retombe à 500) | Le point de rupture CSS (`@media (max-width: 600px)`, `web/src/style.css:158`) rend le comportement à 400 px identique en théorie (pas de rupture intermédiaire), mais non mesuré directement | 🟡 ouvert — à re-tester avec un outillage sans plancher de largeur si disponible |
| 36 | **Mineurs différés de l'exécution de la spec couches** (liste courte, détail dans le ledger git-ignoré) : `config.RUN_AVAILABILITY_DELAY`/`MAX_CANDIDATES`/`MAX_FORECAST_HOUR` dupliquent `sources.GFS` ; `pressure` sans `stepType` dans `grib_keys` ; `validate_range` non défensive sur NaN (couverte par `validate_grid` en amont) ; `upload_r2` avec liste vide non testé ; casts `as Rgba` (`colormap.ts`) et `as string` (éviction `LayerCache`) ; `lutFor` ré-indexe l'encodage à chaque appel ; `render()` de `layers-menu.ts` sans aucun bouton activé ; `setLegendVisible(false)` ajouté hors brief ; `setActive(id inconnu)` laisse tout le groupe à `tabIndex -1` ; `cursor: not-allowed` redondant sur un bouton déjà `disabled` | Polish et robustesse marginale, aucun impact sur les critères d'acceptation de la spec couches | 🟡 ouvert |
| 37 | ~~**Statut « Couche indisponible » (spec §13) invisible quand le repli réussit** : `activate()` pose `layerNotice` puis appelle le repli, dont le chemin nominal remet `layerNotice` à `null` avant tout `refreshBanner()` ; le message n'apparaît que si aucun repli valide n'existe~~ | L'utilisateur voit le bouton se griser et la vue revenir en arrière sans explication ; trouvé par la revue finale (I3), resté ouvert après la vague de correction unique | ✅ résolu 2026-09-12 (avant merge) : `layerNotice` posé après le retour du repli, avant le dernier `refreshBanner()` |
| 38 | **Mineurs différés de l'exécution de la spec vent** (détail dans le ledger git-ignoré `.superpowers/sdd/2026-09-13-wind/progress.md`) : nom de test `test_happy_path_publishes_seven_layers_and_manifest_last` inexact (9 couches, T2) ; `compassPoint(deg)` sans garde sur `deg` négatif (index négatif, inatteignable via `formatWind`, T4) ; `isVisible` avec une garde `p.length() \|\| 1` superflue (`p` toujours à 1,002, T5) ; le garde du constructeur de `WindSim` n'est pas testé (T6) ; `render/wind.ts` sans test sur la garde de taille du tampon, `matrixAutoUpdate = false` sans commentaire (T7) ; `wind/loader.ts` avec un helper `close()` dupliqué, sans test « U et V échouent » ni « un seul `generated_at` change » (T8) ; `controller.ts` avec un clamp `dt` redondant avec `sim.step` (idempotent, T9) ; `wind-toggle.ts` avec un `render()` initial redondant avec le HTML, `setDisabled` qui efface `title`, et **`setDisabled(true)` qui grise le bouton sans ramener `aria-checked` à cohérence** — un switch désactivé après un `?wind=1` reste annoncé `aria-checked="true"` aux technologies d'assistance (trouvé en validation navigateur T11b) ; `main.ts` avec trois `!` empilés sur `entryU`/`entryV`/`manifest` (T11a) | Polish et robustesse marginale, aucun impact sur les critères d'acceptation de la spec vent ; ~~le second échec au même `generated_at` qui grisait le switch sans statut affiché (T11a)~~ et ~~la closure `at` de `sampleValue` dans le chemin du tick vent (T6)~~ sont résolus par la revue finale et la vague de correction (§5, `2e77ec7`/`0996837`/`e4b4d6a`) ; ~~`setDisabled(true)` sans `aria-checked` cohérent et `setDisabled` qui efface `title`~~ résolus par `ui/toggle.ts` (lot C, `06ec312`) | 🟡 ouvert |
| 39 | **Boucle `SceneHandle.onFrame`/`loop()` de `render/scene.ts` sans couverture Vitest** : parké en T9 (ruling, ledger) car `createScene` instancie un `WebGLRenderer`, non instanciable en Node — convention du projet « Vitest logique pure, rendu à l'œil » | Une régression sur l'inscription/désinscription des abonnés `onFrame`, ou sur le déclenchement du rendu continu, ne serait détectée que par la validation navigateur (critère 4 de la spec vent : 0 draw call vent inactif), pas par un test automatisé | 🟡 ouvert |
| 40 | **Critère 8 initial de la spec vent (tick ≤ 4 ms) non atteignable sur la machine de référence** avec un champ réel à `N = 12 000` (tick seul mesuré 10,9–13,2 ms, §6) ; critère révisé le 2026-09-13 vers un budget de frame (§5) | Si un tick ≤ 4 ms redevenait nécessaire (davantage de particules, machine plus modeste), l'échantillonnage bilinéaire CPU par particule resterait le poste dominant même après `sampleUV` fusionné | 🟡 ouvert — pistes non retenues faute de nécessité actuelle : champ `Float32` pré-décodé (évite le décodage linéaire par lecture), simulation déportée en Web Worker |
| 41 | **Reliquats du lot C** (revue finale 2026-09-18, détail dans le ledger git-ignoré `.superpowers/sdd/2026-09-18-labels-rivers/progress.md`) : étiquettes coupées au bord droit de l'écran ou passant sous le bandeau de statut (`projectToScreen` sans marge) ; variante sombre indexée sur `source === null` (couche aux pixels illisibles → texte sombre sur couche colorée) ; 36 lignes de rang 8 jamais affichables dans `countries.json` ; `fit_budget` sans plafond d'itérations ; double projection dans `LabelsController.refresh()` ; `deps.size()` lu 2–3 fois par vue ; rattrapage non annulé à l'extinction (inoffensif) ; écouteur `onViewChange` des fleuves actif même éteint ; commentaire du `catch` externe de `scene.ts` périmé depuis l'isolation des écouteurs de vue ; `labels/data.ts` n'écarte pas un `cap` hors {0,1} ; octet réservé de `rivers.bin` non vérifié | Cosmétique ou robustesse marginale ; aucun critère d'acceptation touché | ✅ résolu 2026-09-19 (`3c59f4d`, `681525b`) : cadre + obstacles dans `selectLabels`, `layerShown`, `MAX_COUNTRY_RANK`, `fit_budget` borné, une projection et une lecture de taille par vue, écouteur des fleuves inactif éteint, parseurs durcis, commentaire corrigé. **Laissé tel quel, assumé** : rattrapage non annulé à l'extinction (le callback revérifie `enabled`/`set`, aucun effet) |
| 42 | **`main.ts` atteint 495 lignes** : le bloc des repères géographiques (chargement, deux interrupteurs, contrôleur, fleuves) y est autonome ; la revue finale recommande de l'extraire en `geo/wiring.ts` (`setupGeo({ ui, scene, canvas, tier })`), dans la lignée de la recommandation du lot B1 (machine à états de `main.ts`) | Chaque nouveau lot ajoute des points de réentrance dans un fichier sans test (I1 du lot C, TDZ du lot vent) | ✅ résolu 2026-09-19 (`7f9f2f7`) pour le bloc geo : `geo/wiring.ts`, 11 tests, `main.ts` 411 lignes. La machine à états des couches et du vent (recommandation B1) reste dans `main.ts` : non extraite |

## 9. État actuel & prochaine action

### 2026-09-19 (2) — Dettes n° 42 puis n° 41 traitées, validées dans le navigateur, mergées (`116991f`) et déployées

Chemin borné (design en chat, TDD, pas de spec ni de plan), à la demande de l'utilisateur.

- **n° 42** (`7f9f2f7`) : `geo/wiring.ts` — `wireGeo` (dépendances injectées) + `setupGeo`
  (assemblage réel) ; `main.ts` 495 → 411 lignes, comportement inchangé ; 11 tests, vérifiés par
  mutation (retrait du `once` de I1 → 1 rouge ; `setEnabled(true)` forcé → 4 rouges).
- **n° 41** (`3c59f4d`, `681525b`) : cadre + obstacles (`ui.panelRects()`) dans `selectLabels`,
  `relayout()` au repli/dépli, `layerShown` pour la variante sombre, une projection et une lecture
  de taille par vue, écouteur des fleuves inactif éteint, parseurs durcis (`cap` hors {0, 1},
  octet réservé), commentaire de `scene.ts`, `MAX_COUNTRY_RANK` (countries.json 242 → 206 lignes,
  `places.json` et `rivers.bin` identiques à l'octet), `fit_budget` borné. Décisions en §5.
  Le test rouge de `fit_budget` a d'abord bouclé sans fin (le défaut lui-même) : lancer pytest
  sous `timeout` quand on teste une boucle non bornée.
- **Validation navigateur** (Brave, `vite build` + `vite preview`, après libération de mémoire par
  l'utilisateur : 2,0 Go libres) : 1000 × 800, 60 étiquettes, aucune sous bandeau / légende /
  contrôles / attribution ni hors écran (mesuré sur les rectangles DOM réels) ; 500 × 800 mobile :
  28 étiquettes panneaux déployés, 33 repliés (jusqu'à y = 751), retour à 28 au dépli **sans
  mouvement de caméra** (`relayout`) ; d = 1,1 : température → blanc, « Aucune » → sombre, pluie →
  blanc (valeurs absentes = pas de pluie, `tooltipMin`) ; fleuves off/on : `aria-checked` et
  `?rivers=` cohérents. Onglet 3D fermé et serveur arrêté ensuite.
- **Tests :** 348 vitest (38 fichiers), `tsc` propre ; 206 passed / 10 skipped pytest local.
- **Build :** `index-*.js` 161,62 Ko gzip (+0,97 Ko).
- **Prochaine action :** aucun chantier en cours. Dettes ouvertes restantes en §8 (n° 30, 33–35,
  38–40 notamment) ; machine à états des couches et du vent toujours dans `main.ts`.


### 2026-09-19 — Lot C validé sur vrai téléphone, mergé (`c4ed59e`) et déployé

- **Validation téléphone** (critère 9) : build `vite build` + `vite preview --host` servi sur le
  réseau local, QR code généré en local (`npx qrcode`). Verdict utilisateur : « tout est bon sur
  le téléphone, ça lag très légèrement mais c'est pratiquement imperceptible » — étiquettes,
  fleuves, plafond étroit × 2/3 (§5) validés ; pas d'action sur le léger lag.
- **Incident sans suite** : le serveur de prévisualisation a été coupé par Claude Code pour manque
  de mémoire (1,1 Go libre sur 7,9) pendant l'attente ; l'utilisateur avait déjà testé. Port
  libre, pas de node orphelin cette fois.
- **T12** : merge local `--no-ff` `c4ed59e` dans `master`, tests et build relancés sur le résultat,
  push (spec `fae97ec` et plan `d545af6` partent avec), prod vérifiée (bundle `index-DZpEjsvi.js` identique au build local ; `/geo/places.json`,
  `/geo/countries.json`, `/geo/rivers.bin` en 200), branche supprimée en local (jamais poussée).
  Espace de travail `.superpowers/sdd/2026-09-18-labels-rivers/` **conservé** (648 Ko, git-ignoré)
  comme ceux des lots précédents : il porte le rapport de validation cité plus bas.
- **Tests :** 326 vitest (37 fichiers), `tsc` propre ; 204 passed / 10 skipped pytest local.
- **Build :** `index-*.js` 160,65 Ko gzip.
- **Prochaine action :** aucun lot en cours. Pistes : dettes §8 (n° 38–42), brainstorming du
  prochain lot à la demande de l'utilisateur.

### 2026-09-18 (2) — Lot C (étiquettes villes/pays avec valeur, fleuves) : implémenté et revu sur feat/labels-rivers, NON MERGÉ — en attente de la validation sur téléphone

Brainstorming (chemin architectural) → spec `docs/superpowers/specs/2026-09-18-labels-rivers-design.md`
(`fae97ec`) → plan 12 tâches (`d545af6`) → exécution **subagent-driven** sur `feat/labels-rivers`
(base `d545af6`, HEAD de code `77d1e8f`). Décisions en §5, défauts en §6, dettes n° 41–42 en §8.

- **T1–T10** (implémenteur + relecteur par tâche) : `tools/build_geo.py` et ses données
  (`web/public/geo/`), `ui/toggle.ts` (remplace `wind-toggle.ts`, dette n° 38 partiellement
  résolue), `geo/`, `labels/`, `rivers/`, `render/rivers.ts` + fragment GLSL partagé avec le vent
  (`renderOrder` du vent 1 → 2), câblage `main.ts`. Tours de correction : T6 ×1 (étiquette
  orpheline), T7 ×1 (cadence du rattrapage), T8 ×1 (helper de test mal conditionné).
- **T11, validation navigateur** (Brave, UHD 620, `vite build` + `vite preview`) : critères 1–8 ✓,
  critère 9 ✓ en émulation mobile `low`. Sept constats corrigés (F1–F7) : micro-États, re-sélection
  au redimensionnement, marge de limbe, plafond étroit × 2/3, variante sombre, **budget des
  fleuves 50 000** (accord utilisateur), petites capitales sans priorité de tri. Mesures :
  sélection 0,28–1,28 ms ; 60 fps au repos tout allumé ; vent + 45 663 segments 56 fps contre 55
  sans. Rapport : `.superpowers/sdd/2026-09-18-labels-rivers/validation-report.md` (git-ignoré).
- **Revue finale** (fable) : « With fixes » — C1 (valeur d'une autre étiquette sur un div recyclé)
  et I1 (double maillage des fleuves), plus cinq mineurs ; vague unique `5709d33..77d1e8f`,
  re-revue (opus) 7/7, re-validation navigateur de C1 (couche pluie, pays visibles) et I1 (clics
  au démarrage) ✓. Tous les rulings du contrôleur jugés fondés.
- **État du dépôt à l'arrêt** : branche `feat/labels-rivers` **non poussée, non mergée** ;
  `master` local en avance de 2 commits sur `origin` (spec et plan, non poussés) ; serveurs
  locaux arrêtés, ports 5173/4173 libres. Session interrompue par l'utilisateur (« je vérifierai
  pendant une autre session »).

- **Tests :** 326 vitest (37 fichiers), `tsc` propre ; 19 pytest `tests/test_build_geo.py` (suite
  pytest complète non relancée après T2 : aucun autre fichier Python touché).
- **Build :** `index-*.js` 160,65 Ko gzip (+4,57 Ko, budget +8).
- **Prochaine action :** (1) servir le build pour le téléphone — depuis **PowerShell** :
  `$env:VITE_DATA_BASE_URL='/dev-data/layers'; npx vite build` dans `web/`, puis
  `npx vite preview --port 5173 --strictPort --host` → `http://<ip-du-PC>:5173/?tier=low&layer=temp&lon=2&lat=46.5&d=1.35`
  (sans frontières ni détail satellite sur le téléphone : CORS R2, §6) ; (2) verdict utilisateur
  (lisibilité, fluidité, plafond de 20 étiquettes, couche pluie, rotation d'écran, variante
  sombre) ; (3) **T12** : merge `--no-ff` dans master (`git merge -m`, pas `-F -`), HISTORY final
  (§7 : sha de merge), push, vérifier la prod (`/geo/places.json` en 200, hash du bundle),
  mémoire ; (4) supprimer l'espace de travail `.superpowers/sdd/2026-09-18-labels-rivers/`.

### 2026-09-18 — Vent plus lisible (quads 2 px, 5 000 particules, stride 3) et nuages adoucis

Deux retours utilisateur sur la prod, traités en chemin **borné** du brainstorming
(design en chat, validé, TDD, pas de spec) sur `feat/wind-clouds-polish`, mergée
`--no-ff` en `0cc0d52`.

- **Vent** (`d6289a9`) : `render/wind.ts` passe de `LineSegments` (1 px, ANGLE ignore
  `lineWidth`) à des quads instanciés de 2 px CSS avec liseré et anti-crénelage ;
  profils 5 000/K9 et 1 500/K5 avec `stride` 3, P = 3 px/s par m/s (§5). Crochet dev
  `__worldtempWind.layer` ajouté. Mesuré (Brave, UHD 620, 1440×830) : tick médian
  6,4 ms en dev, 60 fps sur le build.
- **Nuages** (`2518e42`) : `LayerDef.soften` = 1,2 → `LayerLoader` floute le canal R
  (`data/blur.ts`) et livre une `DataTexture` `RedFormat` ; tooltip sur pixels bruts
  (vérifié : Espagne 0 %, Allemagne 100 %, orientation nord/sud cohérente).
- Validation à l'œil sur la France (vue des captures utilisateur), données
  `web/public/dev-data/`. Profil `low` non validé à l'œil (même code, N/K réduits).

- **Tests :** 248 vitest (27 fichiers) ; pytest non relancé (aucun fichier Python touché).
- **Build :** `index-*.js` 156,08 Ko gzip (+1,39 Ko).
- **Suite le même jour** : l'utilisateur demande le flou sur la pluie aussi →
  `soften` 0,8 (`017ea4a`, merge `39ca638`), contrôlé à l'œil en local (averses
  Benelux/Allemagne en taches douces), bundle 156,09 Ko gzip (+0,01).
- **Verdict utilisateur sur la pluie** : 0,8 trop flou (cyclone au sud du Japon,
  §5) → **0,4**, merge `1c66add`, bundle 156,09 Ko gzip.
- **Verdict final sur la pluie** : à 0,4 aucune différence visible → flou
  **retiré** (merge `5c9b060`), `soften` ne concerne plus que les nuages ;
  bundle 156,08 Ko gzip, identique au premier déploiement du jour.
- **Verdict utilisateur sur la prod** : vent « beaucoup plus visible, c'est bien »,
  nuages « bien » — profils vent et `soften` 1,2 **validés**, ne pas rouvrir.
- **Prochaine action :** brainstorming du **lot C** (étiquettes villes/pays).

### 2026-09-13 — Spec 4 lot B2 (vent animé) exécutée et validée sur feat/wind : 9 couches, particules CPU, legacy retiré, critère 8 révisé

Plan `docs/superpowers/plans/2026-09-13-wind.md` (12 tâches) exécuté en
**subagent-driven development** sur `feat/wind` : une revue par tâche, rounds de
correction T1 ×1 (renommage de test), T6 ×2 (tolérances de test Float32 et
vitesse non représentable en 8 bits, §6), T8 ×1 (test de rechargement raté sur
la même instance + garde dispose en vol), T11a ×1 (`refreshBanner()` dès que
`windNotice` est effacé).

Livré : côté pipeline, couches `wind_u`/`wind_v` (`pipeline/layers.py`, UGRD/VGRD
10 m, `Encoding(-60, 60, "linear")`) portant le registre à 9 couches ; retrait
complet du legacy `gfs/latest.*` (`config.py`, `metadata.py`, `main.py`, dette
n° 31 §8 résolue) ; fixture réelle `tests/fixtures/gfs_wind.grib2` (1,9 Mo,
NOMADS réel), décodage réel vert sur Actions (run 34756146343 : 195 pytest,
dry-run 10 objets / 9 couches). Côté front : `web/src/wind/` (`sim.ts` —
`WindSim`, tampon slot-major glissant par `copyWithin` — `select.ts`,
`loader.ts`, `controller.ts`), `render/wind.ts` + `shaders/wind.{vert,frag}.glsl`
(`WindLayer`, un seul `LineSegments`), `render/scene.ts::onFrame`,
`ui/wind-toggle.ts`, `ui/tooltip.ts::setWind`, `ui/format.ts` (`formatWind`,
`windDirection`, `compassPoint`), `ui/overlay.ts` (`layersMenu`/`windToggle`),
`index.html` (`#layers-menu`, `#wind-toggle`), `style.css`, câblage `main.ts`
(`applyWind`/`stopWind`, statut « Vent indisponible », crochet dev
`__worldtempWind`), `.gitignore` (`web/public/dev-data/`) ; tests
`web/tests/wind-{select,sim,layer,loader,controller}.test.ts` et
`fixtures.ts::WIND_ENTRIES`.

Décisions (spec §1–2, ne pas rouvrir, détaillées §5) : surimpression combinable
(switch + `?wind=1|0`) plutôt qu'une 8ᵉ couche ; 10 m seulement ; **approche A**
simulation CPU + un seul `LineSegments` plutôt que des particules GPU
ping-pong (traînées à effacer à chaque rotation, extensions flottantes,
rien de testable hors navigateur) ; deux entrées scalaires plutôt qu'un PNG RGB ;
vitesse apparente constante (2 px/s par m/s) ; spawn uniforme en NDC via
`pickSphere` ; actif par défaut en tier `high` seulement, inactif sous
`prefers-reduced-motion` ; `SceneHandle.onFrame` garde le 0 draw call au repos
quand le vent est inactif.

**Revue finale de branche** (`209a38b..0003b29`) : « With fixes », quatre
constats Important — I1 tick `high` réellement 9–15 ms avec un champ réel (le
4,57 ms de T6 venait d'une grille de test 8×5 cache-chaude, non représentative ;
24 000 appels `sampleValue`/tick avec closure, `decode()`, `Math.hypot`,
allocation `vec3ToLonLat`) ; I2 `applyWind` coupait l'ancien champ et
n'effaçait jamais « Vent indisponible » hors succès, au second échec avec le
même `generated_at` (spec §11) ; I3 `webglcontextlost` référençait `stopWind`
avant sa déclaration `const` (`await` entre les deux) → `ReferenceError`
possible au démarrage ; I4 seuil d'horizon `1/d` appliqué à des traînées au
rayon 1,002 → bande de surface de 3,6° rendue hors du limbe. Rapport
`.superpowers/sdd/2026-09-13-wind/final-review-report.md`.

**Vague de correction unique** (adressant I1–I4 et trois mineurs bon marché) :
`WindField` devient `{ uv: Uint8Array entrelacé, grid, encU, encV }` (8 Mo →
2 Mo) et `sampleUV` fusionné sans allocation (accord à 1e-9 avec `sampleValue`)
remplacent le sampling séparé U/V dans le tick ; `applyWind` recalcule
`present`/`windFailedNow`/`usable` après l'attente réseau, conserve l'ancien
champ, et pose « Vent indisponible » dès que `windOn && windFailedNow` — switch
laissé **actif** dans ce cas (déviation assumée de la spec §11 : un switch
grisé empêcherait de couper l'animation en cours) ; `let stopWind` déclaré
avant le gestionnaire ; seuil d'horizon exact
`(1+√((d²−1)(R²−1)))/(dR)` ; boucle `onFrame` isolée par callback
(`try/catch`) ; accumulateur du contrôleur avec report du reste ; glyphes
`::before` du switch avec texte alternatif vide (a11y). Re-revue ciblée : tout
adressé. Un bug résiduel trouvé **en validation navigateur** (pas en revue) :
le reste d'accumulateur était compté deux fois dans `dt` (simulation 10–30 %
trop rapide selon la gigue) → `dt = acc − carry` (`a68d44b`), test « Σ dt ≤
temps écoulé ». Rapport
`.superpowers/sdd/2026-09-13-wind/final-fix-report.md`. Commits : `e4b4d6a`,
`2e77ec7`, `73b3687`, `9458c3d`, `0996837`, `a68d44b`.

Tests/build finaux : `npm --prefix web run test` → **236 passed** (26 fichiers) ;
pytest inchangé (184 local / 9 skipped, 195 Actions) ; typecheck OK ; build
`index-*.js` 154,69 Ko gzip (+3,99 Ko vs 150,70 Ko, budget ≤ +12 Ko respecté).

**Validation navigateur T11b** (Brave via `mcp__brave-devtools__*`, reconnecté
par l'utilisateur en cours de session ; Intel UHD 620, 4 cœurs ; viewport
émulé 1000×800 ; données = artefact CI dry-run servi par Vite dev et par
`vite preview` sur build de prod) — rapport
`.superpowers/sdd/2026-09-13-wind/validation-report.md`, tous critères ✅ :
1 (blanc sur satellite, sombre sur carte, limbe net) ; 2 (ratio px/s mesuré /
(2·|v|) en régime établi 0,935–1,012 selon l'altitude) ; 3 (trois tooltips =
recalcul Python bilinéaire exact) ; 4 (0 draw call/3 s vent coupé, 30 ticks/s
actif, rAF 60) ; 5 (`?tier=low` sans requête vent, activation sans rechargement,
`?wind=0&tier=high` respecté) ; 6 (manifeste sans `wind_*` → switch grisé, 7
couches intactes) ; 7 (par tests + dry-run CI) ; 8 : la formulation initiale
« tick ≤ 4 ms » s'est avérée **non atteignable** sur cette machine (tick seul
10,9–13,2 ms en dev comme en prod ; micro-bench de lectures 1 ms — moteur JS
hors de cause — contre 6,2 ms pour le seul échantillonnage côté relecteur)
alors que la fluidité perçue est tenue → **critère 8 révisé par l'utilisateur
le 2026-09-13** : « 30 ticks/s tenus et tick + rendu ≤ 50 % du budget de frame,
≤ 16 ms, sur la machine de référence » (spec `d31a2a8`) — mesuré **11,7 ms
moy / 19,4 p90** en `high` prod, 4,6 ms en `low` → ✅. Console propre. Pièges
d'outillage documentés en §6 (Brave rAF bridé sans premier plan, plancher de
`resize_page`, conversion de chemin Git Bash, plafond `dt` biaisant une mesure
trop proche d'une navigation).

**Prochaine action :** `superpowers:finishing-a-development-branch` — merge
`--no-ff` de `feat/wind` dans `master`, push, déploiement CI,
`gh workflow run pipeline.yml`, suppression manuelle de `gfs/latest.*` sur R2
(API Cloudflare), HISTORY.md final ; puis lot C (étiquettes).

### 2026-09-13 — Spec 4 lot B2 (vent animé) : brainstorming, spec et plan écrits, exécution à suivre

Brainstorming (`superpowers:brainstorming`, chemin architectural) puis spec
`docs/superpowers/specs/2026-09-13-wind-design.md` (`38e5f27`) et plan
`docs/superpowers/plans/2026-09-13-wind.md` (`cda0f39`, 12 tâches) via `writing-plans`.
**Aucun code applicatif touché.** Décisions (spec §1, ne pas rouvrir) : vent en
**surimpression combinable** (switch « Vent » indépendant du radio, `?wind=1|0`) plutôt
qu'en 8e couche ; **10 m seulement** ; animé partout, densité par tier, actif par défaut en
`high`, inactif en `low` et sous `prefers-reduced-motion` ; tooltip « Vent 23 km/h NO »
(direction d'où vient le vent, rose à 16 points) ; **approche A** = simulation **CPU** pure
(`web/src/wind/sim.ts`, N/K = 12 000/12 `high`, 3 000/8 `low`, 30 Hz, vitesse apparente
constante 2 px/s par m/s, spawn uniforme en NDC via `pickSphere`) + un seul `LineSegments`
(tampon slot-major `[K][N][xyz]` décalé par `copyWithin`, upload complet par tick, alpha
statique par slot) plutôt que particules GPU ping-pong à traînées écran (effacement à chaque
rotation, extensions flottantes mobiles, rien de testable hors navigateur) ; contrat : deux
entrées scalaires `wind_u`/`wind_v` (UGRD/VGRD 10 m, `Encoding(-60, 60, "linear")`) dans le
manifeste v2 **inchangé**, plutôt qu'un PNG RGB ; `SceneHandle.onFrame(cb)` pour le rendu
continu seulement quand le vent est actif (0 draw call au repos conservé).

- **Plan** : T1 retrait de `gfs/latest.*` (dette n° 31) ; T2 registre à 9 specs ; T3 fixture
  réelle `tests/fixtures/gfs_wind.grib2` (~1 Mo, à télécharger à la main) + décodage réel sur
  Actions ; T4 `wind/select.ts` + `formatWind` ; T5–T6 simulation ; T7 `render/wind.ts` +
  shaders ; T8 `WindLoader` (pixels CPU, jamais de texture GPU) ; T9 `onFrame` + contrôleur
  30 Hz ; T10 switch, `#layers-menu`, tooltip à deux lignes ; T11 câblage `main.ts` +
  validation navigateur (données du dry-run CI servies via `VITE_DATA_BASE_URL`) ; T12 HISTORY.
- **Budgets** : bundle ≤ 150,70 + 12 Ko gzip ; tick `high` ≤ 4 ms ; 8 critères d'acceptation (spec §13).
- **Tests / build :** inchangés (aucun code) ; `history_check` ✓.
- **Fait le soir même :** option 1 de `finishing-a-development-branch` (merge local) choisie par
  l'utilisateur ; suites vertes sur l'arbre à intégrer (185 pytest local / 10 skipped, 236 vitest,
  typecheck, build 154,69 Ko) ; merge `c120f81` (`--no-ff`, parents `209a38b` et `c80624f`),
  suites vertes sur le résultat, `feat/wind` supprimée en local et sur `origin` ; push `master`
  (`fe825eb..c120f81`) → CI run 34768511900 `test`/`web`/`deploy` verts ; `pipeline.yml`
  déclenché (run 34768517485) : « publié … wind_u 2026-09-13T12:00:00Z f004, wind_v … » (8 objets,
  9 couches, chem réutilisé) ; objets legacy `gfs/latest.json`/`gfs/latest.png` supprimés de R2 par
  l'API REST (`DELETE …/r2/buckets/worldtemp/objects/{key}`, `wrangler` local non authentifié) ;
  contrôle prod : `layers/latest.json` schema 2 à **9 entrées** (`wind_u` stats −19,2/21,4 m/s),
  `wind_u.png`/`wind_v.png` en 200 (≈ 284 Ko chacun), `gfs/latest.json` en **404**, site en 200
  avec le bundle mergé (`index-BZcaPaCk.js`). Dette n° 31 définitivement close.
- **Session arrêtée le 2026-09-13 au soir.** Arbre propre sur `master` (`4b73888`), branche `feat/wind`
  supprimée, 9 couches en production.
- **Verdict utilisateur en prod (2026-09-13 au soir) :** vent validé visuellement ; **réduire le nombre de
  particules** (N `high` 12 000, `low` 3 000) une prochaine fois pour économiser CPU et alléger la couche —
  cohérent avec la dette n° 40 (coût du tick).
- **Prochaine action :** brainstorming du **lot C** (étiquettes villes/pays, Natural Earth) ;
  surveiller le premier cron horaire du pipeline avec 9 couches ; dettes n° 38–40 (§8) au fil de l'eau.

### 2026-09-12 — Spec 4 lot B1 (couches) exécutée sur `feat/layers` : 7 couches scalaires, pipeline à deux sources, manifeste v2

Reprise du backlog après la confirmation téléphone de la spec 4 lot A (§8, dette
n° 23) : brainstorming (`superpowers:brainstorming`), lot B (couches multiples)
retenu devant le lot C (étiquettes). Spec
`docs/superpowers/specs/2026-09-12-layers-design.md`, plan
`docs/superpowers/plans/2026-09-12-layers.md` (16 tâches), exécutés en
**subagent-driven development** sur `feat/layers` (base `b6db64b`) : une revue par
tâche, **3 rounds de correction** (T7 bornes plausibles pm25/dust, T11 signature
`formatBanner`, T15 chemin d'échec d'`activate()`) ; l'implémenteur de T15 a été
coupé par la limite de session après 3 commits poussés, repris par un implémenteur
frais ; la validation navigateur de T15 a d'abord échoué faute d'outillage
(`claude-in-chrome` et `chrome-devtools-mcp` tous deux injoignables), puis a été
reprise avec succès via `mcp__brave-devtools__*` (9/9 points ✅, rapport
`.superpowers/sdd/2026-09-12-layers/validation-report.md`).

Livré : `pipeline/layers.py` + `sources.py` (registre des 7 couches et des 2
sources NOMADS), décodage GRIB par clés eccodes directes (`grib_adapter.py`,
fixtures réelles `gfs_layers.grib2`/`gefs_chem.grib2`), orchestration à deux
sources avec report tolérant de la source secondaire (`main.py`), manifeste
`layers/latest.json` v2 + legacy `gfs/latest.*` v1 (`metadata.py`, `publish.py`) ;
côté front, registre `web/src/layers/` (`registry.ts`, `select.ts`, `cache.ts`),
`data/manifest.ts` + `data/encoding.ts` (remplacent `metadata.ts`), menu radio
`ui/layers-menu.ts`, shader à composition alpha + isolignes (`patch.frag.glsl`),
câblage complet dans `main.ts` (`ManifestLoader`, `LayerCache` LRU 2,
`activate`/`applyData`) — §2, §3, §5.

- **Tests :** `.venv/Scripts/python -m pytest -q` → **173 passed, 9 skipped**
  local Windows (5 eccodes + 4 GDAL, attendu) ; `npm --prefix web run test` →
  **168 passed** (21 fichiers) ; typecheck et build OK.
- **Build :** `dist/assets/index-*.js` gzip **150,70 Ko** (+2,49 Ko par rapport à
  la spec 4 lot A, 148,21 Ko), sous le budget de +15 Ko de la spec couches.
- **Critères d'acceptation (spec §15)** : 1 (7 couches, tooltip ±1 pas de
  quantification) ✅ mesuré en local (dry-run + brave-devtools : température écart
  nul, pluie 0,03 mm/h sous le pas de quantification) ; 2 (transparence pluie/
  PM2.5/poussière/nuages) ✅ ; 3 (isobares 4 hPa lisses) ✅ (mécanisme validé sur
  une zone à fort gradient, la coordonnée Normandie de la brief tombait sur un
  champ localement plat à ce run précis — pas un défaut) ; 4 (`?layer=` sans
  rechargement) ✅ ; **5** (GEFS-chem cassé → 5 PNG GFS + report/omission
  pm25/dust) ✅ **dry-run CI 7 couches + report chem testé** (`test_main.py`,
  runs CI 34709677549/34710076060) ; **6** (Vitest/pytest verts, `history_check`,
  bundle ≤ +15 Ko) ✅ **bundle + CI** ; 7 (0 draw call au repos) ✅ mesuré (0 appel
  GPU sur 3 s, repos et survol) — changement de couche déjà chargée non
  chronométré séparément ; **8** (`gfs/latest.*` schema 1 toujours publié et
  valide) ✅ **vérifié par les tests et le dry-run** (`build_legacy`, ordre
  d'upload testés).
- **Revue finale de branche** (modèle le plus capable, `b6db64b..51c5d4a`) : « With fixes » —
  I1 éviction LRU pouvant disposer la texture *affichée* pendant un chargement (+ loader évincé en
  vol qui fuit), I2 « Données indisponibles » effacé en ≤ 60 s sans manifeste (fenêtre
  déploiement → premier run), I3 « Couche indisponible » jamais visible ; mineurs promus M1
  (`failed` jamais vidé), M2 (isoligne sur octet entier → plateau assombri), M3 (traceback du
  report chem). Vague de correction unique (`c0e87d9`, `c83de07`) : cache épinglé sur la couche
  affichée, loader disposé en vol, bandeau sans manifeste, `failed` retentable par `generated_at`,
  isoligne décalée d'un quart d'octet + `fwidth` borné, `exc_info=True` ; 3 tests ajoutés
  (**171 vitest**). Re-revue ciblée : I1, I2, M1–M3 réglés ; **I3 reste ouvert** (dette n° 37).
- **État :** branche `feat/layers` poussée, HEAD `c83de07`, CI `test`/`web` vertes ; merge à
  suivre. En prod, `layers/latest.json` sera publié au premier run du pipeline après le merge
  (`gh workflow run pipeline.yml` en `workflow_dispatch`, comme pour la mise en service R2 du
  2026-09-02).
- **Fait le soir même :** dette n° 37 corrigée avant merge (`1c5aad1`), trailers des 27 commits
  réécrits puis branche republiée, merge `cd667bd` (`--no-ff`), 173 pytest + 171 vitest sur le
  résultat, push `master`, CI `test`/`web`/`deploy` vertes (run 34721020579), `pipeline.yml`
  déclenché à la main (run 34721035725) : `layers/latest.json` en 200 avec **7 couches** (run 12z
  f009 ; pm25 max 2 246,7 et dust max 11 432,8 µg/m³, pression max 1 070,7 hPa au-delà de
  l'encodage 1 060 → saturé), 7 PNG en 200, legacy `gfs/latest.json` en 200, site
  « GlobeLayers — météo mondiale en 3D » en 200 avec le bundle pointant sur
  `data.globelayers.com/layers`.
- **Dettes :** n° 30 à 36 ouvertes (§8) — élagage `cfgrib`/`xarray`, retrait
  `gfs/latest.*`, saturation d'encodage pm25/dust, `except Exception` large,
  `_message_keys` avale les exceptions eccodes, validation 400 px non mesurée
  (plancher outil 500 px), mineurs différés. Dette n° 37 fermée avant merge.
- **Session arrêtée le 2026-09-12 au soir.** Branche `feat/layers` supprimée en local et sur
  `origin` après merge ; espace de travail du plan supprimé ; arbre propre sur `master`.
- **Prochaine action :** brainstorming
  du **lot B2** (vent animé, champ vectoriel U/V, particules).

### 2026-09-06 — Spec 4 lot A (navigation) exécutée sur `feat/navigation` : zoom ancré, pincement, tooltip, fondu

Reprise du backlog : brainstorming (`superpowers:brainstorming`) découpant la
spec 4 en trois lots (A navigation, B couches multiples, C étiquettes) ; lot A
retenu. Cause structurelle de la dette n° 23 identifiée avant la spec (OrbitControls
multiplie `d`, pas l'altitude), convergence de l'ancre mesurée numériquement avant
d'écrire le plan (2 itérations insuffisantes au limbe → 4, puis 6 après validation).
Spec `docs/superpowers/specs/2026-09-06-navigation-design.md`, plan
`docs/superpowers/plans/2026-09-06-navigation.md` (10 tâches), exécutés en
**subagent-driven development** sur `feat/navigation` (base `c038e68`) : une revue par
tâche, **4 rounds de correction** (T3 ×2, T4 ×1, T9/C1 ×1) + une vague finale.

Livré : `render/pick.ts` (picking analytique), `controls/zoom.ts` (dolly sur
l'altitude, ancre, pincement, `keepAnchor`), `data/pixels.ts` + `sampleTemperature`,
`ui/tooltip.ts` (survol souris, tap tactile, marqueur, `aria-live` par mode), fondu
`[1,20 ; 1,14]` — §3, §5, §6.

- **Validation navigateur** (Chrome DevTools MCP, viewport 1000×800, rapport
  `.superpowers/sdd/2026-09-06-navigation/validation-report.md`) : critère 1 d'abord
  **en échec** (dérive 5 à 198 px au cadrage final selon la cadence des crans),
  corrigé (`3ee3c2a`) et re-mesuré à **0,0002 px** (60 et 30 ms) / **0,299 px**
  (500 ms) ; critère 2 : **35 crans** exactement, rapports d'agrandissement
  1,4385 / 1,4433 / 1,4429 ; critère 4 : tooltip à **±0,02 °C** du recalcul sur
  `latest.png` ; critère 5 (synthétique) : tap pose / retire / déplace, glisser ne pose
  rien ; critère 6 : satellite pur à 1,20, carte pure à 1,14, aucun réglage ;
  critère 8 : **0 draw call** au repos et après un survol ; bornes `d` 4,0000 / 1,0420 ;
  console propre.
- **Revue finale de branche** : « With fixes » (spec désynchronisée sur six points,
  garde d'ancre non testée) ; vague unique (`2454f3e`, `4b72ec1`) : spec resynchronisée,
  `keepAnchor` extrait et testé, `clearRect` avant dessin, `aria-live` par mode, garde de
  taille du tampon, commentaire de capture corrigé. Mineurs restants → dettes n° 24–28.
- **Tests :** `npm --prefix web run test` → **146 passed** (17 fichiers, dont 4 nouveaux) ;
  `.venv/Scripts/python -m pytest -q` → **127 passed, 5 skipped** (inchangé) ; typecheck
  et build OK.
- **Build :** `dist/assets/index-*.js` **572,65 Ko** (gzip **148,21 Ko**), +8 Ko bruts
  par rapport à la spec 3.
- **Critères 3 et 5 (téléphone réel) : à valider par l'utilisateur après déploiement**
  (pincement dosable près du sol, lieu sous les doigts stable ; tap pose/retire le
  marqueur). Dette n° 23 fermée côté code, confirmation téléphone attendue.
- **Fait le soir même :** merge `aa4ab6e` (`--no-ff`), 146 vitest verts sur le résultat, push `master`.
- **CI :** run 34054142043 vert (`test`, `web`, `deploy`), site en 200. En passant : `tiles.yml`
  était **invalide** depuis `f18a90c` (scalaire YAML nu avec « : », ligne 149) — run rouge de 0 s à
  chaque push et toute régénération manuelle aurait échoué ; corrigé (`95f3160`, dette n° 29 §8).
- **Session arrêtée le 2026-09-06 au soir.**
- **Verdict téléphone consigné le 2026-09-12 :** critères 3 (pincement dosable, lieu stable sous
  les doigts) et 5 (tap pose / retire le marqueur) **✅ validés sur téléphone réel** par
  l'utilisateur. Dette n° 23 définitivement fermée. Prochaine action : brainstorming du **lot B**
  (couches multiples) — retenu par l'utilisateur devant le lot C (étiquettes).

### 2026-09-05 — Spec 3 (tuiles) exécutée sur `feat/tiles` : pyramide, filtre température, domaine `globelayers.com`

Brainstorming (`superpowers:brainstorming`) incluant un **audit du concurrent Ventusky**
(spec §11) pour trancher le biais de perception satellite/température, puis spec
(`docs/superpowers/specs/2026-09-05-tiles-design.md`) et plan
(`docs/superpowers/plans/2026-09-05-tiles.md`, 20 tâches) écrits via
`writing-plans`, exécutés en **subagent-driven development** sur la branche
`feat/tiles` (base `fcc0a83`) : une revue par tâche, environ **6 tours de
correction** au total (T5, T11, T13, T14-16 chacun 1 tour ; T8 débloquée par une
PR séparée ; une vague de correctifs finale après la revue de branche complète).
Dette n° 4 §8 tranchée (GEBCO retenu).

Livré : `tiler/` (pyramide géodésique 512 px, index binaire WTIX, découpe de
blocs, frontières, adaptateur GDAL, pyramide satellite, CLI/orchestration —
§2, §3, §5) ; front `web/src/tiles/` (miroir TS de la pyramide, manifeste,
index, sélection LOD, chargeur avec budget mémoire, géométrie de patches) et
`web/src/render/globe.ts` réécrit en quadtree de patches (un seul
`ShaderMaterial` partagé, bicubique Catmull-Rom, hillshade, composition
satellite/carte, bouton « Température ») ; `.github/workflows/tiles.yml`
(génération manuelle, 9 jobs) ; domaine `globelayers.com` (Cloudflare
Registrar) avec `data.globelayers.com` en façade du bucket R2.

- **Génération v1** (run
  [33976497547](https://github.com/Haddepe/worldtemp/actions/runs/33976497547),
  3 h 01) : **72 893 tuiles** (70 161 `map` niveaux 1-8 + 2 `map` niveau 0
  assemblées + 2 730 `sat`), **≈ 4,5 Go** de PNG `map` + **≈ 60 Mo** de JPEG
  `sat`. Détail des durées et volumes par boîte GEBCO :
  `.superpowers/sdd/2026-09-05-tiles/task-8-report.md`.
- **Validation visuelle et perf** (Chrome DevTools MCP, `task-17-report.md`) :
  critères 2 (zoom Normandie net, 59,8 fps), 3 (Sahara ≈ Europe, ΔL ±2 % typ.),
  4 (aucun losange bilinéaire) et 8 (premier chargement **1,70 Mo** < 2 Mo)
  **✅ validés** ; critère 6 (tier `low`, pic mémoire **254,7 Mio**) **✅ simulé
  desktop**, non testé sur téléphone réel.
- **Domaine** (`task-18-19-report.md`) : `data.globelayers.com` actif
  (custom domain R2 + CORS), `globelayers.com` en route `custom_domain` du
  Worker, `www.globelayers.com` redirigé 301, Cache Rule « cache tout, TTL
  origine » posée sur `data.globelayers.com`. Manifeste en ligne :
  `https://data.globelayers.com/tiles/v1/manifest.json`.
- **Revue finale de branche** : « Approve with fixes » (4 points Important —
  îlots sous-résolution dans `ocean_only`, run partiel qui aurait écrasé
  `index.bin`, fetch manifeste/index sans timeout, token de déploiement à
  vérifier pour la route `custom_domain`) ; vague de correctifs unique
  (`f18a90c`, `fba5d3d`, `528db70`) — détail complet dans
  `.superpowers/sdd/2026-09-05-tiles/final-fix-report.md`.
- **Tests :** `.venv/Scripts/python -m pytest -q` → **127 passed, 5 skipped**
  local (4 tests GDAL + 1 test grib/eccodes, absents sous Windows) ; sur
  Actions, les tests GDAL tournent réellement (**132 passed** attendu, GDAL
  installé par `test.yml`). `npm --prefix web run test` → **91 passed**
  (13 fichiers, dont 7 nouveaux `tiles-*.test.ts`).
- **Build :** `vite build` OK, `dist/assets/index-*.js` 564,68 Ko (gzip
  145,14 Ko).
- **CI sur la branche :** run
  [33991905265](https://github.com/Haddepe/worldtemp/actions/runs/33991905265)
  — job `web` vert ; job `test` **rouge uniquement sur `history_check.py`**
  (attendu et documenté : §3 ne nommait pas encore `tiler`/`tiles`, purgé par
  cette mise à jour) ; job `deploy` sauté (dépend de `test`).
- **Fait le soir même (après cette entrée) :** merge `dcca866` (conflit `tiles.yml`
  résolu côté branche), run CI 33992492978 vert (`test`, `web`, `deploy`) — la route
  `custom_domain` s'est attachée sans droit supplémentaire sur le token ; site sur
  https://globelayers.com (`www` → 301), `r2.dev` désactivé par API (401), origine
  `workers.dev` retirée du CORS, `workers_dev: false` (dette n° 20 résolue).
- **Critère 6 ✅** (utilisateur, téléphone, 2026-09-05 au soir) : fluide la plupart du temps,
  léger lag occasionnel ; le zoom à deux doigts est jugé trop sensible (dette n° 23 §8).
- **Prochaine action :** brainstorming de la **spec 4** (filtres multiples vent/nuages/humidité…,
  étiquettes villes/pays, tooltip via `sampling.ts`, zoom vers le curseur).

### 2026-09-02 (3) — Merge, premier déploiement : le site est en ligne

Revue finale de branche (modèle le plus capable) : « With fixes », trois
défauts Important corrigés en une vague (§6 : `#status` étiré, statut d'échec
effacé ; plus `ImageBitmap.close()`, dette n° 12), deux attributs
d'accessibilité (`aria-label` du bouton de repli, `aria-live` retiré du
bandeau), et la spec §4 corrigée (LUT `SRGBColorSpace`,
`#include <colorspace_fragment>`) pour coller au code. Re-revue scoped propre,
CI de branche verte.

- Merge `fcaf208` (`--no-ff`) dans `master`, branche supprimée. Run
  [33671690511](https://github.com/Haddepe/worldtemp/actions/runs/33671690511)
  : `test`, `web`, **`deploy`** verts — premier déploiement Workers Static
  Assets, **`https://worldtemp.geoviz.workers.dev`**.
- Sous-domaine `workers.dev` du compte renommé de `depernet-hadrien` en
  **`geoviz`** (choix utilisateur, sans nom civil ; par l'API : DELETE puis PUT
  `/workers/subdomain`, l'ancienne URL ne répond plus).
- CORS du bucket R2 : règle `site` ajoutée pour cette origine (par l'API MCP
  Cloudflare, en plus de `localhost:5173`) ; vérifié
  `access-control-allow-origin` renvoyé sur `latest.json`.
- **Critère 6 ✅** : `/` → `max-age=0, must-revalidate` ; `/assets/index-*.js`
  → `immutable` ; `/textures/blue-marble-4k.jpg` → `max-age=86400` ; poids
  brut du premier chargement ≈ 1,8 Mo (JS 551 Ko non compressé + texture
  1 044 Ko + PNG 218 Ko), sous les 3 Mo.
- **Critère 4 ✅** (utilisateur, téléphone, 2026-09-02 au soir) : `?tier=low`
  et `?tier=high` fonctionnent tous deux ; différence invisible tant que le
  relief n'existe pas (maillage 65 k vs 590 k triangles, pixel ratio 1,5 vs 2).
  **Critère 5 : à faire** (changement de texture sans rechargement dans les
  15 min suivant un run du cron, minute 12).
- **Tests :** `npm --prefix web run test` → **60 passed** ; pytest
  **94 passed, 1 skipped** ; `history_check` ✓.
- **Build :** `vite build` OK, déployé.
- **Prochaine action :** critères 4 et 5 (utilisateur), puis
  `superpowers:brainstorming` pour la **spec 3 (relief : heightmap, displacement,
  normal map, hillshading)**, qui tranche la dette n° 4 §8.

### 2026-09-02 (2) — Globe + heatmap livrés sur la branche `feat/globe-heatmap`

Spec (`docs/superpowers/specs/2026-09-02-globe-heatmap-design.md`) et plan
(`docs/superpowers/plans/2026-09-02-globe-heatmap.md`) exécutés en
**subagent-driven development** (10 tâches, une revue par tâche ; 4 tours de
correction au total, sur les tâches 6, 7 et 8 — défauts détaillés en §6).
Livré : scaffold Vite/TS/Vitest (`web/`), contrat `latest.json` et
échantillonnage lat/lon → UV, texture Blue Marble + script de préparation,
scène Three.js et globe `ShaderMaterial` (tiers `high`/`low`), colormap LUT
256×1 + légende, détection de tier GPU par faisceau d'indices,
`DataLoader` (fetch, cache-busting, rafraîchissement 15 min + `visibilitychange`),
overlay (bandeau, statut, légende, slider, repli mobile) et dégradation sans
donnée, CI (jobs `web` et `deploy`, Workers Static Assets — §2, §5).

- **Tests :** `npm --prefix web run test` → **59 passed** (Vitest, logique pure
  uniquement : `metadata`, `sampling`, `colormap`, `tier`, `loader`, `format` —
  le rendu WebGL est validé à l'œil et via Chrome DevTools MCP par les
  sous-agents d'implémentation, §5). `.venv/Scripts/python -m pytest -q` →
  **85 passed, 1 skipped** annoncé au plan, **94 passed, 1 skipped** constaté
  à l'exécution de cette mise à jour (inchangé par cette branche, qui ne
  touche pas `pipeline/`/`tests/` — l'écart vient d'un compte de référence
  daté au moment du plan, pas d'une régression).
- **Build :** `vite build` OK — `dist/assets/index-*.js` 551 Ko (≈ 140 Ko
  gzip), `index.html` + CSS négligeables ; texture Blue Marble 1020 Ko servie
  à part (`web/public/textures/`, hors cache `immutable`). Premier
  chargement transféré ≈ 1,4 Mo en tout (JS/CSS gzip + texture).
- **CI sur la branche :** job `web` vert ; job `deploy` sauté (ne tourne que
  sur push `master`) ; job `test` rouge uniquement sur `history_check` avant
  cette mise à jour du document.
- **Prochaine action :** revue finale de branche, merge dans `master`
  (`superpowers:finishing-a-development-branch`), premier déploiement (le
  secret GitHub `CLOUDFLARE_API_TOKEN` doit être posé par l'utilisateur), CORS
  du bucket R2 pour l'origine `workers.dev`, puis critères 4 à 6 de la spec
  (mobile, cron horaire visible sans rechargement, site en ligne). Ensuite,
  brainstorming de la **spec 3 (relief)**, dette n° 4 §8.

### 2026-09-02 — R2 en service, premier run réel publié (Task 12)

Aucun code touché. Plugin Claude Code `cloudflare@cloudflare` installé (serveurs
MCP `cloudflare-api`, `-bindings`, `-builds`, `-observability`, `-docs`, OAuth
côté utilisateur), puis Task 12 du plan déroulée (§5 pour le partage
agent/utilisateur) :

- R2 activé au dashboard (utilisateur) ; bucket `worldtemp` (WEUR), `r2.dev`
  activé, CORS `http://localhost:5173` GET/HEAD posés par API (agent).
- Token R2 *Account* `worldtemp-github-actions` créé au dashboard ; 4 secrets
  GitHub posés ; `pipeline.yml` **réactivé**.
- Run [33653151011](https://github.com/Haddepe/worldtemp/actions/runs/33653151011)
  vert en 23 s : « latest.json non lu sur R2 (NoSuchKey) », « téléchargé : run
  2026-09-02T12:00:00Z f004, 515559 octets », « écrit : 218062 octets PNG »,
  « publié ». **Critère 4 ✅** : `latest.json` public cohérent
  (`valid_time_utc` 16:00Z pour un contrôle à 16:10Z, `encoding`/`grid` conformes
  au contrat, stats −69,5/46,2 °C), PNG `image/png`, `cache-control: public,
  max-age=300`.
- Run [33653251174](https://github.com/Haddepe/worldtemp/actions/runs/33653251174)
  dans la même heure : « déjà publié », 19 s, exit 0. **Critère 5 ✅**.
- **Critère 6 sauté** (dette n° 9 §8).
- **Tests :** inchangés (94 local / 95 Actions, aucun code modifié).
- **Build :** sans objet (toujours aucun frontend).
- **Prochaine action :** `superpowers:brainstorming` pour la **spec 2 (globe
  Three.js)**, qui consomme `https://pub-97483d42990244b3b19ae530da791d26.r2.dev/gfs/latest.json`
  (`schema_version`, `encoding`, `grid`, `RepeatWrapping`, formules d'échantillonnage
  spec pipeline §4). Surveiller les premiers runs horaires du cron (minute 12).

### 2026-08-30 — Pipeline GFS implémenté et mergé (`feat/pipeline-gfs` → `master`)

Spec (`docs/superpowers/specs/2026-08-30-pipeline-gfs-design.md`) et plan
(`docs/superpowers/plans/2026-08-30-pipeline-gfs.md`) écrits via
`brainstorming`/`writing-plans`, puis exécutés en **subagent-driven development**
(12 tâches, une revue par tâche — les deux défauts trouvés sont en §6). Arbre
livré détaillé en §3, décisions en §5.

- **Tests locaux :** `python -m pytest` → **85 passed, 1 skipped** (le skip est
  `decode_grib`, dette n° 2 §8).
- **Sur Actions :** **86 passed** (le test réel de `decode_grib` contre la
  fixture GRIB tourne, rien n'y est skippé). Run CI
  [33319227172](https://github.com/Haddepe/worldtemp/actions/runs/33319227172) —
  vert sauf `history_check` (§3 sans le dossier `fixtures`, pied de page en
  retard), corrigé par cette mise à jour de `HISTORY.md` ; run 33319658191
  entièrement vert.
- Revue finale de branche : 403 NOMADS traité comme transitoire, contrat lon
  précisé (`lon_max` 179,75, pas de colonne de bouclage).
- Dry-run réel contre NOMADS (`python -m pipeline.main --dry-run`) : `latest.png`
  produit visuellement correct — continents reconnaissables, centré sur la
  longitude 0.
- **Build :** sans objet (toujours aucun frontend).
- **Prochaine action :** ⚠️ **réactiver le cron** (`gh workflow enable pipeline.yml`,
  désactivé le 2026-08-30 pour ne pas tourner à vide) une fois les secrets posés ;
  **Task 12** du plan (mise en place R2 : bucket, token,
  4 secrets GitHub, CORS — manuel, dette n° 7 §8), puis reprendre le
  brainstorming pour la spec 2 (globe).

### 2026-08-29 (2) — Dépôt GitHub créé, brainstorming de la spec pipeline en cours

- Dépôt distant créé : **https://github.com/Haddepe/worldtemp** (privé), `origin`
  configuré, `master` poussé.
- L'exécution directe de `docs/PLAN.md` a été **interrompue à la demande de
  l'utilisateur** (plan issu d'une session web, pas du workflow superpowers).
  Reprise par `superpowers:brainstorming`, chemin **architectural** (§5).
- Décisions prises (détail et pourquoi en §5) : deux specs (pipeline puis globe) ;
  GitHub Actions → Cloudflare R2 + Pages ; rétention `latest` seulement ; dev local
  en venv Windows ; **approche A validée** (adaptateur GRIB isolé).
- Découverte : OpenDAP NOMADS retiré (§6). Dette n° 1 résolue, n° 2 contenue (§8).
- Un `.venv/` local existe (gitignoré) avec `xarray`, `cfgrib`, `numpy`, `Pillow`,
  `requests` — `eccodes` n'y charge pas, attendu.
- Mémoire persistante Claude (`worldtemp-brainstorm-decisions`) tient les mêmes
  décisions pour reprise après redémarrage du PC.

**Aucun code applicatif écrit.** Arbre §3 inchangé.

- **Tests :** 30/30 verts (contrôle du document uniquement).
- **Build :** sans objet.
- **Prochaine action :** reprendre le brainstorming à l'étape **« design par
  sections »** de la spec pipeline (architecture, sélection du run/échéance,
  contrat de données PNG + `metadata.json`, workflow Actions + R2, gestion
  d'erreurs, tests). Choix secondaires à confirmer au passage : 8 bits (tooltip en
  °C entiers, `metadata.json` porte `encoding`) et source
  `filter_gfs_0p25_1hr.pl`. Puis écrire
  `docs/superpowers/specs/2026-08-29-pipeline-gfs-design.md`, puis
  `superpowers:writing-plans`.

### 2026-08-29 — Amorçage du dépôt et installation du suivi de continuité

Dépôt initialisé (`git init`), plan d'implémentation déplacé en `docs/PLAN.md`, et
mise en place du dispositif de continuité repris d'un projet précédent :

- `.claude/skills/updating-history/SKILL.md` — la procédure de mise à jour, élaguée
  des anecdotes du projet d'origine, réadaptée à la structure Python + Vite ;
- `tools/history_check.py` — le contrôle mécanique, **porté de TypeScript vers
  Python stdlib** (§5), avec une amélioration : les dossiers surveillés viennent
  de `git ls-files` au lieu du disque ;
- `tests/test_history_check.py` — **30 tests**, `python -m unittest discover -s tests`,
  tous verts ;
- ce document.

**Aucun code applicatif écrit.** Le contrôle passe au vert sur un dépôt sans
`pipeline/` ni `web/` : les racines absentes sont ignorées sans bruit.

- **Tests :** 30/30 verts.
- **Build :** sans objet (aucun frontend).
- **Prochaine action :** **Phase 1** du plan — `pipeline/fetch_gfs.py`, puis
  `grib_to_texture.py`. Critère d'acceptation : le PNG ouvert dans un visualiseur
  montre clairement les continents, et le script relancé deux fois ne
  retélécharge pas. Trancher au passage la dette n° 2 (installation d'`eccodes`).

## 10. Comment maintenir ce document

**Quand :** après **chaque session**, **chaque exécution de plan** et **chaque
modification du site**.

**Comment :** le skill **`updating-history`** (`.claude/skills/updating-history/`)
porte la procédure complète et se déclenche sur « met à jour HISTORY ». Le principe
tient en une phrase : **partir du diff, pas de la mémoire.**

```bash
git diff --stat <base>..HEAD     # <base> = main avant la session
```

Puis, pour chaque type de changement observé, la ou les sections qu'il **force** :

| Ce que montre le diff | Sections obligatoires |
|---|---|
| Fichier créé, supprimé ou déplacé ; nouveau dossier | **§3** (arbre) |
| Dépendance, script, service externe, source de données | **§2** |
| Choix d'architecture, arbitrage tranché, décision utilisateur | **§5**, avec le **pourquoi** |
| Défaut non trivial, surtout trouvé par une revue | **§6** |
| Phase livrée / branche mergée | **§7** (date, nom, statut, commit de merge, nb de tests) |
| Dette créée **ou résolue** | **§8**, dans les deux sens |
| Toute session, sans exception | **§9** (entrée datée, tests, build, prochaine action) |
| Nouvelle section `## N.` | **Sommaire** |

**Puis vérifier :**

```bash
python tools/history_check.py
```

Il compare mécaniquement le document au dépôt : fichiers fantômes en §3, dossiers
de code jamais nommés, merges sans ligne en §7, pied de page en retard sur le
dernier commit du document. Il ne couvre **pas** §2, §5, §6, §8 et §9 — celles-là
relèvent du jugement, et c'est la table ci-dessus qui les couvre.

⚠️ **Le contrôle du pied de page a une latence d'un commit, assumée.** Il compare
la date annoncée au **dernier commit ayant touché `HISTORY.md`**, et non à la date
du jour : le contrôle reste ainsi déterministe et ne vire pas au rouge sur une
coquille corrigée. Conséquence pratique : **bumper le pied de page dans le même
commit** que la mise à jour.

📐 **Forme du pied de page — UNE ENTRÉE PAR LIGNE.** C'est une chaîne :
`**Dernière mise à jour :**` en tête, puis un `**Entrée précédente :**` par session
passée, **chacun sur sa propre ligne**. Pour la mettre à jour : insérer la nouvelle
entrée en tête et rétrograder l'ancienne. ⛔ Ne jamais réécrire la chaîne entière
ni l'élaguer. *Pourquoi cette forme, leçon importée d'un projet précédent :* git
diffe **par ligne**, et là-bas la chaîne avait atteint **34 Ko sur une seule
ligne** — toucher un caractère produisait alors le même diff qu'effacer tout. Le
rendu Markdown est identique dans les deux formes.

💰 **Ce document deviendra cher à lire** (compter ~2,3 caractères par token en
français accentué). Trois règles pour le contenir :

- **① Une seule passe de mise à jour, en fin de session.** Écrire l'entrée §9 une
  fois, quand l'histoire est connue. Au fil de l'eau, on réécrit cinq fois les
  mêmes paragraphes — mesuré ailleurs : 22 K tokens au lieu de ~8 K.
- **② Lire par section, jamais en entier.** Sommaire, puis `offset`/`limit`.
  Relever ici le coût des grosses sections dès que le document dépasse quelques
  dizaines de Ko.
- **③ Archiver §9 au-delà d'une dizaine d'entrées** → `docs/history-archive.md`,
  **déplacées telles quelles**, jamais résumées ni élaguées. Couper sur une
  **date**, pas sur un compte.

⚠️ **Ce fichier est en LF**, comme tout le dépôt — imposé par `.gitattributes`
(`* text=auto eol=lf`) et non par la config git locale, qui est en `autocrlf=true`
sur le poste de dev. Tout script qui réécrit le document doit émettre du LF, sinon
git rapporte le fichier entier comme modifié.

---

**Dernière mise à jour :** 2026-09-19 (**dettes n° 42 et n° 41 validées dans le navigateur, mergées `116991f` et déployées** — 348 vitest + 206 pytest, bundle 161,62 Ko gzip ; aucun chantier en cours)
**Entrée précédente :** 2026-09-19 (**dettes n° 42 et n° 41 traitées sur `refactor/geo-wiring`, non mergé** — `geo/wiring.ts` testable en Node, étiquettes qui évitent panneaux et bords, countries.json 206 lignes ; 348 vitest + 206 pytest, bundle 161,62 Ko gzip ; **validation navigateur en attente** avant merge)
**Entrée précédente :** 2026-09-19 (**lot C validé sur vrai téléphone, mergé `c4ed59e` et déployé** — étiquettes villes/pays avec valeur de couche + fleuves en prod ; 326 vitest + 204 pytest, bundle 160,65 Ko gzip ; aucun lot en cours)
**Entrée précédente :** 2026-09-18 (**lot C implémenté et revu sur `feat/labels-rivers`, non mergé** — étiquettes villes/pays avec valeur de couche + fleuves ; T1–T11 faites, revue finale « With fixes » corrigée (`77d1e8f`), 326 vitest + 19 pytest, bundle 160,65 Ko gzip ; **en attente de la validation utilisateur sur vrai téléphone**, puis T12 merge/déploiement)
**Entrée précédente :** 2026-09-18 (**vent et nuages validés par l'utilisateur en prod** — profils vent 5 000/K9 stride 3 et `soften` nuages 1,2 figés ; prochaine étape lot C)
**Entrée précédente :** 2026-09-18 (**flou retiré de la pluie** — verdict utilisateur final (0,8 trop flou, 0,4 invisible), merge `5c9b060`, `soften` sur les nuages seuls, 248 vitest ; puis lot C)
**Entrée précédente :** 2026-09-18 (**pluie : σ 0,8 → 0,4** — verdict utilisateur « trop flou », merge `1c66add`, 248 vitest ; puis lot C)
**Entrée précédente :** 2026-09-18 (**pluie adoucie** — `soften` 0,8 sur la pluie, merge `39ca638`, 248 vitest ; verdict utilisateur attendu sur la prod, puis lot C)
**Entrée précédente :** 2026-09-18 (**vent plus lisible et nuages adoucis** — `feat/wind-clouds-polish` mergée `0cc0d52` : traînées en quads instanciés 2 px, 5 000/K9 stride 3, P = 3 ; `soften` 1,2 sur les nuages (flou gaussien CPU) ; 248 vitest, build 156,08 Ko gzip ; prochaine étape lot C)
**Entrée précédente :** 2026-09-13 (**lot B2 mergé et déployé** — merge `c120f81`, push master, CI deploy vert, `pipeline.yml` run 34768517485 → 9 couches en production dont `wind_u`/`wind_v`, `gfs/latest.*` supprimés de R2, site en 200 avec le vent)
**Entrée précédente :** 2026-09-13 (**spec 4 lot B2 vent animé — revue finale, vague de correction, validation navigateur, critère 8 révisé** — revue finale (`209a38b..0003b29`) : I1 tick réel 9–15 ms (T6 mesuré sur grille de test non représentative), I2 `applyWind`/spec §11, I3 TDZ `stopWind`, I4 seuil d'horizon ; vague unique (`e4b4d6a`/`2e77ec7`/`73b3687`/`9458c3d`) : `WindField.uv` entrelacé + `sampleUV` fusionné, statut vent avec switch actif (déviation §11), seuil exact, `onFrame` isolé par callback ; correctif résiduel trouvé en validation (`0996837` statut, `a68d44b` double comptage de l'accumulateur) ; **236 vitest**, build 154,69 Ko gzip (+3,99) ; validation navigateur T11b (Brave) : critères 1–7 ✅, critère 8 initial (≤ 4 ms) non atteignable sur la machine de référence → **révisé par l'utilisateur** vers un budget de frame (≤ 16 ms, mesuré 11,7 ms moy/19,4 p90 high, 4,6 ms low) → ✅ ; **exécutée et validée, merge à suivre**)
**Entrée précédente :** 2026-09-13 (**spec 4 lot B2 vent animé exécutée sur `feat/wind`** — plan `cda0f39` 12 tâches subagent-driven, rounds T1 ×1/T6 ×2/T8 ×1/T11a ×1, 9 couches (`wind_u`/`wind_v`), legacy `gfs/latest.*` retiré (`596b247`, dette n° 31 fermée), fixture réelle `gfs_wind.grib2` + décodage vert sur Actions (195 pytest, dry-run 9 couches), particules CPU + `LineSegments`, 184 pytest local/9 skipped, 227 vitest, bundle 154,27 Ko gzip (+3,57), tick Node ≈ 4,57 ms, **validation navigateur en attente** (aucun Chrome joignable, critères 1–6/8 non mesurés), pas encore mergée)
**Entrée précédente :** 2026-09-13 (**spec 4 lot B2 vent animé : brainstorming, spec `38e5f27` et plan `cda0f39` écrits, 12 tâches, aucun code touché**)
**Entrée précédente :** 2026-09-12 (**spec 4 lot B1 couches exécutée, session arrêtée** — branche `feat/layers`, 16 tâches subagent-driven + 3 rounds de correction, pipeline à deux sources GFS/GEFS-Aerosols, manifeste `layers/latest.json` v2, 7 couches scalaires + menu, 173 pytest local/9 skipped + 171 vitest, bundle gzip 151,01 Ko, validation brave-devtools 9/9, revue finale « With fixes » + vague de correction, dette n° 37 fermée avant merge, mergé `cd667bd` et déployé, 7 couches en production)
**Entrée précédente :** 2026-09-12 (**verdict téléphone spec 4 lot A** — critères 3 et 5 ✅ sur téléphone réel, dette n° 23 fermée, lot B retenu pour le brainstorming suivant)
**Entrée précédente :** 2026-09-06 (**spec 4 lot A navigation exécutée** — branche `feat/navigation`, 10 tâches subagent-driven + 4 rounds + vague finale, zoom ancré sur l'altitude, pincement, tooltip, fondu, 146 vitest + 127 pytest local, dette n° 23 fermée côté code, critères 3 et 5 téléphone à confirmer)
**Entrée précédente :** 2026-09-05 (**spec 3 tuiles exécutée** — branche `feat/tiles`, pyramide géodésique 512 px + index WTIX + hillshade GDAL, globe en quadtree de patches, bouton Température, domaine `globelayers.com`/`data.globelayers.com`, génération v1 72 893 tuiles ≈ 4,5 Go, 91 vitest + 127 pytest local/5 skipped, dette n° 4 résolue, dettes n° 15 à 19, 22, 23 ouvertes, critère 6 validé sur téléphone, mergé `dcca866`, déployé sur globelayers.com, r2.dev/workers.dev coupés)
**Entrée précédente :** 2026-09-02 (**site en ligne** — revue finale + vague de correction, merge `fcaf208`, premier déploiement Workers Static Assets sur `worldtemp.geoviz.workers.dev`, CORS R2, sous-domaine renommé `geoviz`, critères 4 et 6 ✅, critère 5 à valider, 60 vitest, dette n° 12 résolue, dette n° 14 ouverte)
**Entrée précédente :** 2026-09-02 (**globe + heatmap livrés** — branche `feat/globe-heatmap`, 10 tâches subagent-driven + revues, 59 vitest + 94 pytest local/1 skipped, Workers Static Assets remplace Pages, merge et déploiement à venir, dette n° 3 honorée côté front, dettes n° 10 à 13 ouvertes)
**Entrée précédente :** 2026-09-02 (**R2 en service, premier run réel publié** — Task 12 : bucket `worldtemp` + `r2.dev` + CORS par MCP Cloudflare, token et secrets par l'utilisateur, `pipeline.yml` réactivé, critères 4 et 5 ✅, critère 6 reporté en dette n° 9, prochaine étape spec 2 globe)
**Entrée précédente :** 2026-08-30 (**pipeline GFS implémenté et mergé** — merge `aa29c6f`, 11 tâches subagent-driven + revue finale, 94 passed/1 skipped local, 95 sur Actions, dettes n° 3 et n° 5 résolues, R2 non activé, **cron `pipeline.yml` désactivé en attendant la Task 12**)
**Entrée précédente :** 2026-08-29 (**dépôt GitHub + brainstorming pipeline** — remote `Haddepe/worldtemp`, hébergement tranché GH Actions → Cloudflare R2/Pages, approche A validée, OpenDAP NOMADS constaté retiré, aucun code applicatif)
**Entrée précédente :** 2026-08-29 (**amorçage du dépôt** — `git init`, plan déplacé en `docs/PLAN.md`, skill `updating-history` + `tools/history_check.py` installés, 30 tests verts, aucun code applicatif)
