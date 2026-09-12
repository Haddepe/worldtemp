# Spec — Couches multiples (lot B1) : nuages, pluie, pression, humidité, PM2.5, poussière

**Date :** 2026-09-12 · **Statut :** validée en brainstorming, à planifier
**Périmètre :** sous-projet 4, lot B1 « couches scalaires + menu ». Pipeline, contrat
de données, front. Le vent animé (lot B2, champ vectoriel U/V, particules) et les
étiquettes villes/pays (lot C) restent au backlog ; B2 s'appuiera sur le registre et
le contrat posés ici.

## 1. Objectif

Le globe n'affiche qu'une variable, la température à 2 m. Le nom du site,
« globelayers », promet plusieurs couches. Cette spec en livre **sept**, une à la fois
à l'écran, choisies dans un menu :

| id | couche | modèle | champ GRIB | unité affichée |
|---|---|---|---|---|
| `temp` | Température | GFS 0,25° | `TMP` 2 m above ground | °C |
| `clouds` | Nuages | GFS | `TCDC` entire atmosphere, instantané | % |
| `rain` | Pluie | GFS | `PRATE` surface, instantané | mm/h |
| `pressure` | Pression | GFS | `PRMSL` mean sea level | hPa |
| `humidity` | Humidité | GFS | `RH` 2 m above ground | % |
| `pm25` | Particules fines | GEFS-Aerosols 0,25° | `PMTF` surface, aérosol Total | µg/m³ |
| `dust` | Poussière | GEFS-Aerosols | `PMTC` surface, aérosol Dust Dry (PM10) | µg/m³ |

Faits vérifiés sur NOMADS le 2026-09-12 (run GFS 00z, f004 ; GEFS 00z, f003) : les
cinq champs GFS sont dans le fichier `pgrb2.0p25` horaire ; `TCDC:entire atmosphere` y
figure **deux fois** (instantané et « 0-4 hour ave »), `PRATE:surface` aussi ; GEFS-chem
a 4 cycles/jour (00, 06, 12, 18), des échéances toutes les 3 h jusqu'à f084, et
`PMTF:surface` en trois messages (Dust Dry, Sea Salt Dry, Total Aerosol) en kg/m³. Le
filtre `filter_gefs_chem_0p25.pl` répond 200 (≈ 2 Mo pour `var_PMTF&lev_surface`).

Décisions prises en brainstorming (ne pas rouvrir) : découpage B1 scalaires / B2 vent ;
une couche à la fois (radio, façon Ventusky) ; qualité de l'air via GEFS-Aerosols
(NOMADS, même mécanique, aucune clé) plutôt que CAMS (ADS, clé API, 0,4°) ou GEOS-CF
(serveurs NASA vus instables) ; poussière **grossière** (PM10) car les tempêtes de sable
sont dominées par les particules 2,5–10 µm.

## 2. Approche retenue

**A — pipeline généralisé, un PNG 8 bits par couche, un manifeste unique.** Un registre
de couches côté Python pilote téléchargement, décodage, encodage et manifeste ; un
registre côté TypeScript pilote palettes, unités et menu. Le manifeste dit *ce qui
existe* (couches, échéances, encodage), le front dit *comment l'afficher*.

Écartées :

- **B — empaquetage de trois variables par PNG RGB** : moins de requêtes, mais tout se
  télécharge d'un coup, PNG trois fois plus lourd, et la cadence GEFS (3 h) ne peut pas
  cohabiter avec GFS (1 h) dans un même fichier.
- **C — un workflow et un manifeste par source** : isolation des pannes, mais double
  plomberie CI, secrets dupliqués, fusion de manifestes côté front. Prématuré pour deux
  sources ; A isole déjà les sources en modules Python et tolère l'échec de la
  source secondaire (§8).

Fichiers touchés :

