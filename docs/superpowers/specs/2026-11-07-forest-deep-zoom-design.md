# Lot R5c — zoom forêt profond (niveau 9 partout, tuiles hébergées hors R2)

Statut : conception, brainstorming du 2026-11-07. Demande d'origine de l'utilisateur : 2026-11-01,
après la validation du lot R5b (HISTORY §8 R5, mémoire « zoom forêt plus profond »).
S'appuie sur la conception du lot R5b `docs/superpowers/specs/2026-10-31-forest-design.md`.

## 1. Intention

Sous la couche **Forest**, pouvoir zoomer sur **n'importe quelle forêt du monde** assez près pour
distinguer les **petites parcelles déboisées**. Aujourd'hui, les tuiles s'arrêtent au niveau 8
(≈ 150 m par pixel) sous ±30° et au niveau 7 (≈ 300 m) ailleurs, et la caméra ne descend pas
sous ≈ 2° de large à l'écran (`MIN_DISTANCE = 1.042`, `web/src/render/scene.ts`). Les coupes de
quelques hectares se fondent dans un pixel.

## 2. Objectifs

1. Pyramide forêt prolongée jusqu'au **niveau 9 partout** (≈ 76 m par pixel), y compris hors
   tropiques, où les niveaux 8 et 9 manquent aujourd'hui.
2. **Caméra plus basse sous Forest** : un cran de zoom sous le niveau 9 (sur-zoom : pixels
   agrandis, sans donnée nouvelle), pour bien voir les pixels de 76 m.
3. **Retour en douceur** : en quittant Forest pour une couche météo alors que la caméra est sous la
   limite normale, elle remonte en vol animé jusqu'à la limite normale, centrée au même endroit.
4. Même comportement sur **téléphone** que sur ordinateur (profil `high`).
5. **Zéro dépense** : R2 reste sous ses 10 Go gratuits ; les niveaux profonds vivent chez un
   hébergeur gratuit, **Hugging Face** (dépôt dataset public).

## 3. Non-objectifs

- Le niveau 10 (≈ 38 m) ou la résolution native de 30 m : écartés au profit du niveau 9 avec sur-zoom.
- Le passage à Hansen **v1.13** (pertes 2025, publiée sur Google Storage, constaté le 2026-11-07) :
  pas dans ce lot ; on reste en v1.12 pour que les niveaux 0–8 de R2 et les niveaux profonds
  concordent.
- Un fond de carte (relief, satellite) plus fin que le niveau 8 : sous la forêt très zoomée, le
  fond reste au niveau 8, donc flou derrière des pixels forêt nets (supposition validée sans
  objection par l'utilisateur).
- Un zoom profond pour les couches météo : leur grille est de 0,25°, la limite normale reste la leur.
- De nouvelles pages ou images Open Graph.

## 4. Anti-objectifs

- **Toute dépense** : ni R2 au-delà de 10 Go, ni offre payante d'un autre hébergeur.
- Faire régresser la couche Forest actuelle (niveaux 0–8, tooltip, légende, capture), les couches
  météo, la frise ou les tuiles `map`/`sat`.
- Un traitement lourd sur la machine de l'utilisateur (RAM 1–2 Go) : génération uniquement sur
  Actions.
- Une vue profonde qui se charge si lentement sur téléphone que l'exploration devient pénible.
- Des requêtes 404 en masse (tuile absente demandée) ou un tooltip qui affiche une valeur fausse
  quand la tuile fine n'est pas encore chargée.
- Publier sur Hugging Face sans l'accord de l'utilisateur.

## 5. Décisions

### 5.1 Prises par l'utilisateur (2026-11-07)

| Décision | Choix |
|---|---|
| Où zoomer | **Partout** (pas seulement les régions des pages ni les tropiques) |
| Budget | **Zéro** : rester gratuit |
| Piste | **③ nos propres tuiles, hébergées sur Hugging Face** (écartées : ① lire les GeoTIFF Hansen à la source, ② tuiles Global Forest Watch) |
| Profondeur | **Niveau 9 + sur-zoom** d'un cran (pas le niveau 10) |
| Sortie de Forest en zoom profond | **Remontée en vol animé** jusqu'à la limite normale |
| Téléphone | **Pareil que l'ordinateur** ; un appareil `low` peut rester un niveau plus haut pour la mémoire |
| Compte Hugging Face | **Aucun aujourd'hui** : à créer (gratuit) au moment voulu, étapes guidées par Claude |

### 5.2 Constats de la reconnaissance (2026-11-07)

- **Hansen à la source** : GeoTIFF LZW **en bandes d'une ligne** sur toute la largeur de 10°
  (40 000 bandes, 2,7 Ko en moyenne pour `lossyear`), Range accepté, **pas de CORS**. Lire une
  petite zone oblige à télécharger des lignes de 10° de large : trop lourd par vue (piste ① écartée).
- **Global Forest Watch** : `tiles.globalforestwatch.org/umd_tree_cover_loss/latest/…` redirige
  vers **v1.13**, PNG RGBA de 512 px (≈ 37 Ko au niveau 10), CORS `*`, cache d'un an ; conditions
  d'usage floues (« une clé API par requête »). Gardé comme **plan B** si Hugging Face échoue (§9).
- **Hugging Face** : stockage public gratuit « best effort » (jusqu'à environ 5 To pour un travail
  utile), **moins de 100 000 fichiers par dépôt**, fichiers jusqu'à 200 Go ; la résolution
  `huggingface.co/datasets/<dépôt>/resolve/<rév>/<fichier>` renvoie une **redirection 307**, avec
  **CORS pour l'origine `https://globelayers.com`** et **Range accepté** (testé sur un petit fichier
  texte, pas encore sur un gros fichier stocké en Xet/LFS : à vérifier en premier, §9).
