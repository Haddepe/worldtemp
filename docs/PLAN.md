# Plan d'implémentation — Globe 3D des températures mondiales

## Contexte et objectif

Site web affichant un globe 3D interactif (type Google Earth) avec :
- le **relief terrestre** en 3D (exagération verticale, displacement map + normal map) ;
- une **heatmap des températures actuelles** du monde entier (bleu foncé = froid → rouge foncé = chaud), issue du modèle météo **GFS (NOAA)**, données à 0,25° mises à jour toutes les heures via un pipeline automatisé ;
- une **navigation fluide** y compris sur mobiles modestes (deux niveaux de subdivision de sphère sélectionnés selon le GPU détecté).

Données GFS = domaine public (NOAA), compatible monétisation par publicité. Délai des données : ~4-6 h par rapport au temps réel, c'est normal et accepté.

## Stack technique

- **Backend / pipeline de données** : Python 3.11+, `xarray`, `cfgrib` (nécessite `eccodes`), `numpy`, `Pillow`, `requests`. Sortie : fichiers statiques (PNG + JSON), aucun serveur applicatif.
- **Frontend** : Vite + Three.js (vanilla JS ou TypeScript, pas de framework lourd). Shaders GLSL custom.
- **Hébergement cible** : fichiers statiques + CDN ; le pipeline tourne en cron sur un petit VPS ou en CI planifiée.

## Structure du dépôt

```
/pipeline/          # Python : GFS → textures
  fetch_gfs.py      # téléchargement NOMADS filtré
  grib_to_texture.py# GRIB2 → PNG niveaux de gris + metadata.json
  run_pipeline.py   # orchestration + idempotence
/web/               # Frontend Vite + Three.js
  /public/data/     # textures température + metadata (déposées par le pipeline)
  /public/assets/   # textures statiques : altitude, normal map, couleur de base
  /src/
    main.js
    globe.js        # scène, caméra, contrôles
    shaders/        # vertex + fragment GLSL
    gpuTier.js      # détection GPU → choix subdivision
    colormap.js     # palette + légende
/docs/PLAN.md       # ce plan
```

---

## Phase 1 — Pipeline GFS → texture de température

**Objectif : un PNG équirectangulaire en niveaux de gris encodant la température à 2 m, monde entier, régénéré chaque heure.**

1. **Téléchargement** via le script de filtrage NOMADS (`https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl`) :
   - variable `TMP`, niveau `2 m above ground`, région monde entier → fichier GRIB2 de ~1-2 Mo ;
   - logique de sélection du run : les runs sortent à 00/06/12/18 UTC avec ~4-5 h de latence. Déterminer le dernier run réellement disponible (tester en remontant), puis choisir l'échéance horaire `fNNN` telle que `run + NNN ≈ heure UTC actuelle` ;
   - gestion des erreurs : retry avec backoff, et si NOMADS est indisponible, conserver la dernière texture valide (ne jamais casser le site).
2. **Conversion GRIB → texture** :
   - lecture avec `xarray.open_dataset(..., engine="cfgrib")` ; grille attendue 721 × 1440, lat 90 → -90, lon 0 → 360 ;
   - décaler les longitudes en -180 → 180 (`np.roll`) pour une équirectangulaire standard ;
   - Kelvin → °C, puis normalisation linéaire sur une plage fixe **[-90 °C, +60 °C]** couvrant les records mondiaux (Vostok ≈ -89 °C, Vallée de la Mort ≈ +57 °C), encodée en 8 bits (documenter la formule : `pixel = (T + 90) / 150 * 255`, clamp) — la plage fixe est indispensable pour que le shader décode sans métadonnées par frame. Précision résultante : ~0,59 °C par niveau, suffisante pour la heatmap ; si le tooltip exige mieux, passer la texture en PNG 16 bits (même formule, 65535 niveaux) ;
   - export PNG 1440 × 721, niveaux de gris, + `metadata.json` : `{run, forecast_hour, valid_time_utc, min_c: -90, max_c: 60, generated_at}`.