```
pipeline/
  layers.py         # NOUVEAU : registre LayerSpec (7 entrées)
  sources.py        # NOUVEAU : descripteurs de source (gfs, gefs_chem)
  run_selection.py  # candidates(step_hours=…)
  nomads.py         # build_url(source, candidate) multi-variables
  grib_adapter.py   # decode_fields(data, specs) → dict[id, Field]
  texture.py        # convert, validate_range, quantize(scale=…)
  metadata.py       # build_manifest (v2) + build_legacy (v1)
  main.py           # orchestration à deux sources, report chem
  publish.py        # upload de N objets, lecture du manifeste courant
  config.py         # clés R2 layers/, délais par source
tests/fixtures/
  gfs_layers.grib2  # NOUVEAU : vrai fichier filtré, 5 variables (≈ 8 Mo)
  gefs_chem.grib2   # NOUVEAU : vrai fichier filtré, PMTF + PMTC surface (≈ 3 Mo)
web/src/
  layers/registry.ts   # NOUVEAU : LayerDef (libellé, unité, format, palette RGBA, isolignes)
  layers/select.ts     # NOUVEAU : ordre, disponibilité, paramètre d'URL (pur)
  layers/cache.ts      # NOUVEAU : LRU de 2 LayerLoader
  data/manifest.ts     # NOUVEAU : parseManifest v2 (remplace metadata.ts)
  data/encoding.ts     # NOUVEAU : encode/decode linéaire et racine
  data/loader.ts       # LayerLoader (PNG d'une couche) + ManifestLoader
  data/sampling.ts     # sampleValue (générique) remplace sampleTemperature
  render/colormap.ts   # STOPS → registre ; buildLut(def, encoding) RGBA, gradient rgba()
  render/globe.ts      # setLayer(texture | null), setIsoStep
  render/shaders/patch.frag.glsl  # composition alpha, isolignes
  ui/layers-menu.ts    # NOUVEAU : radiogroup DOM
  ui/overlay.ts        # légende par couche, plus de bouton filtre
  ui/format.ts         # formatBanner(def, entry, now), legendTicks(def, encoding)
  ui/tooltip.ts        # setData(def, pixels, grid, encoding)
  main.ts              # câblage
web/index.html, web/src/style.css
```

## 3. Registre de couches (`pipeline/layers.py`)

`LayerSpec` gelée : `id`, `source` (`"gfs"` | `"gefs_chem"`), `nomads_var`, `nomads_lev`
(paramètres du filtre), `grib_keys` (sélection cfgrib), `convert` (fonction numpy vers
l'unité affichée), `unit`, `plausible` (plage physique avant conversion, sinon exit 3),
`encoding` (`min`, `max`, `scale`).

| id | `nomads_var` / `nomads_lev` | `grib_keys` (provisoires, fixés par la fixture §9) | `convert` | `plausible` (brut) | `encoding` |
|---|---|---|---|---|---|
| temp | `TMP` / `2_m_above_ground` | shortName `t2m` | K − 273,15 | 180–340 K | linéaire −90 → 60 |
| clouds | `TCDC` / `entire_atmosphere` | shortName `tcc`, typeOfLevel `atmosphere`, stepType `instant` | identité | 0–100 % | linéaire 0 → 100 |
| rain | `PRATE` / `surface` | shortName `prate`, stepType `instant` | × 3600 | 0–0,1 kg/m²/s | **racine** 0 → 50 |
| pressure | `PRMSL` / `mean_sea_level` | shortName `prmsl` | ÷ 100 | 85 000–110 000 Pa | linéaire 940 → 1060 |
| humidity | `RH` / `2_m_above_ground` | shortName `r2` | identité, borné 0–100 | 0–102 % | linéaire 0 → 100 |
| pm25 | `PMTF` / `surface` | shortName `pmtf`, aerosolType Total | identité | 0–20 000 µg/m³ | **racine** 0 → 500 |
| dust | `PMTC` / `surface` | shortName `pmtc`, aerosolType Dust Dry | identité | 0–50 000 µg/m³ | **racine** 0 → 2000 |

**Corrigé à l'exécution (T4/T7)** : `clouds` — `typeOfLevel` réel confirmé
`atmosphere` par la fixture (déjà correct dans la table ci-dessus, hypothèse
validée, pas modifiée) ; `pm25`/`dust` — la valeur brute du GRIB NOMADS est
**déjà en µg/m³** (clé eccodes `units` = `(10**-6 g) m**-3`), pas en kg/m³ comme
supposé initialement : `convert` devient l'identité (au lieu de `× 1e9`) et la
plage plausible se lit directement en µg/m³, élargie ensuite à (0, 20 000) et
(0, 50 000) après qu'un run réel a atteint 3 187 µg/m³ sur `pm25` (calibration
T7). L'encodage d'affichage (`sqrt` 0 → 500 / 0 → 2000) ne change pas.