- **Volumes** (extrapolés de l'estimation R5b : niveau 8 partout = 6,37 Go) : ajouter le niveau 9
  partout et le niveau 8 hors tropiques ≈ **20 à 25 Go**, à **mesurer par échantillon** avant tout
  envoi. Trop de tuiles pour 100 000 fichiers : il faut les **regrouper** en gros fichiers lus par
  morceaux (Range).

### 5.3 Mes choix (à vérifier en relisant)

- **Répartition** : R2 garde tel quel ce qu'il sert aujourd'hui (niveaux 0–8 sous ±30°, 0–7
  ailleurs, `tiles/forest/v1.12/`) ; Hugging Face reçoit **tout ce qui manque** : niveau 8 hors
  tropiques et niveau 9 partout. **Seule exception** : le manifeste `tiles/forest/v1.12/manifest.json`
  est réécrit en place (même objet, quelques Ko, schéma étendu par une « source profonde »),
  aucun autre objet R2 n'est créé, réécrit ni supprimé.
- **Regroupement** : un format d'archive à accès aléatoire par Range ; **PMTiles v3** est le choix
  par défaut (format ouvert, répertoire en tête de fichier, lecteur JS léger), un format maison
  reste possible s'il est plus simple pour notre grille géodésique (§10). Plusieurs archives (par
  boîte de génération ou par niveau) plutôt qu'une seule énorme, pour qu'une boîte se régénère seule.
- **Même contenu de tuile** que R5b : PNG 512 px, canaux couvert / année / part perdue, même règle
  d'agrégation (année la plus récente), même seuil de 30 %. Le shader, la légende et le tooltip ne
  changent pas de logique.
- **Index de présence** : comme R5b (`index.bin`), pour ne jamais demander une tuile vide ; le
  répertoire de l'archive peut en tenir lieu si le constructeur le juge équivalent.
- **Version dans le chemin** sur Hugging Face aussi (`v1.12/…`) pour qu'une mise à jour annuelle ne
  casse pas les caches ; les fichiers sont référencés par **révision figée** (sha de commit HF)
  plutôt que `main`, inscrite dans le manifeste forêt.
- **Profil `low`** : niveau forêt plafonné à 8 (un de moins), sur-zoom identique.

## 6. Génération

- Reprend `forest-tiles.yml` et `tiler/` (commande `forest`, boîtes en parallèle, échantillonnage
  `--sample`) : ajout du niveau 9 et d'un mode « niveaux profonds seulement » (8 hors tropiques +
  9 partout) qui n'écrit pas ce qui est déjà sur R2.
- **Disque des runners ≈ 14 Go** : une boîte ne doit jamais tenir plus que ce que le disque permet ;
  découper plus fin que les 8 boîtes actuelles si la mesure l'exige.
- **Étapes obligatoires** : (1) estimation par échantillon, chiffres par niveau et par boîte ;
  (2) génération complète sans envoi ; (3) envoi vers Hugging Face **avec l'accord de
  l'utilisateur**, par un jeton d'écriture en secret GitHub (`HF_TOKEN`).
- **Dettes à traiter avant cette régénération** (HISTORY §8 n° 72) : tuiles orphelines si une boîte
  échoue pendant un envoi, entrées `workflow_dispatch` interpolées dans le shell (passer par `env:`),
  boucle `only_loss` morte, tests manquants. La garde « budget R2 avant envoi » devient une garde
  « rien n'est envoyé vers R2 sauf le manifeste » pour ce lot.
- Le compte, l'organisation éventuelle et le dépôt dataset Hugging Face sont créés par
  l'utilisateur, guidé pas à pas ; nom proposé du dépôt : `globelayers-forest` (au constructeur
  de confirmer avec l'utilisateur).

## 7. Front

- **Deux sources pour le jeu `forest`** : R2 pour les niveaux déjà publiés, Hugging Face pour les
  niveaux profonds ; `forestTileFor` (`web/src/tiles/loader.ts`) choisit la tuile la plus fine
  disponible, et `forestTileUrl` (ou son équivalent) sait lire une tuile dans une archive par Range.
  Le lecteur du tooltip (`web/src/tiles/reader.ts`) suit la même règle.
- **LOD** : sous Forest, les patchs du globe se subdivisent jusqu'au niveau 9 (aujourd'hui plafonnés
  par `TIER_PROFILE.maxLevel = 8`, `web/src/render/globe.ts`) ; les jeux `map`/`sat` restent au
  niveau 8 et se lisent sur l'ancêtre.