3. **Orchestration** : `run_pipeline.py` idempotent (si la texture pour l'heure courante existe déjà, ne rien faire), écriture atomique (fichier temporaire puis rename), destiné à un cron horaire. Copie vers `/web/public/data/`.

**Critères d'acceptation** : ouvrir le PNG dans un visualiseur montre clairement les continents (contraste terre/mer, pôles sombres, tropiques clairs) ; le script relancé deux fois ne retélécharge pas ; une panne réseau simulée laisse l'ancienne texture en place.

## Phase 2 — Globe de base fluide

**Objectif : une sphère navigable, sans relief ni heatmap, avec l'architecture de rendu définitive.**

1. Scène Three.js : `SphereGeometry`, `OrbitControls` (zoom min/max bornés, damping activé, rotation inertielle), fond étoilé simple ou noir, éclairage directionnel + ambiant léger.
2. Texture couleur de base de la Terre (ex. NASA Blue Marble équirectangulaire, domaine public) pour valider le mapping UV.
3. `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`, redimensionnement propre, boucle de rendu avec `requestAnimationFrame`.
4. Dès cette phase, utiliser un **ShaderMaterial custom** (même trivial : juste la texture couleur + lambert simple) — tout le reste du projet vit dans ces shaders, ne pas partir sur les matériaux standards pour devoir migrer ensuite.

**Critères d'acceptation** : 60 fps sur desktop, rotation/zoom fluides, pas de couture visible au méridien 180°, pôles sans artefact grossier.

## Phase 3 — Détection GPU et deux niveaux de subdivision

**Objectif : le globe choisit sa densité de maillage selon la machine, avant la création de la géométrie.**

1. `gpuTier.js` exporte `detectTier()` → `"high"` ou `"low"`, déterminé par faisceau d'indices (aucun n'est fiable seul) :
   - `WEBGL_debug_renderer_info` → nom du GPU ; listes de motifs : `Apple`, `NVIDIA`, `Radeon`, `Xe` → high ; `Mali-4`, `Mali-T`, `Adreno 3`, `Adreno 4`, `Adreno 5`, `PowerVR` → low ;
   - si l'extension est indisponible : heuristiques — `navigator.hardwareConcurrency <= 4` ou (`mobile` ET `devicePixelRatio < 2`) → low ;
   - micro-benchmark de secours : rendre ~20 frames d'une scène de test hors écran, si le temps moyen par frame > 20 ms → low ;
   - paramètre d'URL `?tier=high|low` pour forcer (indispensable pour tester).