Les noms cfgrib et la valeur numérique d'`aerosolType` sont **fixés par la tâche
fixture** (§9), seule à pouvoir les vérifier ; le registre est la seule source de
vérité une fois le test vert. Invariants testés : ids uniques, `min < max`, plage
plausible non vide, chaque source citée existe dans `sources.py`.

## 4. Sources et sélection d'échéance (`pipeline/sources.py`, `run_selection.py`)

`SourceSpec` gelée : `id`, `label` (« NOAA GFS 0,25° », « NOAA GEFS-Aerosols 0,25° »),
`model` (`gfs_0p25`, `gefs_chem_0p25`, repris dans le manifeste), `filter_url`,
`dir_pattern`, `file_pattern`, `step_hours` (1 ; 3), `availability_delay` (3 h 30 ;
**5 h**, à recaler par l'observation des 404), `max_forecast_hour` (48 ; 84),
`primary` (vrai ; faux).

`candidates(now, *, step_hours, delay, max_candidates, max_forecast_hour)` : l'heure
cible est **arrondie au multiple inférieur de `step_hours`** avant le calcul actuel
(`floor_to_hour` devient `floor_to_step`). Pour `gefs_chem` à 14:40 UTC : cible 12:00,
run 06z f006, puis 00z f012… Une couche chem affiche donc une échéance de 0 à 3 h
d'ancienneté ; c'est documenté dans le bandeau par `valid_time_utc`.

URL d'une source : `filter_url?dir=…&file=…&var_A=on&var_B=on…&lev_X=on&lev_Y=on…`,
toutes les variables et tous les niveaux de ses couches. Le filtre renvoie le produit
var × niveau : quelques messages superflus (`TMP:surface`, `RH:entire atmosphere`…),
≈ 8 Mo pour GFS, sans effet car le décodage sélectionne par clés.

## 5. Téléchargement et décodage (`nomads.py`, `grib_adapter.py`)

`nomads.download` inchangé (404 → `NotFound`, 403/429/5xx → `TransientError`, un
retry, contrôle du magic `GRIB`).

`decode_fields(data, specs) -> dict[str, Field]` : un seul fichier temporaire, une
ouverture cfgrib **par spec** avec `backend_kwargs={"filter_by_keys": spec.grib_keys,
"indexpath": ""}`, valeurs `float32` (721, 1440), `lat`/`lon` renvoyés pour la
validation d'orientation (inchangée : `lat[0] == 90`, `lon[0] == 0`). Une spec absente
du fichier ou ambiguë (deux messages restants) lève `DecodeError` → exit 3 pour la
source primaire, report pour la secondaire (§8). `Field` perd son commentaire « Kelvin » :
il porte la valeur brute GRIB.

## 6. Encodage et textures (`texture.py`)

Chaîne par couche : `validate_shape_orientation` → `validate_range(plausible)` →
`convert` → `reorient` (roll d'une demi-largeur, inchangé) → `quantize(min, max, scale)`
→ `encode_png`.

Encodage 8 bits, `x = (v − min) / (max − min)` borné à [0, 1] :

- `linear` : `pixel = round(255·x)` ; décodage `v = min + (max − min)·(i/255)`.
- `sqrt` : `pixel = round(255·√x)` ; décodage `v = min + (max − min)·(i/255)²`.

La racine donne la finesse là où elle compte : pluie 0–2 mm/h sur 51 niveaux au lieu
de 10, PM2.5 0–35 µg/m³ sur 67 niveaux au lieu de 18. Coût nul au rendu (§10).
`stats` du manifeste calculées **après conversion, avant quantification**.

## 7. Contrat `layers/latest.json` (schema_version 2)

```json
{
  "schema_version": 2,
  "generated_at": "2026-09-12T14:12:40Z",
  "grid": { "width": 1440, "height": 721, "lon_min": -180, "lon_max": 179.75,
            "lat_min": -90, "lat_max": 90, "lon_step": 0.25, "lat_step": 0.25 },
  "layers": {
    "temp": {
      "model": "gfs_0p25", "variable": "TMP_2m", "unit": "°C",
      "run": "2026-09-12T06:00:00Z", "forecast_hour": 8,
      "valid_time_utc": "2026-09-12T14:00:00Z", "generated_at": "2026-09-12T14:12:40Z",
      "texture": "temp.png",
      "encoding": { "bits": 8, "min": -90, "max": 60, "scale": "linear" },
      "stats": { "min": -61.3, "max": 47.8 }
    },
    "pm25": {
      "model": "gefs_chem_0p25", "variable": "PMTF_surface_total", "unit": "µg/m³",
      "run": "2026-09-12T06:00:00Z", "forecast_hour": 6,
      "valid_time_utc": "2026-09-12T12:00:00Z", "generated_at": "2026-09-12T12:12:07Z",
      "texture": "pm25.png",
      "encoding": { "bits": 8, "min": 0, "max": 500, "scale": "sqrt" },
      "stats": { "min": 0.0, "max": 312.4 }
    }
  }
}
```

Règles :

- **Grille commune** à la racine : les deux modèles sont sur la même grille 0,25°,
  chaque champ est validé contre elle (forme (721, 1440)), sinon exit 3.
- **Par couche** : `generated_at` propre = cache-busting `?v=` (une couche reportée
  garde son `v`, le navigateur ne la retélécharge pas) ; `valid_time_utc` propre =
  statut « Données anciennes » par couche (seuil 6 h inchangé).
- `encoding.min/max/scale` génériques ; le front ne recopie aucune plage ni unité
  d'encodage. `unit` est informatif (le front formate depuis son registre).
- Le front ignore une couche inconnue de son registre ; une couche connue mais absente
  du manifeste n'a pas de bouton. `schema_version` ≠ 2 → `MetadataError`.
- **Legacy** : `gfs/latest.json` (schema 1, `min_c`/`max_c`, `texture: "latest.png"`) et
  `gfs/latest.png` continuent d'être publiés par `build_legacy(manifest["temp"])`
  **pendant une version**, pour les clients déjà chargés ; leur retrait est la première
  tâche de la spec suivante.

Clés R2 : `layers/<id>.png` (7), `layers/latest.json`, `gfs/latest.png`, `gfs/latest.json`.
`Cache-Control: public, max-age=300` inchangé.

## 8. Orchestration et publication (`main.py`, `publish.py`, `pipeline.yml`)

`run(now, …)` :

1. Lit le manifeste courant (`read_current` sur `layers/latest.json` ; `None` si absent
   ou illisible).
2. **Source primaire `gfs`** : candidats → idempotence (couple run/échéance de `temp`
   égal au manifeste courant → rien à faire pour cette source) → téléchargement →
   `decode_fields` → chaîne §6 pour ses 5 couches. Tout échec = comportement actuel
   (exit 2 source, exit 3 données), **rien n'est publié**, y compris pour chem.
3. **Source secondaire `gefs_chem`** : même chaîne. En cas d'échec (source, décodage,
   validation) : avertissement, et les entrées `pm25`/`dust` du manifeste courant sont
   **reportées telles quelles** (PNG intacts sur R2, `generated_at` et `valid_time_utc`
   anciens). Sans manifeste courant, elles sont omises. Exit 0.
4. Idempotence globale : si aucune source n'a produit de nouveau couple, exit 0 sans
   upload (log « déjà publié »).
5. Écriture locale atomique de tous les objets dans `out/`, puis `upload_r2(objects)` :
   **tous les PNG d'abord, `gfs/latest.json` puis `layers/latest.json` en dernier**. La
   seule incohérence possible reste « PNG neuf + manifeste ancien », invisible côté
   front grâce au `?v=`. Échec → exit 4.

Le cron horaire de `pipeline.yml` ne change pas ; la source chem ne produit du neuf
qu'une heure sur trois, l'idempotence par source absorbe le reste. `timeout-minutes`
passe à 15 (deux téléchargements). L'artefact `out/` contient tous les objets.

## 9. Fixtures et décodage réel

Le poste Windows ne décode pas de GRIB (dette n° 2). **Première tâche du plan** :
télécharger une fois, à la main, `gfs_layers.grib2` (5 variables, 4 niveaux) et
`gefs_chem.grib2` (`PMTF` + `PMTC`, surface) via les filtres, les commiter dans
`tests/fixtures/`, et écrire le test Actions qui décode les 7 champs, vérifie formes,
orientation, plages plausibles, et que `TCDC` retenu est bien l'instantané (l'autre
message a `stepType == "avg"`). Ce test fixe les `grib_keys` du registre ; aucune autre
tâche pipeline ne démarre avant qu'il soit vert sur Actions.

