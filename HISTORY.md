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
| Pipeline de données | Python (**3.12 sur Actions**, venv local **3.14**) | `xarray`, `cfgrib` (exige `eccodes`), `numpy`, `Pillow`, `requests`, `boto3` (client S3 pour R2, §5) |
| Dépendances pipeline | `pipeline/requirements.txt` (numpy, Pillow, requests, boto3 — installe sur **Windows**) vs `pipeline/requirements-grib.txt` (`cfgrib`, `eccodeslib`, `xarray` — **Actions seulement**, pas de roue Windows) | split par l'approche A (§5) ; variable cfgrib de `TMP` à 2 m confirmée `t2m` sur Actions (`pipeline/grib_adapter.py`) |
| Source de données | NOMADS / GFS 0,25° (NOAA) | script de filtrage `filter_gfs_0p25_1hr.pl`, variable `TMP` à 2 m, run+échéance à l'heure courante (§5) |
| Frontend | Vite 8, TypeScript 5.9, Three.js 0.185, Vitest 4, Wrangler 4, Node 24 (Actions et local) | vanilla, shaders GLSL custom, pas de framework lourd ; `web/` livré le 2026-09-02 (branche `feat/globe-heatmap`, §3) |
| Sortie | Fichiers statiques (PNG + JSON) | **aucun serveur applicatif** ; `latest.json` porte aussi `encoding` et `grid` (§5) |
| Hébergement | **GitHub Actions** (cron horaire, Linux) → **Cloudflare R2** (textures) + **Cloudflare Workers Static Assets** (site) | tranché le 2026-08-29 (§5) ; **R2 en service depuis le 2026-09-02** : bucket `worldtemp` (WEUR), URL publique `https://pub-97483d42990244b3b19ae530da791d26.r2.dev/gfs/latest.{png,json}` ; **Workers Static Assets remplace Cloudflare Pages** (2026-09-02, §5) : Cloudflare recommande Workers pour tout nouveau projet depuis 2026, Pages est gelé ; déploiement par le job `deploy` de `.github/workflows/test.yml`, sur push `master` uniquement, après `test` et `web` verts ; URL `https://worldtemp.<sous-domaine>.workers.dev` (à compléter après le premier déploiement) ; `eccodeslib` s'installe en pip sur Linux, pas sur Windows ; repo passé **public** le 2026-08-30 (§5) |
| CI | `.github/workflows/test.yml` : job `test` (push/PR : pytest + `history_check` + dry-run NOMADS réel), job `web` (npm ci, typecheck, vitest, build, upload `web-dist`), job `deploy` (`wrangler deploy`, seulement sur push `master`, après `test`+`web`) ; `pipeline.yml` (cron horaire + `workflow_dispatch`) | `pytest` en plus d'`unittest` (les tests `unittest` existants restent collectés) ; jobs `web`/`deploy` ajoutés le 2026-09-02 |
| Outillage dépôt | Python stdlib seule | `tools/history_check.py`, tests `unittest` |

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
    plans/2026-08-30-pipeline-gfs.md          # plan d'exécution (12 tâches)
pipeline/
  config.py                    # constantes : encodage, grille, sélection du run, R2
  run_selection.py             # run + échéance valides à l'heure courante
  nomads.py                    # URL du filtre NOMADS, téléchargement, retry sur 429
  grib_adapter.py              # seul module dépendant de cfgrib/eccodes
  texture.py                   # validation, réorientation, quantification 8 bits → PNG
  metadata.py                  # métadonnées de sortie (schéma v1 : encoding, grid, valid_time…)
  publish.py                   # écriture atomique + publication R2 ordonnée
  main.py                      # orchestration, ligne de commande, codes retour
  requirements.txt             # Windows OK : numpy, Pillow, requests, boto3
  requirements-grib.txt        # Actions seulement : cfgrib, eccodeslib, xarray
tools/
  history_check.py             # contrôle mécanique de HISTORY.md contre le dépôt
  prepare_bluemarble.py        # télécharge/redimensionne la texture Blue Marble NASA (source, licence)
tests/
  test_history_check.py        # 30 tests unittest de la logique du contrôle
  fixtures/gfs_tmp2m.grib2     # fixture GRIB réelle (~514 Ko), exception au .gitignore
  pipeline/                    # tests pytest des modules ci-dessus (1 fichier par module)
.github/workflows/
  test.yml                     # jobs test (pytest+history_check+dry-run), web (npm/vitest/build), deploy (wrangler, master)
  pipeline.yml                 # cron horaire (minute 12) + workflow_dispatch