2. Profils :
   - **high** : `SphereGeometry(R, 768, 384)` (~590 k triangles), textures relief 8K, pixelRatio ≤ 2 ;
   - **low** : `SphereGeometry(R, 256, 128)` (~65 k triangles), textures relief 4K max, pixelRatio ≤ 1,5, normal map conservée (c'est elle qui maintient la qualité perçue quand la géométrie baisse).
3. La géométrie est créée **une seule fois** au démarrage selon le tier. Jamais de régénération pendant la navigation.

**Critères d'acceptation** : `?tier=low` sur desktop affiche un globe visiblement moins dense mais encore beau ; sur un mobile milieu de gamme, navigation ≥ 30 fps stables ; le tier choisi est loggé en console.

## Phase 4 — Relief 3D

**Objectif : topographie visible et esthétique, entièrement sur GPU.**

1. **Sources** (domaine public) : heightmap équirectangulaire dérivée d'ETOPO 2022 (NOAA) ou des heightmaps NASA prêtes à l'emploi. Préparer via un petit script Python : version 8K (8192 × 4096) pour high, 4K pour low, PNG canal unique 16 bits si possible (sinon 8 bits acceptable vu l'exagération).
2. **Vertex shader** : lire la heightmap, déplacer chaque sommet le long de sa normale : `pos += normal * height * displacementScale`. Exagération verticale réglable, valeur par défaut ≈ ×30 (exposer un uniform pour ajuster à l'œil).
3. **Normal map** générée depuis la heightmap (script Python, filtre de Sobel) ; utilisée dans le fragment shader pour l'éclairage fin.
4. Option : traiter la bathymétrie à plat (océans non déformés) — clamp des altitudes négatives à 0 dans la préparation de la heightmap.

**Critères d'acceptation** : Himalaya, Andes, Rocheuses clairement lisibles en lumière rasante ; pas de "marches d'escalier" (si visibles en 8 bits, passer la heightmap en 16 bits) ; fps inchangés par rapport à la Phase 2 sur les deux tiers.

## Phase 5 — Heatmap température + hillshading

**Objectif : la couche météo vivante, composée avec le relief.**

1. Le fragment shader charge la texture de température (Phase 1) sur les mêmes UV :
   - décodage : `T = texel * 150.0 - 90.0` ;
   - **colormap dans le shader** (rampe multi-arrêts, pas un simple lerp bleu→rouge) : violet/quasi-noir (-90°) → bleu foncé (-45°) → bleu → cyan → vert → jaune → orange → rouge → rouge foncé (+45°) → magenta foncé (+60°). Concentrer la plupart des arrêts de couleur entre -45° et +45° (là où vivent 99 % des pixels) et réserver les teintes extrêmes aux queues de distribution, sinon la carte paraîtra terne au quotidien. Implémenter comme LUT 1D (texture 256 × 1 générée par `colormap.js`) pour pouvoir changer de palette sans toucher au shader ;
   - **interpolation bilinéaire** native (filtrage linéaire de la texture) pour une heatmap lisse malgré les 0,25°.
2. **Hillshading** : multiplier la couleur de la heatmap par le terme d'éclairage issu de la normal map (borné, ex. 0,55–1,0) pour que le relief reste lisible sous la couleur.
3. Uniform `heatmapOpacity` (0 → 1) pour fondre entre la texture couleur naturelle et la heatmap ; slider UI simple.
4. Chargement des données : fetch de `metadata.json` puis de la texture ; re-fetch toutes les 15 min (avec cache-busting par `generated_at`) pour capter les mises à jour sans recharger la page.

**Critères d'acceptation** : gradients lisses sans effet de pixels ; tropiques rouges / pôles bleus cohérents avec la saison ; montagnes visibles sous la heatmap ; la date/heure des données s'affiche.

## Phase 6 — Interactivité et finitions

1. **Tooltip au survol/tap** : raycast caméra → sphère, conversion du point d'impact en lat/lon, lecture de la température **depuis les données** (conserver côté JS un canvas 2D de la texture température pour lire les pixels — pas de lecture GPU) : affiche « 23,4 °C — lat, lon ».
2. **Légende** : barre de couleur générée par `colormap.js` (le même code que la LUT — une seule source de vérité), graduations en °C.
3. Bandeau discret : « Données : NOAA GFS, run XX UTC, valide à XX UTC ».
4. Rotation automatique lente quand l'utilisateur est inactif ; atmosphère (glow de fresnel sur le pourtour) pour le réalisme.
5. Emplacements publicitaires : réserver des conteneurs fixes dans le layout (hors canvas) dès maintenant pour éviter les layout shifts plus tard.

## Phase 7 — Build et déploiement

1. `vite build` → site 100 % statique. Textures relief avec cache long (immutables, hash dans le nom) ; `data/*` avec cache court (5 min).
2. Cron horaire du pipeline sur le serveur ; le pipeline dépose directement dans le dossier servi.
3. Vérifier les poids : cible < 15 Mo au premier chargement en high, < 6 Mo en low (compresser les PNG, envisager WebP/KTX2 si nécessaire — seulement si les cibles ne sont pas atteintes).

---

## Conventions et garde-fous

- **Ordre strict des phases** ; chaque phase se termine par ses critères d'acceptation validés visuellement avant de continuer.
- Une seule source de vérité pour l'encodage température (plage [-90, +60] °C) : documentée dans `grib_to_texture.py`, `shaders/` et `colormap.js` avec un commentaire croisé.
- Aucune dépendance frontend au-delà de Three.js sans justification.
- Tester régulièrement `?tier=low` : la version modeste est un citoyen de première classe, pas un fallback dégradé.
- Ne jamais commiter les gros binaires de textures relief : script de téléchargement/génération dans `/pipeline/` + entrées `.gitignore`.