## 10. Front : registre, chargement, rendu

**Registre** `layers/registry.ts` — `LayerDef` : `id`, `label`, `unit`, `format(v)`
(précision : °C 1 décimale, % entier, hPa entier, mm/h 1 décimale, µg/m³ entier),
`stops: {v, rgba}[]` en valeur physique, `tickStep` ou `ticks[]`, `tooltipMin` (en
dessous : « — »), `isoStep?` (pression : 4 hPa). Ordre du menu = ordre du registre :
temp, clouds, rain, pressure, humidity, pm25, dust.

| id | palette (valeur → couleur) | transparence |
|---|---|---|
| temp | `STOPS` actuels | aucune |
| clouds | blanc, alpha 0 à 0 % → 1 à 100 % | voile progressif |
| rain | bleu 0,3 → cyan 2 → jaune 8 → rouge 25 → magenta 50 mm/h | alpha 0 sous 0,1, rampe jusqu'à 0,5 |
| pressure | bleu 940 → blanc 1013 → orange 1060 hPa | aucune, isobares 4 hPa |
| humidity | ocre 0 → blanc 50 → bleu-vert 100 % | aucune |
| pm25 | vert 5 → jaune 12 → orange 35 → rouge 55 → violet 150 → bordeaux 250 µg/m³ | alpha 0 sous 5, rampe jusqu'à 12 |
| dust | sable 20 → brun 200 → noir 2000 µg/m³ | alpha 0 sous 20, rampe jusqu'à 60 |

