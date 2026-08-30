# Spec — Pipeline GFS → texture température

**Date :** 2026-08-30 · **Statut :** validée en brainstorming, à planifier
**Périmètre :** sous-projet 1/2 (le globe Three.js fait l'objet d'une spec séparée).

## 1. Objectif

Produire toutes les heures, sans serveur ni PC allumé, une texture PNG en niveaux de
gris de la température à 2 m sur toute la Terre (grille GFS 0,25°), accompagnée d'un
`metadata.json`, et la déposer sur Cloudflare R2 où le site statique la lit.

Contraintes retenues (décisions du 2026-08-29, voir `HISTORY.md` §5) :

- exécution sur **GitHub Actions** (cron horaire, Linux) ;
- dépôt sur **Cloudflare R2**, rétention **dernière texture valide seulement** ;
- dev local dans un **venv Windows sans `eccodes`** : tout ce qui n'est pas le
  décodage GRIB doit être testable sur ce poste ;
- **le pipeline ne casse jamais le site** : sur toute défaillance, `latest.*` reste
  l'ancienne texture valide.

## 2. Architecture

Une seule frontière impure par nature d'effet ; tout le reste est pur et testé sur
numpy.

```
pipeline/
  __init__.py
  config.py         # constantes : MIN_C=-90, MAX_C=60, W=1440, H=721, URL NOMADS, chemins R2
  run_selection.py  # PUR   : candidates(now_utc) -> [(run_dt, forecast_hour), ...]
  nomads.py         # build_url(run, fh) [pur] + download(url) -> bytes [réseau]
  grib_adapter.py   # IMPUR : decode_grib(bytes) -> (ndarray K float32 (721,1440), lat, lon)
  texture.py        # PUR   : kelvin_to_celsius, reorient, quantize, encode_png
  metadata.py       # PUR   : build_metadata(...) -> dict
  publish.py        # write_atomic(path, bytes) + upload_r2(objects) [réseau]
  main.py           # orchestration, injection des effets, codes retour
  requirements.txt       # numpy, Pillow, requests, boto3   (Windows OK)
  requirements-grib.txt  # cfgrib, eccodeslib, xarray       (Actions seulement)
```

Flux :

```
NOMADS filter_gfs_0p25_1hr.pl ──download──> bytes GRIB2
  ──decode_grib──> ndarray K, lat 90→-90, lon 0→359.75
  ──K→°C──> ──roll 720 colonnes──> lon -180→180
  ──quantize 8 bits──> uint8 ──encode_png──> latest.png
  + build_metadata ──> latest.json
  ──write_atomic (local) ──upload_r2──> gfs/latest.png puis gfs/latest.json
```

Règles de frontière :

- `grib_adapter.py` est le **seul** module dépendant de `cfgrib`/`eccodes`. Il importe
  cfgrib **dans la fonction**, pas en tête de module, et retourne du numpy nu : ni
  `xarray.Dataset` ni objet cfgrib ne sort de ce module.
- `main.run(now, download, decode, upload)` reçoit les trois effets comme callables.
  Les tests d'orchestration injectent des fonctions factices ; aucun `monkeypatch`.
- `config.py` est la source de vérité de l'encodage côté Python. Le front ne recopie
  aucune constante : il lit `encoding` dans `latest.json` (§4).

## 3. Sélection du run et de l'échéance

GFS tourne 4 fois par jour (00/06/12/18 UTC). Un run R apparaît sur NOMADS environ
3 h 30 après R. On publie la **prévision valide à l'heure courante** (et non
l'analyse `f000` du dernier run) : `valid_time` ≈ maintenant, mise à jour visible
toutes les heures, précision T2m à +3…+9 h de l'ordre du degré.

Algorithme pur `candidates(now_utc)` :

```
target = now_utc tronqué à l'heure
runs   = les 4 runs synoptiques ≤ target - 3h30, du plus récent au plus ancien
pour chaque run : fh = (target - run) en heures ; garder si 0 ≤ fh ≤ 48
```

Exemple : `now = 14:20Z` → `target = 14:00Z` → `[(06z, f008), (00z, f014),
(18z J-1, f020), (12z J-1, f026)]`. Le run 12z n'est pas listé (12:00 + 3h30 >
14:00) ; s'il l'était par erreur, un 404 le ferait sauter.

Le délai de 3 h 30 est un ordre de grandeur, pas une mesure : les 404 couvrent une
erreur dans les deux sens. À affiner sur les logs Actions.