- **Caméra** : sous Forest, distance minimale abaissée pour un cran de sur-zoom sous le niveau 9 ;
  limite normale inchangée pour les autres couches. En quittant Forest sous la limite normale :
  vol animé (réutiliser le vol de la recherche de ville, lot F) jusqu'à la limite normale. Zoom
  molette, pincement et ancrage doivent rester cohérents à la nouvelle limite (`zoom.ts`).
- **Repli** : tant qu'une tuile profonde n'est pas chargée, ou si Hugging Face ne répond pas, on
  affiche l'ancêtre (niveau 8 ou 7 de R2) sans erreur visible ; le tooltip lit la tuile la plus fine
  **chargée**, c'est-à-dire celle qui est dessinée à l'écran : la valeur agrégée d'un ancêtre
  affiché n'est pas « fausse » (comportement actuel de R5b, conservé) ; une valeur devinée ou lue
  dans une tuile non affichée l'est.
- **Crédit** : inchangé (Hansen v1.12, CC BY 4.0). Mention de l'hébergement Hugging Face dans
  About seulement si l'usage le demande.
- **Capture 📷 et URL** : une vue en zoom profond se partage et se recharge à la même altitude sous
  `?layer=forest` ; sous une autre couche, l'altitude lue dans l'URL est bornée à la limite normale.

## 8. Contraintes

- R2 : **aucun nouvel objet**, seul le manifeste forêt est réécrit ; occupation inchangée (≈ 8,52 Go).
  La garde du workflow devient « rien vers R2 sauf le manifeste ».
- Hugging Face : offre gratuite seulement ; moins de 100 000 fichiers par dépôt.
- Bundle : plafond actuel 195,28 Ko gzip ; relèvement accepté s'il est chiffré et justifié dans
  HISTORY §5 (lecteur d'archive compris).
- Mémoire GPU : budget du profil inchangé (`budgetBytes`, 256 Mo en `high`, 96 Mo en `low`).
- Génération uniquement sur Actions ; durée par job compatible avec les limites des runners.
- Tests : pytest (niveau 9, mode profond, écriture d'archive, garde « rien vers R2 »), vitest (choix
  de source et de niveau, lecture d'une tuile dans une archive, distance minimale par couche,
  remontée en quittant Forest, bornage de l'altitude dans l'URL, repli).
- Commits, code interne et HISTORY en français ; site en anglais ; HISTORY avant push.
- Validation navigateur sous Brave, avec l'accord de l'utilisateur (RAM).

## 9. Risques et ordre de travail

1. **Vérifier d'abord Hugging Face sur un vrai gros fichier** (petit dépôt de test : une archive de
   quelques centaines de Mo) : Range et CORS **après la redirection** vers le stockage Xet/LFS, temps
   de réponse depuis l'Europe, éventuelles limites de débit (`RateLimit` exposé dans les en-têtes),
   coût d'une redirection par lecture (peut-on réutiliser l'URL finale ?). Si cela échoue, **s'arrêter
   et revenir vers l'utilisateur** avec le plan B (tuiles Global Forest Watch pour les niveaux
   profonds, ou proxy Worker gratuit devant Hugging Face).
2. Estimation des volumes par échantillon.
3. Dettes n° 72, puis génération et envoi.
4. Front, puis validation navigateur.

## 10. Laissé au constructeur

Format exact des archives (PMTiles ou maison), découpage en archives et en boîtes, place de l'index
de présence, forme du manifeste (champ « source profonde » : URL de base, révision, niveaux), règle
de choix entre R2 et Hugging Face, valeur exacte de la distance minimale sous Forest et de la limite
normale de remontée, durée et courbe du vol de remontée, plafond `low`, nom du dépôt Hugging Face
(à confirmer avec l'utilisateur).

## 11. Critères d'acceptation

1. Sous Forest, au Rondônia, à Bornéo **et dans une forêt hors tropiques** (par exemple les Landes
   ou la Colombie-Britannique), la caméra descend sous l'ancienne limite et les tuiles de niveau 9
   s'affichent ; les petites coupes se distinguent nettement mieux qu'au niveau 8.
2. Le sur-zoom d'un cran sous le niveau 9 fonctionne (pixels agrandis, aucune requête en plus).
3. En passant de Forest à Temperature en zoom profond, la caméra remonte en vol animé jusqu'à la
   limite normale, au même endroit.
4. Tooltip juste au niveau 9 ; jamais de valeur fausse pendant un chargement.
5. Hugging Face injoignable (simulé) : la couche Forest reste utilisable aux niveaux de R2, sans
   message d'erreur bloquant.
6. Téléphone (profil `high`, 412 px) : même profondeur, chargement jugé acceptable par l'utilisateur.
7. R2 inchangé hormis le manifeste forêt (aucun nouvel objet, ≈ 8,52 Go) ; aucune dépense ; dépôt Hugging Face public créé
   avec l'accord de l'utilisateur.
8. Aucune régression des couches météo, de la frise, de la capture ni des pages forêt.
9. Tests et `history_check` verts ; bundle sous le plafond relevé.