**Encodage** `data/encoding.ts` : `encode(v, enc)`, `decode(i, enc)` miroirs exacts de
§6, testés en aller-retour contre les valeurs Python (mêmes cas dans les deux suites).

**LUT** `render/colormap.ts` : `buildLut(def, enc)` — texel *i* = couleur RGBA
interpolée à `decode(i)`. `legendGradientCss(def, enc)` — arrêts `rgba()` placés à
`encode(v)/255` %, donc non uniformes en racine. Texture LUT toujours sRGB 256×1.

**Chargement** `data/loader.ts` : `ManifestLoader` (fetch + `parseManifest`, non
réentrant, renvoie le manifeste s'il a changé) et `LayerLoader` (à partir d'une entrée :
PNG → texture NoColorSpace + pixels CPU, comme aujourd'hui ; relit seulement si
`generated_at` a changé). `layers/cache.ts` : LRU de **2** loaders (active + précédente) ;
l'éviction dispose texture et pixels. Toutes les 15 min et au retour de visibilité :
manifeste, puis rafraîchissement de la couche active seule ; les autres à leur prochaine
activation. Le premier chargement ne télécharge que la couche initiale.

**Shader** — la branche « filtre » devient « couche active » (`uHasLayer`) :

```glsl
vec4 heat = texture2D(uLut, vec2(t, 0.5));          // t = octet Catmull-Rom (inchangé)
vec3 background = mix(satCol, mapCol, uMapStyle);   // le fondu actuel, calculé dans les deux branches
vec3 layer = heat.rgb * mix(1.0, tone, land);       // relief conservé sur la couche
float iso = uIsoStep > 0.0 ? isoline(t, uIsoStep) : 0.0;
layer *= 1.0 - 0.45 * iso;
vec3 color = mix(background, layer, heat.a);
color = mix(color, vec3(1.0), border * 0.7);
```