URL construite (`nomads.build_url`) :

```
https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25_1hr.pl
  ?dir=/gfs.YYYYMMDD/HH/atmos
  &file=gfs.tHHz.pgrb2.0p25.fFFF
  &var_TMP=on&lev_2_m_above_ground=on
```

Pas de `subregion` : grille mondiale complète (~516 Ko).

Orchestration : les candidats sont essayés dans l'ordre. `404` → suivant.
`5xx`/timeout (60 s)/erreur de connexion → un retry après 30 s, puis suivant.
Liste épuisée → exit 2, rien publié.

Idempotence : avant tout téléchargement, `GET` du `latest.json` public sur R2. Si son
`(run, forecast_hour)` égale le premier candidat → exit 0 sans rien faire. 404 ou
erreur réseau sur ce GET → on continue (première publication, ou R2 indisponible).
Pas de cache disque : le runner Actions est éphémère.

« Implémentation : lecture via `get_object` S3 avec les mêmes secrets (pas d'URL
publique, pas de 5ᵉ secret) — écart assumé, voir HISTORY §5. »

## 4. Contrat de données

C'est la frontière avec la spec globe. Figé ici ; toute modification incrémente
`schema_version`.

### `gfs/latest.png`

- 1440 × 721, PNG 8 bits niveaux de gris (mode Pillow `L`), sans alpha ni palette.
- Équirectangulaire : x = longitude de **-180° (gauche) à +180° (droite)**, y =
  latitude de **+90° (haut) à -90° (bas)**. Pixel (0, 0) = lon -180, lat +90.
  « Colonne x ↔ lon = -180 + 0,25·x (dernière colonne 179,75 ; **pas de colonne
  de bouclage**, le front utilise `RepeatWrapping` en u). Ligne y ↔ lat =
  90 − 0,25·y (pôles inclus). Échantillonner la longitude λ et la latitude φ au
  centre du pixel : `u = (λ + 180) / 360 + 1 / 2880`,
  `v_haut = ((90 − φ) · 4 + 0,5) / 721` (Three.js : `v = 1 − v_haut`). »
- Depuis la grille GFS (lon 0→359.75, lat 90→-90) : `np.roll` de 720 colonnes sur
  l'axe des longitudes, **pas de flip latitude** (vérifié par le test adaptateur
  `lat[0] == 90`).
- Encodage : `pixel = round((T_c - MIN_C) / (MAX_C - MIN_C) * 255)` clippé à
  [0, 255], `MIN_C = -90`, `MAX_C = 60` → 0,59 °C par niveau.
  Décodage : `T_c = MIN_C + pixel / 255 * (MAX_C - MIN_C)`.
- Aucune valeur manquante admise : TMP 2 m est défini partout. Un NaN dans le
  ndarray fait échouer le pipeline (exit 3), jamais de remplissage.
- Poids attendu 300–500 Ko. Compression PNG sans perte uniquement : la valeur du
  pixel est la donnée.

### `gfs/latest.json`

```json
{
  "schema_version": 1,
  "model": "gfs_0p25",
  "variable": "TMP_2m",
  "run": "2026-08-30T06:00:00Z",
  "forecast_hour": 8,
  "valid_time_utc": "2026-08-30T14:00:00Z",
  "generated_at": "2026-08-30T14:07:42Z",
  "encoding": { "bits": 8, "min_c": -90, "max_c": 60 },
  "grid": { "width": 1440, "height": 721,
            "lon_min": -180, "lon_max": 179.75, "lat_min": -90, "lat_max": 90,
            "lon_step": 0.25, "lat_step": 0.25 },
  "texture": "latest.png",
  "stats": { "min_c": -71.3, "max_c": 48.9 }
}
```

- `schema_version` : le front refuse une version inconnue.
- `encoding` et `grid` : le front les lit au chargement et les passe en uniforms.
  Conséquence : la dette « encodage dupliqué en trois endroits » (HISTORY §8 n° 3)
  est résolue par construction — une seule source, ce JSON. Le GLSL ne porte plus
  de constante de plage.
- `stats` : min/max réels en °C (arrondis 0,1), pour la légende et le contrôle de
  vraisemblance (§6).
- `valid_time_utc = run + forecast_hour`. Dates ISO 8601 UTC, suffixe `Z`,
  secondes présentes.

### Publication

