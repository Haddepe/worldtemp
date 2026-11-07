# Lot R5c — zoom forêt profond : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sous Forest, zoomer partout jusqu'aux tuiles de niveau 9 (≈ 76 m) plus un cran de sur-zoom, avec les niveaux manquants hébergés gratuitement sur Hugging Face, R2 inchangé hormis le manifeste.

**Architecture:** Le tiler existant produit la pyramide jusqu'au niveau 9 ; les tuiles « profondes » (niveau 9 partout, niveau 8 hors bande tropicale) sont regroupées en archives `WTPK` d'une cellule de 10° × 10°, lues par Range depuis Hugging Face. Le manifeste forêt de R2 gagne un champ optionnel `deep` (ignoré des anciens clients). Le front choisit la tuile la plus fine disponible (R2 ou archive), le globe se subdivise jusqu'au niveau 9 sous Forest, la caméra descend plus bas sous Forest et remonte en vol quand on la quitte.

**Tech Stack:** Python 3 (numpy, Pillow, GDAL déjà utilisés par `tiler/`), `huggingface_hub` (nouvelle dépendance du workflow seulement), GitHub Actions, TypeScript + Three.js, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-07-forest-deep-zoom-design.md` (s'appuie sur `docs/superpowers/specs/2026-10-31-forest-design.md`).

## Global Constraints

- **Zéro dépense** : ni R2 au-delà de 10 Go, ni offre payante d'un hébergeur.
- R2 : **aucun nouvel objet** ; seul `tiles/forest/v1.12/manifest.json` est réécrit en place ; occupation ≈ 8,52 Go inchangée.
- Hugging Face : offre gratuite, dépôt dataset **public**, moins de 100 000 fichiers ; envoi **avec l'accord de l'utilisateur** seulement.
- Donnée : Hansen **v1.12** (pas v1.13), seuil 30 %, mêmes canaux (couvert / année / part), même règle d'agrégation que R5b.
- Profondeur : niveau forêt max **9 en profil `high`, 8 en `low`** ; sur-zoom d'un cran : `FOREST_MIN_DISTANCE = 1 + (MIN_DISTANCE − 1) / 4` (= 1,0105).
- Génération uniquement sur Actions (RAM du poste 1–2 Go) ; disque d'un runner ≈ 14 Go.
- Bundle : plafond actuel **195,28 Ko gzip** ; relèvement chiffré et justifié dans HISTORY §5.
- Commits, code interne et HISTORY en français ; site en anglais ; HISTORY avant push (CI `history_check`).
- Validation navigateur sous Brave, avec l'accord de l'utilisateur (RAM).
- Branche `feat/forest-deep` ; un workflow `workflow_dispatch` nouveau doit exister sur `master` pour être lancé (leçon R5b) : le reporter seul sur `master` avec l'accord de l'utilisateur.

## Format `WTPK` et cellules (décisions partagées par les tâches 3 et 5)

- **Tuiles profondes** : `z == 9`, ou `z == 8` et tuile **hors** de la bande tropicale (règle de `forestTileFor` : centre de la tuile dans `manifest.tropics`).
- **Cellule d'une tuile** : centre `lon = -180 + (x + 0.5)·s`, `lat = 90 - (y + 0.5)·s` avec `s = 180 / 2^z` ; `cx = floor((lon + 180) / 10)` (0..35), `cy = floor((90 - lat) / 10)` (0..17) ; nom `"{cx}_{cy}"`. Les boîtes de 90° sont alignées : une cellule ne relève que d'une boîte.
- **Archive** `v1.12/{cx}_{cy}.wtpk`, little-endian :
  - en-tête 16 octets : `b"WTPK"`, `u8 version = 1`, 3 octets nuls, `u32 count`, `u32` nul ;
  - `count` enregistrements de 16 octets triés par `(z, x, y)` : `u8 z`, `u8` nul, `u16 x`, `u16 y`, `u16` nul, `u32 offset` (absolu dans le fichier), `u32 length` ;
  - puis les PNG concaténés dans l'ordre des enregistrements.
  - Longueur du répertoire = `16 + 16·count` (lisible sans requête préalable grâce au catalogue).
- **Catalogue** `v1.12/catalog.json` : `{"format": "wtpk1", "cells": {"12_8": {"count": 812, "bytes": 123456789}, …}}` ; cellule absente = aucune tuile profonde.
- **Champ `deep` du manifeste forêt** (optionnel, `schema_version` reste 1) :
  `{"base_url": "https://huggingface.co/datasets/<owner>/<repo>/resolve/<sha>/v1.12", "max_level": 9, "catalog": "catalog.json", "format": "wtpk1"}`.

## Review Focus

1. **Répertoire de cellule pas encore chargé** : la vue doit afficher l'ancêtre R2 (niveau 8 ou 7) sans trou ni requête 404, puis passer au niveau profond au chargement du répertoire → test Task 5 « pending ⇒ tuile R2 ».
2. **Hugging Face injoignable ou 429** : la couche reste utilisable aux niveaux R2, une cellule en échec n'est pas redemandée en boucle → test Task 5 « échec du répertoire ⇒ refroidissement, tuile R2 ».
3. **Utilisateur qui reprend la main pendant la remontée** (glisser, molette) : la distance minimale normale doit quand même s'appliquer → test Task 6 « vol annulé ⇒ limite normale posée ».
4. **URL partagée en zoom profond ouverte sous une autre couche** (`?layer=temperature&d=1.0105`) : altitude bornée à la limite normale, sans vol → test Task 6.
5. **Tuile profonde vide alors que l'ancêtre R2 existe** (bord de forêt) : rien n'est dessiné à ce niveau pour cette tuile (comme R5b quand l'index est vide), pas de fausse forêt étirée → test Task 5 « absent ⇒ null ».

---

### Task 1 : Essai Hugging Face sur un vrai gros fichier (point d'arrêt)

**But :** vérifier Range + CORS **après la redirection** sur un fichier stocké en Xet/LFS avant tout code. Tâche d'exploitation, guidée avec l'utilisateur ; aucun code produit à garder.

**Files:**
- Create: `.github/workflows/hf-spike.yml` (jetable, supprimé à la Task 7)

- [ ] **Step 1 :** guider l'utilisateur : créer un compte Hugging Face gratuit, un dépôt **dataset public** (nom à confirmer avec lui, proposé `globelayers-forest`), un jeton *write* limité à ce dépôt ; il le pose en secret GitHub `HF_TOKEN` et donne le nom `<owner>/<repo>` (variable de dépôt `HF_REPO`).
- [ ] **Step 2 :** écrire `hf-spike.yml` (`workflow_dispatch`) : télécharge `Hansen_GFC-2024-v1.12_treecover2000_10S_060W.tif` (≈ 376 Mo) et l'envoie par `huggingface_hub.HfApi().upload_file(path_in_repo="spike/big.tif", repo_type="dataset")` ; secret passé par `env:`. Le reporter seul sur `master` (accord utilisateur), le lancer.
- [ ] **Step 3 :** depuis le poste, mesurer :
  `curl -s -o /dev/null -D - -r 1000000-1065535 -H "Origin: https://globelayers.com" -L "https://huggingface.co/datasets/$HF_REPO/resolve/main/spike/big.tif"`
  Attendu : réponse finale `206`, `Content-Range` présent, `Access-Control-Allow-Origin` = origine ou `*` sur **la réponse finale**, `Access-Control-Expose-Headers` contenant `Content-Range` ou `Content-Length`. Relever : temps total (5 essais), en-têtes `RateLimit*`, hôte final de la redirection et durée de validité de son URL signée.
- [ ] **Step 4 :** avec l'accord de l'utilisateur, même lecture par `fetch(url, {headers: {Range: "bytes=1000000-1065535"}})` dans la console de Brave sur `https://globelayers.com` : statut 206, 65 536 octets.
- [ ] **Step 5 : Décision.** Tout est conforme → continuer. Sinon **s'arrêter**, rapport BLOCKED avec les mesures ; le contrôleur présente le plan B à l'utilisateur (proxy Worker gratuit devant Hugging Face, ou tuiles Global Forest Watch). Consigner les mesures dans le ledger.