`isoline(t, step)` : `f = fract(t / step)`, distance au trait `min(f, 1 − f)·step`,
largeur `1,5·fwidth(t)`, `1 − smoothstep(0, w, d)`. `uIsoStep` en unités de `t`
(pression : 4/120) ; 0 = désactivé ; linéaire seulement. WebGL2 : `fwidth` disponible
sans extension. Le gris 0,5 « sans heatmap » disparaît : sans texture, `uHasLayer = 0`.

`globe.ts` : `setLayer(texture | null, width, height)` remplace `setHeatmap` +
`setFilter` ; `setIsoStep(step)` ; `setLut` inchangé. Un changement de couche = trois
uniforms et un `requestRender` : 0 draw call au repos conservé.

## 11. Tooltip, légende, bandeau, page

- **Tooltip** : `sampleValue(pixels, grid, enc, lon, lat)` (bilinéaire sur l'octet, puis
  `decode`) ; `tooltip.setData(def, pixels, grid, enc)` formate via `def.format` ; sous
  `def.tooltipMin` : « — ». Mode Aucune : tooltip inactif, marqueur retiré.
- **Légende** : titre `label · unit` (pression : « Pression · hPa · isobares 4 hPa »),
  gradient et graduations du registre, extrêmes `min`/`max` de `stats` formatés.
  Masquée en mode Aucune.
- **Bandeau** : `formatBanner(def, entry, now)` → « NOAA GFS 0,25° · run 06 UTC · valide
  14:00 UTC (16:00 locale) · il y a 12 min » avec le libellé de la source de la couche
  active. Statuts « Données anciennes » (valid_time > 6 h) et « Mise à jour impossible »
  jugés sur la couche active. Mode Aucune : « GlobeLayers », aucun statut de données.
- **Page** : `<title>` « GlobeLayers — météo mondiale en 3D », description et
  `aria-label` généralisés, attribution « NOAA GFS · GEFS-Aerosols » ajoutée. Le nom de
  code `worldtemp` (logs, dépôt, bucket) ne change pas.

## 12. Menu et URL

- `ui/layers-menu.ts` construit dans `#controls` un `role="radiogroup"`
  (`aria-label="Couche"`) : un bouton `role="radio"` par couche **présente dans le
  manifeste et connue du registre**, précédé de « Aucune ». `aria-checked`, tabindex
  roulant, flèches haut/bas (et gauche/droite) pour changer, Entrée/Espace inutiles
  (changement au focus, comportement radio natif). Une couche dont le PNG a échoué :
  `disabled` + `title="Indisponible"`.
- Desktop : liste verticale dans le panneau. ≤ 600 px : rangée horizontale défilable
  (`overflow-x: auto`, `scroll-snap`) au-dessus de l'attribution, pastilles 44 px de haut.
- `layers/select.ts` (pur, testé) : `orderedLayers(registry, manifest)`,
  `parseLayerParam(search, registry)` (absent ou inconnu → `temp`, `none` → null),
  `withLayerParam(search, id)` (ne touche que `layer`). `main.ts` applique
  `history.replaceState` au changement.
- Aucune préférence persistée : l'URL suffit.

## 13. Gestion d'erreurs

Pipeline :

| Cas | Comportement | Exit |
|---|---|---|
| GFS : aucun candidat téléchargeable | rien publié | 2 |
| GFS : décodage ou validation d'un champ (forme, NaN, plage, orientation) | rien publié, toutes couches | 3 |
| GEFS-chem : téléchargement, décodage ou validation en échec | avertissement, `pm25`/`dust` reportées depuis le manifeste courant, omises sinon | 0 |
| upload R2 en échec | manifeste ancien reste en place | 4 |
| manifeste courant illisible | idempotence ignorée ; report chem impossible | — |