- Objets R2 : `gfs/latest.png`, `gfs/latest.json` (préfixe `gfs/` réservé à cette
  couche ; d'autres couches auront le leur).
- Ordre strict : **PNG d'abord, JSON ensuite**. Le front lit le JSON puis le PNG
  qu'il nomme ; la seule fenêtre d'incohérence est « PNG neuf + JSON ancien »,
  invisible car même nom et même contrat.
- En-têtes : `Content-Type: image/png` / `application/json`,
  `Cache-Control: public, max-age=300`. Le front fait du cache-busting
  `?v=<generated_at>` sur le PNG ; il lui faut un JSON frais, d'où le max-age court.
- Écriture locale atomique avant upload : fichier temporaire puis `os.replace`.
  Sortie locale dans `out/` (gitignoré) — c'est ce que le run local et l'artefact
  Actions exposent.

## 5. GitHub Actions et Cloudflare R2

### `.github/workflows/pipeline.yml`

- Déclencheurs : `schedule: '12 * * * *'` (minute 12 : les crons à l'heure pile sont
  retardés ou sautés sous charge) et `workflow_dispatch` avec input booléen
  `dry_run`.
- Un job, `ubuntu-latest`, `timeout-minutes: 10`, `concurrency: { group: pipeline,
  cancel-in-progress: false }`.
- Étapes : checkout → `setup-python` 3.12 avec cache pip → install des deux
  `requirements` → `python -m pipeline.main` → `upload-artifact` de `out/`
  (rétention 3 jours, `if: always()`).
- Secrets : `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
  Lus par `publish.py` via variables d'environnement ; si l'un manque, le run est
  en **dry-run implicite** : génère `out/`, n'uploade rien, exit 0. Sur le poste
  de dev, le run s'arrête de toute façon au décodage (pas de `cfgrib`, exit 3) :
  le dry-run utile est celui de `test.yml`, dont l'artefact `out/` se télécharge.
- Client R2 : `boto3` sur l'endpoint S3 `https://<account_id>.r2.cloudflarestorage.com`,
  région `auto`. Aucun SDK Cloudflare.
- Le repo est **public** (passé le 2026-08-30) : minutes Actions illimitées. En privé,
  24 runs/jour × ~2 min ≈ 1 500 min/mois auraient frôlé le quota gratuit de 2 000.

### `.github/workflows/test.yml`

Sur `push` et `pull_request` : installe les deux `requirements`, lance `pytest`
(niveaux 1 et 2, §7), `python tools/history_check.py`, puis
`python -m pipeline.main --dry-run` contre NOMADS réel et publie `out/` en artefact.
Résout la dette HISTORY §8 n° 5 (pas de CI).

### Mise en place R2 — une fois, à la main

1. Dashboard Cloudflare → R2 → activer (carte bancaire demandée ; plan gratuit :
   10 Go stockés, 10 M lectures/mois — le projet en consommera une fraction).
2. Créer le bucket `worldtemp` (localisation automatique).
3. Activer l'accès public via sous-domaine `r2.dev` (domaine personnalisé plus tard).
4. CORS du bucket : origines = URL Pages du site + `http://localhost:5173` ;
   méthodes `GET, HEAD` ; en-têtes autorisés `*`.
5. Créer un API token R2, permission « Object Read & Write », restreint au bucket
   → Access Key ID + Secret Access Key.
6. Poser les 4 secrets dans le repo GitHub (Settings → Secrets → Actions).
7. Lancer `pipeline.yml` en `workflow_dispatch`, vérifier
   `https://<hash>.r2.dev/gfs/latest.json` puis `latest.png`.

## 6. Gestion d'erreurs

Règle : **le pipeline échoue bruyamment ou publie une texture valide, jamais entre
les deux.** R2 n'est touché qu'en toute fin, après toutes les validations.

| Étape | Défaillance | Réaction |
|---|---|---|
| `GET latest.json` (idempotence) | 404, réseau | ignorer, continuer |
| Téléchargement NOMADS | 404 | candidat suivant |
| | 5xx, timeout 60 s, connexion | 1 retry après 30 s, puis candidat suivant |
| | candidats épuisés | **exit 2**, journal des tentatives |
| Décodage GRIB | exception cfgrib, variable absente, forme ≠ (721, 1440) | **exit 3** — pas de candidat suivant : c'est un bug ou un changement de format, pas une indisponibilité |
| Validation ndarray | NaN ; min < 180 K ; max > 340 K ; `lat[0] != 90` ; `lon[0] != 0` | **exit 3** |
| Écriture locale | erreur disque | exception brute, exit 1 |
| Upload PNG | échec | **exit 4**, JSON non envoyé → R2 reste sur l'ancien couple |
| Upload JSON (PNG déjà envoyé) | échec | **exit 4** ; R2 = PNG neuf + JSON ancien, invisible côté front ; le run suivant répare |

Codes retour : `0` succès ou no-op idempotent · `2` source indisponible · `3` données
invalides · `4` publication. Distincts pour lire le tableau de bord Actions d'un
coup d'œil.

Journal : `logging` stdlib sur stdout, une ligne par étape (run, fh, durée, taille,
statut HTTP). Pas de fichier de log ; Actions conserve 90 jours.

Alerte : le mail GitHub au propriétaire sur échec de workflow planifié suffit. Pas de
webhook.

Non-objectifs explicites : pas de repli vers un run plus ancien sur échec de
décodage (masquerait un bug) ; pas de retry global du job ; pas de publication
partielle.

Point de vigilance : GitHub **désactive les workflows planifiés après 60 jours sans
commit** sur le dépôt. À consigner en dette ; un `workflow_dispatch` ou un commit
le réactive.

## 7. Tests

Outil : `pytest`. Les tests existants en `unittest` (`tests/test_history_check.py`)
restent tels quels, pytest les collecte.

### Niveau 1 — unitaires purs (venv Windows) : `pytest tests/pipeline`

| Module | Cas |
|---|---|
| `run_selection` | 14:20Z → les 4 candidats de §3 ; 03:00Z → 00z absent, 18z J-1 en tête ; passage de minuit ; fh borné à 48 ; `now` non aligné à l'heure |
| `nomads.build_url` | URL exacte pour `(06z, f008)` ; zéro-padding de `fFFF` ; pas de `subregion` |
| `texture` | K→°C ; roll : la colonne lon 0 arrive en x = 720 ; -90 °C → 0, +60 → 255, 15 → 178 ; clipping hors plage ; NaN → `ValueError` ; PNG réouvert : mode `L`, taille (1440, 721), pixels identiques |
| `metadata` | conforme à §4 ; `valid_time = run + fh` ; suffixe `Z` ; `stats` corrects |
| `main.run` (effets injectés) | 404 → 2e candidat ; 5xx → retry puis suivant ; épuisé → exit 2 ; NaN → exit 3 et `upload` jamais appelé ; échec upload PNG → JSON jamais envoyé, exit 4 ; idempotence → exit 0 sans `download` ; ordre PNG puis JSON |

### Niveau 2 — adaptateur GRIB (Actions seulement)

`tests/pipeline/test_grib_adapter.py` commence par `pytest.importorskip("cfgrib")`
→ skip propre sur Windows. Fixture : un GRIB2 réel (TMP 2 m, un pas, ~516 Ko)
commité une fois dans `tests/fixtures/`. Vérifie forme (721, 1440), `float32`,
`lat[0] == 90`, `lon[0] == 0`, plage K plausible.

### Niveau 3 — bout en bout (`test.yml`)

`python -m pipeline.main --dry-run` contre NOMADS réel, artefact `out/` à ouvrir.
Pas de mock NOMADS : c'est l'endpoint qu'on veut surveiller (leçon HISTORY §6).

### Non testés unitairement

`publish.upload_r2` : wrapper de quelques lignes sur `boto3`, couvert par le
niveau 3 et le run planifié.

## 8. Critères d'acceptation

1. `pytest` vert sur le venv Windows, tests GRIB marqués `skipped`.
2. `test.yml` vert sur Actions, tests GRIB exécutés.
3. L'artefact `out/` du dry-run de `test.yml` (sans secret R2) contient un
   `latest.png` où les continents sont reconnaissables et un `latest.json`
   conforme à §4.
4. Après mise en place R2 et un `workflow_dispatch` : `latest.json` public, `run`
   et `forecast_hour` cohérents avec l'heure, `valid_time_utc` ≤ 1 h de l'heure
   courante.
5. Deux exécutions consécutives dans la même heure : la seconde se termine en exit
   0 sans télécharger (journal : « déjà publié »).
6. Un run planifié échoué (simulable par un secret R2 invalide) laisse `latest.*`
   intact sur R2.

## 9. Hors périmètre

- Historique des textures, curseur temporel (rétention `latest` seule).
- Autres variables ou niveaux GFS.
- Domaine personnalisé R2, invalidation CDN.
- Le globe Three.js et sa lecture du contrat : spec 2.