### Task 2 : Dettes n° 72 du workflow et du tiler forêt

**Files:**
- Modify: `.github/workflows/forest-tiles.yml`, `tiler/hansen.py`, `tiler/main.py`
- Test: `tests/test_hansen.py`, `tests/test_forest_build.py`

- [ ] **Step 1 : Tests en échec** : `test_read_block_two_blocks_tile_marked_missing_then_fallback` (R7 : dalle absente au premier bloc, repli `lossyear` au second, même résultat qu'un repli direct) ; `test_unicode_error_becomes_hansen_read_error` (liste de dalles non UTF-8 → `HansenReadError`) ; `test_aggregate_without_copy` reçoit une vraie assertion (`np.shares_memory` faux pour la sortie, ou l'assertion que le test visait) ; tests des `ValueError` des arguments invalides de `build_forest_box`.
- [ ] **Step 2 :** `pytest tests/test_hansen.py tests/test_forest_build.py -v` → FAIL sur les nouveaux tests.
- [ ] **Step 3 :** corriger : `UnicodeDecodeError` → `HansenReadError` ; retirer la boucle morte `only_loss` de `read_block` ; renommer `l` ; `_fetch(fallback)` en HTTPS. Dans `forest-tiles.yml`, toutes les entrées `inputs.*` utilisées dans un `run:` passent par `env:`.
- [ ] **Step 4 :** `pytest -q` → tout vert (référence : 392 passed / 17 skipped localement, plus les nouveaux).
- [ ] **Step 5 : Commit** `fix(forest): dettes n° 72 (entrées par env, repli testé, boucle morte)`.