pytest.ini                     # testpaths = tests
HISTORY.md                     # ce document
.gitattributes                 # LF partout, quelle que soit la config git locale
.gitignore
web/                          # frontend (branche feat/globe-heatmap, 2026-09-02) : web/src/, web/tests/, web/public/
  index.html                   # squelette DOM : canvas, overlay (bandeau/statut/légende/slider), #fatal
  package.json                 # scripts (dev/build/test/typecheck/deploy), deps three/vite/vitest/wrangler
  package-lock.json
  tsconfig.json                # strict, noUncheckedIndexedAccess, cible ES2022/bundler
  vite.config.ts                # config Vitest (fichiers de tests sous web/tests/)
  wrangler.jsonc                # Worker sans script, assets statiques = ./dist (Workers Static Assets)
  public/
    _headers                   # cache : /assets immutable 1 an, /textures 1 jour, / et /index.html no-cache
    textures/blue-marble-4k.jpg  # texture couleur NASA Blue Marble, domaine public
  src/
    main.ts                    # bootstrap : scène, globe, DataLoader, tier GPU, branchement overlay
    config.ts                  # DATA_BASE_URL, REFRESH_MS (15 min), STALE_AFTER_MS (6 h)
    style.css                  # mise en page overlay (grille 4 lignes en mobile, panneaux)
    data/
      metadata.ts               # parseMetadata : contrat des métadonnées publiées par le pipeline (encoding, grid, valid_time…)
      sampling.ts                # heatmapUv : formules d'échantillonnage lat/lon → UV (miroir du GLSL)
      loader.ts                  # DataLoader : fetch + cache-busting + refresh 15 min, non réentrant
    gpu/
      tier.ts                    # detectTier : faisceau d'indices (renderer, cœurs, UA, pixel ratio, ?tier=)
    render/
      scene.ts                   # THREE.Scene/Camera/Renderer/OrbitControls, rendu à la demande
      globe.ts                   # sphère + ShaderMaterial (segments par tier), setHeatmap/setLut/setOpacity
      colormap.ts                # arrêts de couleur, LUT 256×1 sRGB, dégradé CSS de la légende
      shaders/globe.vert.glsl    # vertex shader (position, UV, normale vers le fragment)
      shaders/globe.frag.glsl    # fragment shader : texture couleur + heatmap + LUT, éclairage simplifié
    ui/
      format.ts                  # formatBanner, legendTicks : mise en forme texte/heure/graduations
      overlay.ts                 # createOverlay : bandeau, statut, légende, repliage mobile
  tests/
    fixtures.ts                  # SAMPLE : métadonnées de test (même contrat que le pipeline), réutilisées par plusieurs suites
    metadata.test.ts
    sampling.test.ts
    colormap.test.ts
    tier.test.ts
    loader.test.ts
    format.test.ts
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

## 7. Historique par plan (chronologie)

| Date | Plan / branche | Statut | Merge | Tests |
|---|---|---|---|---|
| 2026-08-30 | feat/pipeline-gfs — pipeline GFS → texture (spec + plan superpowers) | ✅ mergé | `aa29c6f` | 94 local / 95 Actions |
| 2026-09-02 | feat/globe-heatmap — spec 2 globe + heatmap (spec + plan superpowers) | 🟡 livré, merge à venir | merge : à compléter | 59 vitest + 94 pytest local (1 skipped) / 95 pytest Actions |

## 8. Dette technique connue

