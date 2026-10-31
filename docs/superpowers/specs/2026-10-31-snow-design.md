# Lot R5a — couche neige (chutes prévues et épaisseur au sol)

Statut : conception, brainstorming du 2026-10-31. La forêt (couvert + pertes, tuiles fines au zoom)
fera l'objet d'un lot distinct, R5b, brainstormé après celui-ci.

## 1. Intention

L'utilisateur a demandé une couche neige le 2026-10-24 (HISTORY §8, R5). L'hiver arrive dans
l'hémisphère nord, et « snow forecast » fait partie des requêtes météo les plus cherchées en
anglais l'hiver, surtout pour les stations de ski. La couche doit répondre à deux questions de
visiteur : **combien de neige va tomber d'ici telle heure ?** et **où y a-t-il de la neige au sol ?**
Elle sert aussi le chantier audience : une page couche et trois pages régions supplémentaires, sur
le modèle du lot G.

## 2. Objectifs

1. Une entrée **Snow** dans le menu des couches, avec **deux modes** : **Snowfall** (par défaut) et
   **Depth**, choisis par un sélecteur à deux positions placé avec la légende.
2. **Snowfall** : cumul de neige prévu, en cm, de l'heure du run jusqu'à l'échéance affichée sur la
   frise ; les zones enneigées grossissent quand on avance la frise.
3. **Depth** : épaisseur de neige au sol, en cm, à l'échéance affichée.
4. Comme les autres couches : frise de 48 h (f003 → f060, pas de 3 h), fondu entre échéances,
   tooltip et étiquettes de villes avec la valeur du mode actif, capture d'image, adresse partageable.
5. Quatre pages d'entrée : `/snow-map/` et trois pages régions — **Alpes**, **Rocheuses (Colorado,
   Utah)**, **Japon (Hokkaido, Niseko)** — avec image Open Graph, présentes au sitemap et au tiroir ☰.

## 3. Non-objectifs

- La forêt / déforestation (lot R5b).
- La neige en pouces ou toute bascule d'unités (le site est métrique).
- Un cumul qui part exactement de « maintenant » (voir §5.2).
- La couverture neigeuse satellite, la neige fraîche observée, les bulletins d'avalanche.

## 4. Anti-objectifs (ce qui rendrait le lot raté même s'il « marche »)

- Des chutes fausses d'un ordre de grandeur (unités, ratio, cumul compté deux fois après une reprise).
- Une couche « Depth » qui peint l'Antarctique et le Groenland d'une couleur saturée qui écrase tout
  le reste de la légende.
- Une reprise du pipeline (run incomplet complété au passage suivant) qui casse le cumul.
- Le sélecteur de mode illisible ou qui masque la frise sur un téléphone de 412 px.

## 5. Décisions

### 5.1 Prises par l'utilisateur (2026-10-31)

| Décision | Choix |
|---|---|
| Contenu | Les deux : chutes à venir **et** épaisseur au sol |
| Présentation | **Une seule couche, deux modes** (pas deux entrées de menu) |
| Mode Snowfall | **Cumul jusqu'à l'instant** choisi sur la frise (pas une intensité en cm/h) |
| Mode par défaut | **Snowfall** |
| Pages | `/snow-map/` + pages régions **Alpes, Rocheuses/USA, Japon** (pas la Scandinavie) |
| Ordre | Neige d'abord, forêt ensuite (lot séparé) |
| Échec propre à la neige | **Neige isolée** : un champ neige manquant ou aberrant n'empêche jamais la publication des autres couches GFS ; la neige garde alors son run précédent (comportement de `gefs_chem` aujourd'hui) |
| Grandes épaisseurs (Depth) | **Dégradé détaillé de 1 cm à ≈ 3 m** (neige saisonnière lisible), puis une **bande « neige profonde »** de teinte distincte qui s'intensifie jusqu'aux dizaines de mètres (calottes, glaciers) ; le tooltip donne toujours la vraie valeur |
| Ratio et origine du cumul | Validés avec le résumé de brainstorming (ratio 10:1, cumul depuis le début de la série) |

### 5.2 Mes choix

- **Origine du cumul = heure du run** (f000). La légende l'indique : « Snowfall since Sat 00:00 »,
  en heure locale du visiteur, comme la frise. Raison : partir de « maintenant » imposerait de
  soustraire deux textures 8 bits côté navigateur (perte de précision) ; partir de f003 donnerait
  une première image vide. Le run a ≈ 4–6 h quand il est publié, donc le cumul inclut quelques heures
  passées, ce que la légende dit.