### Task 3 : Archives `WTPK`, catalogue, sélection des tuiles profondes, manifeste `deep`

**Files:**
- Create: `tiler/pack.py`
- Modify: `tiler/main.py` (sous-commandes `pack-deep`, `merge-deep-catalog`, `add-deep-manifest`), `tiler/encode.py` (si `write_forest_manifest` doit connaître `deep`)
- Test: `tests/test_pack.py`

**Interfaces:**
- Produces :
  - `cell_of(z: int, x: int, y: int) -> tuple[int, int]` (formule de la section « Format »).
  - `is_deep(z: int, x: int, y: int, tropics: Bounds) -> bool` (`z == 9`, ou `z == 8` hors bande ; mêmes bornes que `manifest.tropics`, c.-à-d. `tropical_bounds(TROPICS, 7)`).
  - `write_archive(tiles: list[tuple[int, int, int, Path]], dest: Path) -> int` (octets écrits ; tri `(z, x, y)` interne).
  - `read_directory(data: bytes) -> list[tuple[int, int, int, int, int]]` (z, x, y, offset, length) — pour les tests et le contrôle.
  - `pack_deep(out_dir: Path, dest_dir: Path, tropics: Bounds) -> dict[str, dict[str, int]]` : parcourt `out_dir/forest/z/x/y.png`, garde `is_deep`, écrit une archive par cellule, renvoie le fragment de catalogue `{nom: {"count", "bytes"}}`.
  - CLI : `python -m tiler.main pack-deep --out-dir out --dest deep/v1.12 --catalog-fragment frag-<box>.json` ; `merge-deep-catalog --fragments frag-*.json --out deep/v1.12/catalog.json` (échoue si un nom de cellule apparaît deux fois) ; `add-deep-manifest --manifest in.json --base-url URL --max-level 9 --out out.json` (garde tous les champs existants, ajoute `deep` ; refuse si `max-level` ≤ `max_level` du manifeste).

- [ ] **Step 1 : Tests en échec** (`tests/test_pack.py`) :
  - `test_cell_of` : `cell_of(9, 0, 0) == (0, 0)` ; `cell_of(9, 1023, 511) == (35, 17)` (niveau 9 : 1024 × 512 tuiles de 0,3516°) ; tuile dont le centre est à lon −59,9, lat −5,1 → `(12, 9)`.
  - `test_is_deep` : z 9 tropical → vrai ; z 8 tropical → faux ; z 8 à lat 45 → vrai ; z 7 → faux.
  - `test_archive_roundtrip` : 3 PNG factices écrits dans le désordre → `read_directory` les rend triés, `offset`/`length` relisent exactement chaque fichier, en-tête `WTPK`, version 1, `count == 3`, taille = 16 + 48 + somme des PNG.
  - `test_pack_deep_groups_by_cell_and_skips_r2_levels` : arbre factice avec z 7, 8 tropical, 8 tempéré, 9 → seules les tuiles profondes sont emballées, une archive par cellule, fragment correct.
  - `test_merge_catalog_rejects_duplicate_cell`.
  - `test_add_deep_manifest_keeps_fields` : manifeste R2 réel (copie de `data.globelayers.com/tiles/forest/v1.12/manifest.json` en fixture) → tous les champs d'origine identiques, `deep` conforme à la section « Format ».