| # | Dette | Impact | Statut |
|---|---|---|---|
| 1 | ~~Cible d'hébergement non tranchée~~ | — | ✅ résolu 2026-08-29 : GitHub Actions + Cloudflare R2/Pages (§5) ; R2 mis en service le 2026-09-02 (dette n° 7) |
| 2 | **`cfgrib` exige `eccodes`, sans roue Windows** (`eccodeslib` : Linux/macOS seulement) | `decode_grib` (`pipeline/grib_adapter.py`) ne tourne pas sur le PC de dev, skip local (`skipUnless`) | 🟡 contenu par l'approche A (§5) : `decode_grib` testé **réellement** sur Actions contre la fixture commitée `tests/fixtures/gfs_tmp2m.grib2` (test vert, pas un mock) — seul le poste Windows reste aveugle |
| 3 | ~~Encodage température dupliqué en trois endroits~~ (Python, GLSL, JS) sans garde mécanique | — | ✅ résolu par construction le 2026-08-30 (pipeline) et **honorée côté front le 2026-09-02** : `web/src/data/metadata.ts` lit `encoding`/`grid` depuis les métadonnées publiées, aucune constante recopiée |
| 4 | **Aucune source de heightmap fixée** — ETOPO 2022 ou heightmap NASA prête à l'emploi | Bloque la Phase 4 ; le choix conditionne le script de préparation et la profondeur de bits | 🔴 ouvert |
| 5 | ~~Pas de CI~~ : les tests ne tournaient qu'à la main | — | ✅ résolu 2026-08-30 : `.github/workflows/test.yml` exécute pytest + `history_check` + un dry-run NOMADS réel sur chaque push/PR |
| 6 | **GitHub désactive les workflows planifiés (`schedule`) après 60 jours sans commit** sur le dépôt | `pipeline.yml` s'arrêterait silencieusement si le dépôt reste inactif deux mois | 🔴 ouvert ; se réveille via un `workflow_dispatch` manuel ou un simple commit — à surveiller si le projet marque une pause |
| 7 | ~~R2 non activé~~ | — | ✅ résolu 2026-09-02 : bucket `worldtemp`, `r2.dev`, CORS, token, 4 secrets GitHub posés ; **`pipeline.yml` réactivé** (`gh workflow enable`), premier run réel publié (§9) |
| 8 | **`actions/checkout@v4`, `actions/setup-python@v5`, `actions/upload-artifact@v4`** tournent sur Node 20, déprécié côté GitHub Actions | Migration future vers les majeures suivantes à prévoir (pas encore annoncée comme bloquante) | 🟡 à surveiller |
| 9 | **Critère 6 de la spec (secret R2 invalide → run rouge exit 4, `latest.*` intact) non testé de bout en bout** : le Secret Access Key n'a pas été conservé côté utilisateur, le casser aurait imposé de recréer le token | Le chemin est couvert par les tests unitaires de `publish.py` (exit 4) mais pas vérifié contre R2 réel | 🟡 ouvert — à faire à la prochaine rotation du token : poser une valeur fausse, `gh workflow run`, vérifier, remettre la vraie |
| 10 | **Le job `deploy` de `test.yml` reconstruit le frontend** (`npm ci` + `npm run build`) au lieu de réutiliser l'artefact `web-dist` déjà produit par le job `web` | Double build à chaque déploiement ; quelques dizaines de secondes de CI perdues, pas de risque fonctionnel | 🟡 mineur, ouvert |
| 11 | **Aucun test unitaire sur `web/src/ui/overlay.ts`** : ni le repli/dépli de l'overlay, ni l'affichage du statut d'échec de rafraîchissement (`refresh()` qui échoue) ne sont couverts par Vitest, seulement validés à l'œil | Une régression sur ces deux comportements ne casserait aucun test | 🟡 ouvert |
| 12 | **`ImageBitmap` de la heatmap remplacée non fermé explicitement (`.close()`)** lors d'un rafraîchissement | Repose sur le ramasse-miettes du navigateur ; sans conséquence pratique vu la cadence de rafraîchissement (15 min) mais consomme de la mémoire GPU/CPU inutilement entre deux passages du GC | 🟡 mineur, ouvert |
| 13 | **`navigator.hardwareConcurrency === 0` traité comme « aucun signal »** dans `web/src/gpu/tier.ts`, alors que la spec écrit littéralement « ≤ 4 → tier low » | Cas surtout théorique (peu de navigateurs renvoient 0 plutôt que `undefined`) ; un appareil qui renverrait 0 recevrait le tier `high` au lieu de `low` par ce seul critère | 🟡 théorique, ouvert |

## 9. État actuel & prochaine action

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

**Dernière mise à jour :** 2026-09-02 (**globe + heatmap livrés** — branche `feat/globe-heatmap`, 10 tâches subagent-driven + revues, 59 vitest + 94 pytest local/1 skipped, Workers Static Assets remplace Pages, merge et déploiement à venir, dette n° 3 honorée côté front, dettes n° 10 à 13 ouvertes)
**Entrée précédente :** 2026-09-02 (**R2 en service, premier run réel publié** — Task 12 : bucket `worldtemp` + `r2.dev` + CORS par MCP Cloudflare, token et secrets par l'utilisateur, `pipeline.yml` réactivé, critères 4 et 5 ✅, critère 6 reporté en dette n° 9, prochaine étape spec 2 globe)
**Entrée précédente :** 2026-08-30 (**pipeline GFS implémenté et mergé** — merge `aa29c6f`, 11 tâches subagent-driven + revue finale, 94 passed/1 skipped local, 95 sur Actions, dettes n° 3 et n° 5 résolues, R2 non activé, **cron `pipeline.yml` désactivé en attendant la Task 12**)
**Entrée précédente :** 2026-08-29 (**dépôt GitHub + brainstorming pipeline** — remote `Haddepe/worldtemp`, hébergement tranché GH Actions → Cloudflare R2/Pages, approche A validée, OpenDAP NOMADS constaté retiré, aucun code applicatif)
**Entrée précédente :** 2026-08-29 (**amorçage du dépôt** — `git init`, plan déplacé en `docs/PLAN.md`, skill `updating-history` + `tools/history_check.py` installés, 30 tests verts, aucun code applicatif)
