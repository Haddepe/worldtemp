# Lot R5b — couche forêt (couvert 2000 et pertes 2001–2024)

Statut : conception, brainstorming du 2026-10-31 (suite du lot R5a neige, livré le même jour,
merge `72ad975`). Demande d'origine de l'utilisateur : 2026-10-24, HISTORY §8 R5.

## 1. Intention

Une couche qui sort de la météo et raconte la **déforestation** : où est la forêt, où elle a
disparu, et quand. Elle doit être spectaculaire de près, avec les fronts de défrichement visibles
parcelle par parcelle (routes en « arête de poisson » au Rondônia, plantations à Bornéo), et elle
sert le chantier audience : « deforestation map » et « Amazon deforestation » sont des requêtes
anglaises très cherchées toute l'année.

## 2. Objectifs

1. Une entrée **Forest** dans le menu des couches.
2. **Couvert forestier de l'an 2000** en vert, dont l'**intensité suit la densité** de canopée
   au-dessus du **seuil de 30 %** (en dessous : pas de forêt, transparent) : vert pâle pour une forêt clairsemée, vert profond pour une forêt dense.
3. **Pertes 2001 → 2024** colorées **selon l'année de perte** : anciennes en jaune → récentes en
   rouge vif, par-dessus le couvert.
4. **Détail au zoom** : tuiles fines, jusqu'au niveau 8 de la pyramide existante (≈ 150 m par
   pixel), sur lesquelles les fronts de défrichement restent lisibles.
5. **Tooltip** : « Tree cover 85 % » ou « Forest lost in 2019 » au survol ou au toucher.
6. **Légende** en deux parties : densité du couvert, année de perte.
7. Quatre pages d'entrée (§8), au sitemap et au tiroir ☰.

## 3. Non-objectifs