- [ ] **Step 2 :** `pytest tests/test_pack.py -v` → FAIL (module absent).
- [ ] **Step 3 :** implémenter `tiler/pack.py` et les trois sous-commandes ; écriture en flux (pas de PNG tous en mémoire : copier fichier par fichier après l'en-tête).
- [ ] **Step 4 :** `pytest -q` → vert.
- [ ] **Step 5 : Commit** `feat(tiler): archives WTPK par cellule de 10°, catalogue et champ deep du manifeste`.

### Task 4 : Workflow `forest-deep.yml` (génération niveau 9, emballage, envoi Hugging Face)

**Files:**
- Create: `.github/workflows/forest-deep.yml`
- Modify: `tiler/requirements.txt` (ajout `huggingface_hub`), `tiler/main.py` si `--max-level 9` exige un ajustement (`forest_factor(9) == 3`, `forest_block` choisit le bloc)
- Test: `tests/test_forest_build.py` (`test_forest_factor_level9 == 3`, `test_forest_block_level9_under_peak`)

**Interfaces:**
- Consumes : commande `forest` existante, `pack-deep`, `merge-deep-catalog`, `add-deep-manifest` (Task 3).
- Entrées `workflow_dispatch` : `version` (défaut `v1.12`), `boxes` (défaut `[0..7]`), `sample` (vide = complet), `upload_hf` (faux par défaut), `patch_manifest` (faux par défaut) ; toutes passées par `env:`.

- [ ] **Step 1 : Tests** `forest_factor(9) == 3` et bloc de niveau 9 sous `PEAK_LIMIT_BYTES` → FAIL si le code les refuse, sinon PASS d'emblée (le noter).
- [ ] **Step 2 :** écrire le workflow :
  - job `deep` (matrice des boîtes) : `python -m tiler.main forest --box N --min-level 1 --max-level 9 --max-level-outside 9 …` puis `pack-deep` ; mesure disque/RAM/durée comme `forest-tiles.yml` ; `--sample` → estimation seulement (octets par niveau et par boîte, jamais d'envoi) ; artefacts : fragment de catalogue + mesures (pas les archives).
  - si `upload_hf` et jeu complet : chaque boîte envoie `deep/v1.12/*.wtpk` par `HfApi().upload_folder(repo_type="dataset", path_in_repo="v1.12")`, 5 tentatives avec attente croissante sur 409/412/429/5xx.
  - job `catalog` : fusionne les fragments, envoie `catalog.json`, lit le sha de tête du dépôt (`HfApi().repo_info(...).sha`) et l'écrit en sortie de job.
  - job `manifest` (si `patch_manifest`) : `rclone copyto` du manifeste R2 → `add-deep-manifest --base-url https://huggingface.co/datasets/$HF_REPO/resolve/$SHA/v1.12 --max-level 9` → `rclone copyto` vers le **même** objet avec `Cache-Control: public, max-age=300`.
  - **Garde** : étape finale qui échoue si le workflow contient une autre commande `rclone` d'écriture que ce `copyto` (grep du fichier lui-même), et aucune étape ne copie `out/forest` vers R2.
- [ ] **Step 3 :** `pytest -q` → vert ; `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/forest-deep.yml'))"` → sans erreur.
- [ ] **Step 4 : Commit** `feat(ci): workflow forest-deep (niveau 9, archives WTPK, envoi Hugging Face)`.
- [ ] **Step 5 :** avec l'accord de l'utilisateur, reporter `forest-deep.yml` seul sur `master` (et retirer `hf-spike.yml` du même coup), pousser.
- [ ] **Step 6 : Estimation** : `gh workflow run forest-deep.yml -f sample=20` ; relever octets par niveau et par boîte, pic disque et durée par boîte ; extrapoler. **Si un pic disque > 12 Go ou une durée > 5 h** : découper (entrée `split` en bandes de longitude par boîte, à ajouter à la commande `forest` par `--box`/`--lon-range`) et refaire l'estimation. Rapport chiffré au contrôleur, qui le présente à l'utilisateur avant la génération complète.

### Task 5 : Front — catalogue profond, lecture d'archive par Range, choix de la tuile

**Files:**
- Create: `web/src/tiles/deep.ts`
- Modify: `web/src/tiles/manifest.ts` (`ForestManifest.deep`), `web/src/tiles/loader.ts` (`ForestSource`, `forestTileFor`, `forestTileUrl` → `forestTileRequest`, `TileLoaderDeps.fetchBitmap`), `web/src/tiles/reader.ts` (`decode` avec plage), `web/src/main.ts` (création du catalogue, `requestRender` au chargement d'une cellule)
- Test: `web/tests/deep.test.ts`, `web/tests/tiles-manifest.test.ts`, `web/tests/loader*.test.ts`, `web/tests/reader.test.ts` (fichiers existants à étendre, noms réels à vérifier)

**Interfaces:**
- Produces :
  - `ForestManifest.deep: DeepInfo | null` avec `DeepInfo = { baseUrl: string; maxLevel: number; catalog: string; format: "wtpk1" }` ; `parseForestManifest` rejette `deep.max_level ≤ max_level` et un `format` inconnu ; `deep` absent → `null`.
  - `cellOf(z, x, y): string` (miroir exact de `tiler/pack.py`).
  - `parseCatalog(json: unknown): Map<string, { count: number; bytes: number }>` ; `parseDirectory(buf: ArrayBuffer): Map<string /* tileKey */, ByteRange>` avec `ByteRange = { offset: number; length: number }` (lève sur magic/version/longueur fausse).
  - `class DeepCatalog` : `constructor(info: DeepInfo, deps: { fetchJson(url, signal): Promise<unknown>; fetchRange(url, range, signal): Promise<ArrayBuffer>; onChange(): void; now?(): number; failureCooldownMs?: number /* 30 000 */ })` ; `lookup(t: TileId): { state: "present"; range: ByteRange; url: string } | { state: "absent" } | { state: "pending" }` — `pending` déclenche au plus un chargement par cellule (catalogue d'abord, une fois) ; chargé → `onChange()` ; échec → `pending` pendant le refroidissement puis nouvel essai ; `cellUrl(name)` = `${baseUrl}/${name}.wtpk`.
  - `ForestSource` gagne `deep: DeepCatalog | null` et `deepMaxLevel: number` (= `min(manifest.deep.maxLevel, FOREST_TIER_LEVEL[tier])`, R2 seul si `deep` nul).
  - `forestTileFor(t: TileId, src: ForestSource): TileId | null` (signature changée : prend la source) : niveau R2 comme aujourd'hui ; si `t.z` dépasse le plafond R2 et `src.deep` existe, descendre de `min(t.z, deepMaxLevel)` jusqu'au plafond R2 + 1 : `present` → cette tuile ; `absent` au premier niveau essayé → `null` ; `pending` → repli sur la règle R2 actuelle.
  - `forestTileRequest(src: ForestSource, t: TileId): { url: string; range: ByteRange | null }` (remplace `forestTileUrl` ; plage non nulle pour une tuile profonde).
  - `TileLoaderDeps.fetchBitmap(url: string, signal: AbortSignal, range?: ByteRange | null)` ; `TileReaderDeps.decode(url, signal, range?)` ; clé de cache du lecteur = `url#offset` pour une tuile profonde. `browserTileDeps`/`browserDecodeTile` envoient `Range: bytes=offset-(offset+length-1)` et exigent un statut 206.

- [ ] **Step 1 : Tests en échec** (`deep.test.ts` et existants) :
  - `cellOf` mêmes cas que `test_cell_of` (Task 3).
  - `parseDirectory` sur un tampon construit à la main (2 enregistrements) → plages justes ; magic faux → lève.
  - `DeepCatalog.lookup` : premier appel `pending` et un seul `fetchJson` + un seul `fetchRange` (0, 16 + 16·count) même après 10 appels ; après résolution `onChange` appelé une fois, puis `present` / `absent` ; cellule absente du catalogue → `absent` sans `fetchRange` ; échec → `pending` et aucun nouvel appel avant 30 s (horloge factice), nouvel essai après (**Review Focus 2**).
  - `forestTileFor` : sans `deep` → comportement R5b inchangé (tests existants verts, signature adaptée) ; z 9 tempéré `present` → tuile z 9 ; `pending` → tuile R2 de niveau 7 (**Review Focus 1**) ; `absent` → `null` même si l'ancêtre R2 existe (**Review Focus 5**) ; `deepMaxLevel` 8 (profil `low`) → jamais de z 9.
  - `parseForestManifest` : manifeste R2 actuel (sans `deep`) → `deep === null` ; avec `deep` valide → champs ; `max_level` profond ≤ 8 → `ManifestError`.
  - loader : une tuile profonde passe `range` à `fetchBitmap` ; une tuile R2 passe `null`.
- [ ] **Step 2 :** `cd web && npx vitest run tests/deep.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter `deep.ts`, adapter `manifest.ts`, `loader.ts`, `reader.ts` (`locate` part de `tileAt(src.deepMaxLevel, lon, lat)` au lieu de `manifest.maxLevel`, puis `forestTileFor`), puis `main.ts` : créer le `DeepCatalog` quand `manifest.deep` existe (`onChange: () => sceneHandle.requestRender()`), `FOREST_TIER_LEVEL: Record<Tier, number> = { high: 9, low: 8 }` exporté de `render/globe.ts`.
- [ ] **Step 4 :** `cd web && npx vitest run && npx tsc --noEmit` → vert.
- [ ] **Step 5 : Commit** `feat(web): tuiles forêt profondes lues par Range dans les archives WTPK`.

### Task 6 : Front — subdivision niveau 9, caméra plus basse sous Forest, remontée, URL

**Files:**
- Modify: `web/src/render/globe.ts` (`setForestMaxLevel`), `web/src/render/scene.ts` (`FOREST_MIN_DISTANCE`, `setMinDistance`, `setInitialView(lon, lat, d, minDistance?)`), `web/src/controls/zoom.ts` (`ZoomControl.setRange(aMin, aMax)`), `web/src/render/fly.ts` (`climbTarget`, `Flight.start(..., onArrive, onCancel?)`), `web/src/geo/params.ts` (`d.toFixed(4)`), `web/src/main.ts` (`activate`, vue initiale)
- Test: `web/tests/fly.test.ts`, `web/tests/zoom.test.ts`, `web/tests/geo-params.test.ts` (noms réels à vérifier), nouveau `web/tests/deep-camera.test.ts` si besoin

**Interfaces:**
- Consumes : `FOREST_TIER_LEVEL` (Task 5).
- Produces :
  - `TiledGlobe.setForestMaxLevel(level: number): void` ; sous Forest, `selectTiles` reçoit `maxLevel = max(levelCap, forestLevelCap)` ; hors Forest, `levelCap` seul (inchangé).
  - `export const FOREST_MIN_DISTANCE = 1 + (MIN_DISTANCE - 1) / 4;` ; `SceneHandle.setMinDistance(d: number): void` (pose `controls.minDistance` et `zoom.setRange(d - 1, MAX_DISTANCE - 1)`).
  - `climbTarget(position: THREE.Vector3, minDistance: number): { lon: number; lat: number; d: number } | null` — `null` si `position.length() ≥ minDistance`, sinon le point sous la caméra et `d = minDistance`.
  - `Flight.start(lon, lat, distance, onArrive, onCancel?)` : `onCancel` appelé par `cancel()` pendant un vol.

- [ ] **Step 1 : Tests en échec** :
  - `climbTarget` : caméra à 1,0105 au-dessus de (−60, −8) → `{ lon ≈ −60, lat ≈ −8, d: 1.042 }` ; caméra à 1,3 → `null`.
  - `Flight` : `cancel()` pendant un vol appelle `onCancel` une fois et pas `onArrive` (**Review Focus 3**).
  - `ZoomControl.setRange` : après `setRange(0.0105, 3)`, `nextAltitude` ne descend pas sous 0,0105 (test sur la fonction pure si `attachZoom` n'est pas testable en Node).
  - `geo/params` : `d = 1.0105` écrit `"1.0105"`.
  - vue initiale (fonction pure à extraire de `main.ts` : `initialMinDistance(layerId: string | null): number`) : `"forest"` → `FOREST_MIN_DISTANCE`, `"temperature"` ou `null` → `MIN_DISTANCE` (**Review Focus 4**).
- [ ] **Step 2 :** `cd web && npx vitest run` → FAIL sur les nouveaux tests.
- [ ] **Step 3 :** implémenter. Dans `activate` : si Forest devient active → `setMinDistance(FOREST_MIN_DISTANCE)`, `globe.setForestMaxLevel(src.deepMaxLevel)` ; si on la quitte → `climbTarget(camera.position, MIN_DISTANCE)` ; non nul → `flight.start(lon, lat, d, apply, apply)` avec `apply = () => setMinDistance(MIN_DISTANCE)` ; nul → `apply()` tout de suite. La limite normale n'est posée qu'**après** le vol (OrbitControls borne la distance à chaque `update()` : la poser avant ferait un saut). Vue initiale : `setInitialView(lon, lat, d, initialMinDistance(couche initiale))`, borne sans vol.
- [ ] **Step 4 :** `cd web && npx vitest run && npx tsc --noEmit && npm run build` → vert ; relever la taille gzip du bundle.
- [ ] **Step 5 : Commit** `feat(web): zoom forêt jusqu'au niveau 9 et sur-zoom, remontée en quittant Forest`.

### Task 7 : Génération, envoi, manifeste, validation, HISTORY

**Files:**
- Modify: `HISTORY.md` (§3 : `tiler/pack.py`, `web/src/tiles/deep.ts`, `forest-deep.yml`, tests ; §2 : Hugging Face et `huggingface_hub` ; §5 : décisions du lot et bundle ; §6 si défaut ; §7 ligne du lot ; §8 : dette n° 72 marquée résolue, nouvelles dettes ; §9 ; pied de page), `web/src/ui/about.ts` seulement si la mention de l'hébergement s'impose
- Delete: `.github/workflows/hf-spike.yml` (si pas déjà fait en Task 4) et `spike/` du dépôt Hugging Face

- [ ] **Step 1 :** génération complète sans envoi (`gh workflow run forest-deep.yml`) ; vérifier toutes les boîtes vertes, total d'octets et de cellules (< 100 000 fichiers), fragments cohérents.
- [ ] **Step 2 :** **accord de l'utilisateur**, puis `gh workflow run forest-deep.yml -f upload_hf=true` ; vérifier sur le dépôt les `.wtpk` et `catalog.json`, et une lecture Range réelle d'un répertoire de cellule (`curl -r 0-15 -L …/v1.12/12_9.wtpk | xxd` → `WTPK`, version 1).
- [ ] **Step 3 :** **accord de l'utilisateur**, puis `-f patch_manifest=true` (ou relancer seul le job `manifest`) ; vérifier `https://data.globelayers.com/tiles/forest/v1.12/manifest.json` : champs d'origine intacts, `deep.base_url` avec le sha ; occupation R2 inchangée (`rclone size`, ≈ 8,52 Go).
- [ ] **Step 4 : Validation Brave** (`vite preview` sur `feat/forest-deep`, accord utilisateur) — critères de la spec §11 : Rondônia, Bornéo, Landes ou Colombie-Britannique au niveau 9 ; sur-zoom sans nouvelle requête ; Forest → Temperature en zoom profond : vol de remontée ; tooltip juste ; Hugging Face bloqué (règle de blocage de requêtes DevTools sur `huggingface.co`) : couche utilisable aux niveaux R2 ; 412 px ; couches météo, frise, capture et pages forêt sans régression.
- [ ] **Step 5 :** HISTORY (skill `updating-history`), `python tools/history_check.py` → ✓ ; `pytest -q` et `cd web && npx vitest run && npx tsc --noEmit` → vert.
- [ ] **Step 6 :** revue finale de branche, puis merge `--no-ff` dans `master` **avec l'accord de l'utilisateur**, push, CI verte ; en prod, zoom profond vérifié sur `/deforestation-map/`.