Front :

| Cas | Comportement |
|---|---|
| manifeste illisible ou réseau | données courantes conservées, « Mise à jour impossible, nouvel essai dans 15 min » |
| `schema_version` ≠ 2, champ manquant | `MetadataError`, même traitement |
| PNG d'une couche en échec ou dimensions ≠ grille | bouton désactivé, retour à la couche précédente (ou Aucune), statut « Couche indisponible » |
| couche du paramètre d'URL absente du manifeste | repli `temp`, puis Aucune si `temp` absente |
| pixels CPU indisponibles | tooltip « — », rendu inchangé |

## 14. Tests

pytest (local sans GRIB, Actions avec) :

- registre : 7 entrées, ids uniques, `min < max`, sources existantes ;
- `candidates` avec `step_hours` 1 et 3 (arrondi de la cible, bornes, délais) ;
- `build_url` des deux sources (multi-variables, ordre stable) ;
- conversions (K→°C, Pa→hPa, kg/m²/s→mm/h, kg/m³→µg/m³, RH borné) ;
- `quantize` linéaire et racine, aller-retour avec la table de cas partagée avec Vitest ;
- `build_manifest` v2 et `build_legacy` v1 (champs, ordre, `stats`) ;
- `run` : report chem sur échec, omission sans manifeste courant, idempotence par
  source, ordre des uploads, exits 2/3/4 inchangés pour la primaire ;
- Actions seulement : `decode_fields` sur les deux fixtures (§9).

Vitest (logique pure) :

- `parseManifest` v2 (strict, couches partielles, rejet v1) ;
- `encode`/`decode` (table partagée), `buildLut` RGBA en racine, `legendGradientCss`
  avec `rgba()` et positions non uniformes ;
- `sampleValue` + `format` par couche, seuil `tooltipMin` ;
- `select.ts` : ordre, disponibilité, paramètre d'URL ;
- LRU (éviction, réactivation) ; `needsTextureFetch` par entrée ;
- `formatBanner` par source, `legendTicks` par couche.

À l'œil (DevTools MCP, rapport dans `.superpowers/sdd/…/validation-report.md`) :
chaque couche à trois altitudes, transparence pluie sur satellite et sur carte,
isobares au zoom Normandie, menu clavier, rangée de pastilles à 400 px, changement de
couche sans rechargement, console propre.

## 15. Critères d'acceptation

1. Les 7 couches s'affichent sur globelayers.com ; le tooltip donne la valeur avec son
   unité, à ±1 pas de quantification du recalcul depuis le PNG.
2. Pluie, PM2.5, poussière et nuages laissent voir satellite ou carte là où la valeur
   est sous le seuil de transparence.
3. Isobares tous les 4 hPa, lisses, sans crénelage visible au zoom Normandie.
4. `?layer=rain` ouvre sur la pluie ; changer de couche met l'URL à jour sans
   rechargement ; Aucune donne `layer=none`.
5. Un run avec GEFS-chem cassé (URL de filtre invalide en dry-run) produit les 5 PNG GFS
   et un manifeste où `pm25`/`dust` sont reportées (ou absentes sans manifeste courant).
6. Vitest et pytest verts, `history_check` ✓, `index-*.js` ≤ +15 Ko gzip par rapport à
   148,21 Ko.
7. 0 draw call au repos conservé ; changement de couche déjà chargée < 1 s sur desktop.
8. `gfs/latest.json` et `gfs/latest.png` restent publiés et valides (schema 1).

## 16. Hors périmètre

- Vent animé (lot B2) : registre et contrat prévus pour deux champs U/V, rien d'écrit.
- Étiquettes villes/pays (lot C).
- Empilement de couches, opacité réglable, nuages en surimpression d'une autre couche.
- Sélecteur d'échéance ou d'heure ; historique.
- CAMS, gaz (O₃, NO₂), stations (OpenAQ, WAQI).
- Retrait de `gfs/latest.*` (première tâche de la spec suivante).
- Renommage du dépôt, du bucket ou du package `worldtemp`.
- Dettes §8 de HISTORY autres que celles touchées en passant.