- Les gains de forêt (la donnée Hansen « gain » s'arrête en 2012).
- Un curseur année par année (2001 → 2024) : écarté en brainstorming, peut revenir plus tard.
- Une mise à jour automatique : la donnée est annuelle, la génération est lancée à la main.
- Toute interaction avec la frise météo : la couche forêt n'a pas de dimension temporelle.
- Une valeur de forêt sur les étiquettes de villes.

## 4. Anti-objectifs

- Des tuiles si grossières que les arêtes de poisson du Rondônia disparaissent : la couche
  perdrait son intérêt.
- Dépasser le stockage gratuit de R2 (10 Go) sans l'avoir mesuré et signalé à l'utilisateur.
- Un traitement lourd sur la machine de l'utilisateur (RAM 1–2 Go) : tout se fait sur Actions.
- Oublier le crédit CC BY 4.0 des données.
- Faire régresser le rendu, les tuiles ou la frise des couches météo.

## 5. Décisions

### 5.1 Prises par l'utilisateur (2026-10-31)

| Décision | Choix |
|---|---|
| Contenu | **Couvert + pertes** (pas l'un des deux seul) |
| Niveau de détail | **Fin au zoom** (tuiles, pas la grille météo 0,25°) |
| Pertes | **Couleur selon l'année** (jaune ancien → rouge récent), pas de curseur par année |
| Intégration | **Couche du menu** (pas une surimpression combinable) ; la frise météo est masquée quand Forest est active |
| Couvert | **Intensité selon la densité** (0–100 %), pas un vert unique au-dessus d'un seuil |
| Tooltip | **Couvert + année de perte** |
| Pages | `/deforestation-map/` + **Amazonie**, **Bornéo / Indonésie**, **bassin du Congo** |
| Ordre | Après la neige (R5a livré) |
| Seuil de forêt | **30 % de canopée** (convention Global Forest Watch) : en dessous, transparent et aucune perte comptée ; au-dessus, intensité selon la densité (30 → 100 %) |
| Repli si R2 > 10 Go | **Niveau 8 seulement en zones tropicales** (Amérique du Sud, Afrique centrale, Asie du Sud-Est ; bande à fixer par le constructeur, au moins les trois régions des pages), niveau 7 ailleurs |

### 5.2 Mes choix

- **Source** : Hansen et al., *Global Forest Change* **GFC-2024-v1.12** (Université du Maryland,
  Google, USGS, NASA), licence **CC BY 4.0**. Vérifié le 2026-10-31 : dalles 10° × 10° GeoTIFF,
  504 par couche, sur `storage.googleapis.com/earthenginepartners-hansen/GFC-2024-v1.12/`
  (listes `treecover2000.txt` et `lossyear.txt`) ; dalle `00N_060W` (Amazonie) : 376 Mo pour
  `treecover2000`, 113 Mo pour `lossyear`. Couches utilisées : `treecover2000` (% de canopée en
  2000) et `lossyear` (0 = pas de perte, 1–24 = 2001–2024).
- **Pas d'étiquettes de valeur** pour Forest (les villes restent nommées, sans chiffre).
- **Vent éteint par défaut** sur les quatre pages forêt.
- **Crédit** : « Hansen/UMD/Google/USGS/NASA — Global Forest Change 2000–2024 (v1.12), CC BY 4.0 »
  dans `#attribution` quand Forest est active et dans le panneau About.
- **Adresses** des pages : voir §8.
- Version de la donnée dans le chemin des tuiles, par exemple `tiles/forest/v1.12/…`, pour qu'une
  mise à jour annuelle ne casse pas les caches.

## 6. Données et génération des tuiles

- **Pyramide** : la grille géodésique existante (`tiler/grid.py` et son miroir
  `web/src/tiles/grid.ts`, tuiles de 512 px, niveau z = 2^(z+1) × 2^z tuiles). Niveaux 0 à 8.
  Le niveau 8 donne ≈ 0,0014° par pixel, soit ≈ 150 m à l'équateur.
- **Contenu d'une tuile** : deux canaux 8 bits, couvert (%) et année de perte (0–24), en PNG sans
  perte. Le format exact (PNG gris + alpha, RGB avec un canal libre…) revient au constructeur.
- **Agrégation de 30 m vers la résolution de chaque niveau** : le couvert par moyenne. Pour
  l'année de perte, le constructeur choisit la règle (année la plus fréquente, la plus récente,
  part minimale de pixels perdus…) et la justifie sur une validation visuelle : **les arêtes de
  poisson du Rondônia et les plantations de Bornéo doivent rester visibles au niveau 8**.
- **Clairsemé** : pas de tuile là où il n'y a ni forêt ni perte (océans, déserts, calottes), avec
  un index de présence comme `index.bin` du jeu `map` (`tiler/encode.py` `TileIndex`, miroir
  `web/src/tiles/index.ts`), à réutiliser plutôt que dupliquer.
- **Génération** : workflow GitHub Actions manuel (`workflow_dispatch`), découpé en zones en
  parallèle comme `.github/workflows/tiles.yml` (jobs `map` par boîte). Chaque job ne télécharge
  que les dalles Hansen de sa zone (disque des runners ≈ 14 Go). Outils : GDAL (déjà utilisé par
  `tiler/`), upload R2 par rclone comme `tiles.yml`.
- **Seuil** : un pixel 30 m est « forêt » si `treecover2000 ≥ 30` ; une perte n'est comptée que
  sur un pixel forêt. Une tuile n'existe que si elle contient de la forêt ou une perte au sens du
  seuil.
- **Stockage** : mesurer avant tout la taille totale estimée (par exemple sur un échantillon de
  zones) et l'occupation actuelle du bucket `worldtemp`. Si le total dépasse les 10 Go gratuits de
  R2, appliquer le repli décidé (§5.1) : niveau 8 en zones tropicales seulement, niveau 7 ailleurs ;
  si ce n'est toujours pas suffisant, **s'arrêter et le dire à l'utilisateur** avant de publier.
- **Profil d'appareil `low`** : il plafonne aujourd'hui les tuiles au niveau 7
  (`web/src/render/globe.ts`) ; on le garde, le critère 2 se valide en profil `high`.
- Manifeste des tuiles forêt (version, niveaux, sources, crédit), dans l'esprit de
  `tiles/v1/manifest.json`.

## 7. Front

- **Registre** : une entrée Forest dans le menu, déclarée de façon à ne pas exiger d'entrée dans
  le manifeste météo `layers/forecast.json` (la forêt n'y figure pas). Le mécanisme (type de
  couche « tuiles » à côté des couches « grille ») revient au constructeur.
- **Rendu** : jeu de tuiles `forest` chargé et choisi par LOD comme le jeu `map`
  (`web/src/tiles/`), composé dans le shader des patchs (`web/src/render/shaders/patch.frag.glsl`)
  par-dessus le fond, à la place de la couche météo quand Forest est active. Couleurs : vert dont
  l'intensité suit le couvert ; jaune → rouge selon l'année de perte ; transparent sans forêt.
- **Frise** masquée quand Forest est active ; elle revient telle qu'elle était quand on repasse à
  une couche météo.
- **Légende** en deux parties (couvert 0–100 %, pertes 2001 → 2024), horizontale sur ordinateur,
  compatible avec la légende verticale du téléphone ; reprise dans la **capture d'image**.
- **Tooltip** : lecture de la tuile chargée sous le curseur (couvert, année) ; sous le seuil ou
  sans tuile à cet endroit : « No forest » (ou rien, au constructeur). Une tuile pas encore chargée ne doit jamais afficher une valeur fausse.
- **Adresse** : `?layer=forest`, comme les autres couches.
- Chaînes en anglais dans `web/src/i18n/en.ts`.

## 8. Pages

Même forme que les pages des lots G et R5a (`web/src/pages/registry.ts`) :

| Slug (proposé) | Vue (point de départ, à ajuster en validation) |
|---|---|
| `deforestation-map` | vue par défaut |
| `amazon-deforestation-map` | Amazonie, Rondônia et Pará (lon ≈ −60, lat ≈ −8) |
| `borneo-deforestation-map` | Bornéo et Sumatra (lon ≈ 112, lat ≈ 0) |
| `congo-basin-deforestation-map` | bassin du Congo (lon ≈ 22, lat ≈ 0) |

Textes en anglais rédigés par Claude, relus par l'utilisateur avant le merge ; sources et années
dites simplement ; pas de chiffre de surface perdue non sourcé. Images Open Graph : captures fixes,
avec l'accord de l'utilisateur avant d'ouvrir le globe (RAM). La page `amazon-rainfall-map` peut
pointer vers `amazon-deforestation-map` dans `related`.

## 9. Contraintes

- Aucune régression des couches météo, du fond satellite et carte, de la frise ni des tuiles `map`.
- Bundle : plafond actuel 189,03 Ko gzip ; relèvement accepté, chiffré et justifié dans HISTORY §5.
- R2 : stockage total ≤ 10 Go, sinon arrêt et décision de l'utilisateur.
- Génération uniquement sur Actions ; durée par job compatible avec les limites des runners.
- Tests : pytest pour l'agrégation et l'encodage des tuiles (petits rasters synthétiques), vitest
  pour le registre, le menu, la frise masquée, la légende, le tooltip et les pages.
- Commits, code interne et HISTORY en français ; site en anglais ; HISTORY avant push.
- Validation navigateur sous Brave, avec l'accord de l'utilisateur.

## 10. Laissé au constructeur

Règle d'agrégation des pertes, format des canaux de tuile, découpage des zones du workflow,
manifeste des tuiles forêt, mécanisme « couche tuiles » du registre, palette exacte, placement de
la légende double sur mobile, lecture des tuiles pour le tooltip, textes des pages.

## 11. Critères d'acceptation

1. Forest dans le menu ; la choisir masque la frise, repasser à une couche météo la rétablit.
2. Niveau 8 au Rondônia : arêtes de poisson visibles ; à Bornéo : parcelles de plantation visibles.
3. Le dégradé jaune → rouge montre l'avancée du front (pertes récentes en rouge en lisière).
4. Le tooltip donne le couvert ou l'année de perte justes à l'endroit pointé.
5. Le crédit CC BY 4.0 est affiché quand Forest est active et dans About.
6. Stockage R2 mesuré et ≤ 10 Go, au besoin avec le repli tropical (sinon décision de
   l'utilisateur consignée).
7. Les 4 pages répondent, figurent au sitemap (25 URLs) et au tiroir.
8. Téléphone de 412 px : légende double lisible, rien ne masque les contrôles.
9. Tests et `history_check` verts ; bundle sous le plafond relevé.