- **Ratio neige/eau 10:1** (1 mm d'eau = 1 cm de neige), convention courante des sites grand public.
- **Unité : cm**, une décimale sous 10 cm, entier jusqu'à 1 m, puis en mètres (« 7.4 m », « 32 m »).
- **Transparence** sous un seuil (≈ 0,5 cm de chutes, ≈ 1 cm au sol), comme la pluie.
- **Deux couches dans le manifeste**, `snowfall` et `snow_depth`, regroupées en une entrée de menu
  côté front. Le mode n'est donc pas un nouveau paramètre d'URL : c'est la couche
  (`?layer=snowfall` / `?layer=snow_depth`). Cela remplace l'idée `?mode=depth` évoquée en
  brainstorming, plus simple et sans nouveau contrat.
- **Vent éteint par défaut** sur les quatre pages neige, comme la plupart des pages du lot G.

## 6. Données (pipeline)

Tout vient du flux GFS déjà téléchargé (`filter_gfs_0p25_1hr.pl`), aucune nouvelle source.
Champs vérifiés le 2026-10-31 dans l'index réel `gfs.t00z.pgrb2.0p25.f00{6,7,9}.idx` :

| Champ | Message GRIB | Usage |
|---|---|---|
| `SNOD` surface | instantané, m | Depth : × 100 → cm |
| `APCP` surface | **deux** messages : bucket (`6-9 hour acc`) et continu (`0-9 hour acc`) ; à f006 les deux sont `0-6` | Snowfall : prendre le **continu** (`startStep = 0`) |
| `CPOFP` surface | instantané, % de précipitation gelée ; **−50 là où il ne précipite pas** (valeur sentinelle à traiter) | part neigeuse |
| `CSNOW` surface | instantané et moyenne du bucket | alternative/contrôle de la part neigeuse |

`ASNOW` (cumul de neige tout prêt) n'est **pas** dans le flux horaire 0,25°.

**Calcul des chutes, par échéance `fh` de la frise :** incrément d'eau
`ΔP = APCP(0→fh) − APCP(0→fh−3)` (mm), part gelée `f` dérivée de `CPOFP` (sentinelle → 0, ramenée
à 0–1), incrément de neige `ΔP × f × 10` mm → cm ; cumul `S(fh) = Σ` des incréments de f003 à fh.
Le choix exact de `f` (CPOFP à `fh`, moyenne des deux bornes, ou `CSNOW` moyenné) revient au
constructeur, qui le justifie sur un run réel (comparer, sur une zone froide qui neige, le cumul
obtenu à la hausse de `WEASD`).

**Contrainte de reprise.** `_fill_run` (`pipeline/main.py`) publie les échéances une par une et
reprend un run inachevé au passage suivant en sautant celles déjà faites. Le cumul de `fh` dépend de
toutes les échéances précédentes, en flottant. Le constructeur choisit comment garder ce cumul exact
à travers une reprise, par exemple :
- (a) un état privé non publié par run sur R2 (cumul flottant de la dernière échéance faite) ;
- (b) au besoin, re-télécharger `APCP`/`CPOFP` seuls des échéances déjà faites pour recalculer ;
- **jamais** relire le PNG 8 bits publié pour en déduire le cumul (l'erreur de quantification
  s'accumulerait).
Un test doit couvrir « run interrompu après f021, repris » → cumul identique à un run d'une traite.

**Encodage 8 bits.** Les épaisseurs réelles vont de quelques cm à plusieurs mètres en montagne et à
des dizaines de mètres sur les calottes polaires (remarque de l'utilisateur, 2026-10-31) : une borne
à 3 m est exclue. Point de départ, en échelle `sqrt` existante (aucun nouveau code d'encodage) :
`snow_depth` `Encoding(0, 5000, "sqrt")` cm — pas ≈ 0,8 cm vers 5 cm, ≈ 5 cm à 1 m, ≈ 10 cm à 3 m,
≈ 18 cm à 10 m, ≈ 40 cm à 50 m ; `snowfall` `Encoding(0, 500, "sqrt")` cm (cumul sur 60 h, les
épisodes extrêmes de neige d'effet de mer au Japon dépassent 2 m). **Première tâche du plan :
mesurer `SNOD` sur un run réel** (Antarctique, Groenland, Alpes, Himalaya) — valeurs réalistes ou
plafond fictif du modèle — puis fixer la borne haute au-dessus du maximum observé avec marge, pour
que le tooltip donne toujours une vraie valeur. Bornes plausibles brutes larges : saturer est
toléré, rejeter le run ne l'est pas (et un rejet n'affecte que la neige, voir ci-dessous).

**Isolement des échecs (§5.1).** Aujourd'hui toute exception dans `_fill_run` devient
`SourceFailure(EXIT_DATA)` et fait reporter **toute** la source `gfs`. La neige ne doit pas suivre ce
chemin : un échec de décodage, un champ absent ou un cumul invalide à une échéance laisse
`snowfall`/`snow_depth` sur leur entrée du manifeste courant pendant que les autres couches GFS
publient leur run neuf. Le mécanisme (source dérivée séparée, étape à part, garde-fous dans `gfs`)
revient au constructeur ; un test couvre « champ neige absent → temp/vent publiés, neige reportée ».
Le fichier de progression par run (`progress_key`) existe déjà sur R2 et peut porter l'état du cumul.
Le registre Python associe aujourd'hui une couche à un message GRIB : `snowfall` est une **couche
dérivée** (plusieurs messages, état entre échéances), notion à introduire.

Les deux couches suivent le contrat v3 existant (`layers/forecast.json`, PNG
`layers/<run>/<couche>_f<fh>.png`), sans changement de schéma.

## 7. Front

- **Registre** `web/src/layers/registry.ts` : deux `LayerDef`, `snowfall` et `snow_depth`, palette
  propre à la neige (blancs bleutés → bleus → violets pour les gros cumuls ; doit rester lisible sur le
  fond satellite clair des glaciers et sur la carte claire au zoom). Pour `snow_depth`, l'essentiel
  des arrêts de couleur entre 1 cm et ≈ 3 m, puis une bande « neige profonde » de teinte distincte
  jusqu'à la borne haute (§5.1) ; graduations de légende non linéaires (ex. 10 cm, 50 cm, 1 m, 3 m,
  10 m+), la légende étant déjà construite à partir des valeurs physiques des arrêts.
- **Menu** : une seule entrée « Snow » ; la choisir sélectionne `snowfall`.
- **Sélecteur de mode** « Snowfall | Depth » avec la légende quand une des deux couches est active ;
  il bascule entre les deux couches en gardant l'instant de la frise, la caméra et le vent.
  Sur téléphone (légende verticale collée au bord), le placement est au constructeur, validé à 412 px
  sans masquer la frise.
- **Légende Snowfall** : mention de l'origine du cumul (§5.2). Chaînes en anglais dans
  `web/src/i18n/en.ts`.
- **Tooltip / étiquettes** : « 12 cm » ; « — » sous le seuil de transparence.
- **Capture d'image** : la légende capturée porte le mode et l'origine du cumul.

## 8. Pages

Quatre entrées dans `web/src/pages/registry.ts`, même forme que le lot G (titre, description, h1,
résumé, « Read more » de 3–4 paragraphes, `related`, image OG `og/<slug>.jpg`) :

| Slug (proposé) | Couche | Vue (point de départ, à ajuster en validation) |
|---|---|---|
| `snow-map` | `snowfall` | vue par défaut |
| `alps-snow-forecast` | `snowfall` | lon 10, lat 46, d ≈ 1,6 |
| `rocky-mountains-snow-forecast` | `snowfall` | lon −108, lat 40, d ≈ 1,7 |
| `japan-snow-forecast` | `snowfall` | lon 142, lat 43, d ≈ 1,7 |

Textes rédigés par Claude, en anglais, relus par l'utilisateur avant le merge (comme au lot G).
Images OG : captures fixes ; demander l'accord de l'utilisateur avant d'ouvrir le globe (RAM 1–2 Go).
Les pages couche existantes peuvent pointer vers `/snow-map/` dans `related` (au constructeur).

## 9. Contraintes

- Pipeline : run neuf encore dans `timeout-minutes: 30` (≈ 4,5 min aujourd'hui) ; le surcoût de
  téléchargement (3–4 champs de plus par échéance) est mesuré au dry-run.
- Bundle : plafond actuel 186,02 Ko gzip ; relèvement accepté pour les textes des 4 pages et le
  sélecteur, chiffré et justifié dans HISTORY §5.
- Fixtures GRIB réelles : une nouvelle fixture neige (comme `gfs_wind.grib2`), pas de recommit des
  existantes.
- Tests : pytest (calcul des chutes, sentinelle CPOFP, choix du message APCP continu, reprise),
  vitest (registre, menu, sélecteur, adresse, pages, sitemap à 21 URLs).
- Commits, code interne et HISTORY en français ; site en anglais. HISTORY à jour avant le push
  (la CI bloque sinon).
- Validation navigateur sous Brave, avec l'accord de l'utilisateur, sur un run réel publié depuis la
  branche avant merge (méthode des lots précédents).

## 10. Laissé au constructeur

Méthode exacte de la part gelée, mécanisme de reprise du cumul, mécanisme d'isolement des échecs, bornes d'encodage finales, palette,
placement mobile du sélecteur, textes des pages (puis relecture utilisateur), découpage du plan.

## 11. Critères d'acceptation

1. Le menu montre une entrée Snow ; elle ouvre Snowfall ; le sélecteur bascule vers Depth et retour.
2. Sur un run réel où il neige (Rocheuses, Alpes, Sibérie à cette saison), le cumul Snowfall
   croît de façon monotone le long de la frise et reste du bon ordre de grandeur face à la hausse
   de `WEASD`.
3. Un run interrompu puis repris donne exactement les mêmes PNG qu'un run d'une traite ; un champ
   neige absent n'empêche pas la publication des autres couches GFS.
4. Depth : la neige saisonnière (1 cm–3 m) reste lisible dans le dégradé, les calottes apparaissent
   dans la bande « neige profonde », et le tooltip y donne la valeur réelle (pas de saturation).
5. `?layer=snowfall` et `?layer=snow_depth` ouvrent le bon mode ; les 4 pages répondent, sont au
   sitemap (21 URLs) et au tiroir.
6. Sur téléphone de 412 px, légende + sélecteur + frise restent utilisables.
7. Tests et `history_check` verts, bundle sous le plafond relevé.
