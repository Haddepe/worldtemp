# Spec — Curseur temporel des prévisions sur 48 h (lot E)

**Date :** 2026-09-27 · **Statut :** validée en brainstorming, à planifier
**Périmètre :** pipeline (`pipeline/`, `.github/workflows/pipeline.yml`, `test.yml`), contrat
R2 des couches (`layers/`), front (`web/`).
**Aucun changement** des tuiles image (`sat`/`map`), des données `geo/`, du registre des couches
(variables, conversions, encodages), ni des paramètres d'URL existants (`layer`, `wind`,
`labels`, `rivers`, `lon`, `lat`, `d`, `tier`).

## 1. Objectif

Feuille de route HISTORY §8, lot E (ligne R3). Aujourd'hui le globe montre **une seule
échéance** : celle valide à l'heure courante, republiée chaque heure. Ce lot en fait un outil de
prévision : **toutes les couches sur les 48 prochaines heures**, parcourues par un **curseur**
et animées par un bouton **lecture**, avec un **fondu interpolé** entre échéances (couches
scalaires, vent, valeurs du tooltip et des étiquettes).

## 2. Décisions (validées par l'utilisateur le 2026-09-27, ne pas rouvrir)

| Décision | Pourquoi |
|---|---|
| **Curseur manuel + lecture/pause**, horizon **48 h** | Choix utilisateur : les deux usages (« quel temps demain à 15 h », « voir la météo bouger »). |
| **Pas de 3 h** (pas de 1 h ni de pas mixte) | 3× moins de téléchargements NOMADS et de données à précharger ; aligné sur GEFS-chem (pas natif 3 h) ; la fluidité vient du fondu interpolé côté GPU (pratique Windy / earth.nullschool). |
| **Échéances f003 → f060** (20 images par couche) | PRATE (moyenne) est absent à f000 ; « maintenant » vaut toujours au moins run + 3 h 30 ; aller à f060 garantit 48 h devant « maintenant » pendant toute la vie du run (jusqu'à ~12 h d'âge). |
| **Approche A : une frise complète par run, rangée par dossier de run** (pas de clés par heure de validité, pas de planche unique par couche) | Frise cohérente (un seul run à la fois par source), URLs immuables (cache `immutable`), rétention triviale ; les clés par heure de validité mélangeraient des runs (sauts visibles), une planche unique retarderait le premier affichage (~5 Mo). |
| **Nouvelle clé `layers/forecast.json` (schéma v3)** ; `latest.json` n'est plus écrit | Ne casse pas le parseur v2 des onglets ouverts sur l'ancien front ; déploiement sans trou (§8). |
| **Frise en bas, centrée** ; sur mobile, pleine largeur au-dessus de la légende | Choix utilisateur (maquette ASCII) ; convention des sites météo, à portée de pouce. |
| « Maintenant » **interpolé** entre deux échéances à 3 h d'écart | Compromis accepté : léger lissage d'un pic (p. ex. maximum de l'après-midi) par rapport à l'échéance horaire exacte d'aujourd'hui. |

## 3. Pipeline

### 3.1 Sélection : un run et sa frise

`run_selection` ne choisit plus « l'échéance valide maintenant » mais **le run le plus récent**
(délai de disponibilité par source inchangé : GFS 3 h 30, GEFS-chem 5 h ; jusqu'à 4 runs
candidats en remontant de 6 h en 6 h) et sa **liste d'échéances** `FRAME_HOURS = 3, 6, …, 60`
(constante unique dans `pipeline/config.py`, `FRAME_STEP_HOURS = 3`, `FRAME_FIRST = 3`,
`FRAME_LAST = 60`). `max_forecast_hour` des sources passe à au moins 60 (GFS : 48 → 60 ;
GEFS-chem : 84 inchangé). Fonction pure, sans I/O, comme aujourd'hui.

### 3.2 Téléchargement résumable

Pour chaque source, primaire (GFS) d'abord :

1. Si le manifeste courant cite déjà ce run **complet** pour toutes les couches de la source →
   rien à faire (sortie en quelques secondes, cas de 5 heures sur 6).
2. Sinon, lister sur R2 le préfixe `layers/<run>/` (nouvelle fonction `publish.list_keys`) ;
   pour chaque échéance dont **une couche au moins manque**, télécharger le GRIB (une requête
   NOMADS par échéance, toutes variables de la source, filtre existant), décoder, valider,
   encoder, et **envoyer immédiatement** ses PNG sur R2 sous
   `layers/<run>/<couche>_f<fh>.png` (`<run>` au format `YYYYMMDDTHHZ`, `<fh>` sur 3 chiffres).
   Téléchargements **séquentiels** (courtoisie NOMADS), reprise d'une erreur transitoire comme
   aujourd'hui (2 tentatives, `RETRY_DELAY_S`).
3. Une échéance **absente** (404 : run pas encore entièrement publié) arrête la source pour ce
   passage, sans erreur : les images déjà envoyées restent, le passage horaire suivant reprend
   là où il s'est arrêté.
4. **Le manifeste ne bascule sur le nouveau run d'une source que lorsque ses 20 échéances sont
   présentes sur R2 pour toutes ses couches.** D'ici là, le manifeste garde l'ancien run de
   cette source.

Si le run candidat le plus récent est incomplet et que le manifeste n'a encore **aucun** run
complet pour la source primaire (premier déploiement, §8), on essaie les candidats plus anciens
dans l'ordre (le premier run complet l'emporte).

### 3.3 Échecs et codes de sortie

- **GFS** (primaire) : run récent incomplet mais un run complet déjà publié → sortie `EXIT_OK`,
  ancien run conservé. **Aucun** run complet atteignable ni publié → `EXIT_SOURCE` (inchangé).
  Décodage/validation en échec → `EXIT_DATA` (inchangé), rien n'est basculé.
- **GEFS-chem** (secondaire) : tout échec → ses couches gardent l'entrée du manifeste courant
  (comportement actuel). Les deux sources peuvent donc être sur des runs différents ; leurs
  heures de validité restent sur la même grille de 3 h.
- Upload en échec → `EXIT_PUBLISH` (inchangé).

### 3.4 Workflow

- `pipeline.yml` : cron horaire **inchangé** (`12 * * * *`) ; `timeout-minutes` 15 → **30**.
  Un job coupé par le délai reprend au passage suivant (§3.2).
- Option `--max-frames N` du CLI (défaut : toutes). Le dry-run NOMADS réel de `test.yml`
  passe `--max-frames 1` pour ne pas allonger la CI.
- Artefact `out/` : inchangé (3 jours), contient ce qui a été écrit pendant le passage.

## 4. Contrat R2

### 4.1 Clés et cache

| Clé | Contenu | `Cache-Control` |
|---|---|---|
| `layers/forecast.json` | Manifeste v3 (§4.2) | `public, max-age=300` (comme aujourd'hui) |
| `layers/<run>/<couche>_f<fh>.png` | PNG 1440×721 niveaux de gris 8 bits, encodage inchangé | `public, max-age=31536000, immutable` |

### 4.2 Manifeste v3

```json
{
  "schema_version": 3,
  "generated_at": "2026-09-27T10:12:00Z",
  "grid": { "width": 1440, "height": 721, "lon_min": -180, "lon_max": 179.75,
            "lat_min": -90, "lat_max": 90, "lon_step": 0.25, "lat_step": 0.25 },
  "layers": {
    "temp": {
      "model": "gfs_0p25", "variable": "TMP_2m", "unit": "°C",
      "run": "2026-09-27T06:00:00Z",
      "generated_at": "2026-09-27T10:12:00Z",
      "encoding": { "bits": 8, "min": -60, "max": 55, "scale": "linear" },
      "frames": [
        { "forecast_hour": 3, "valid_time_utc": "2026-09-27T09:00:00Z",
          "texture": "20260927T06Z/temp_f003.png",
          "stats": { "min": -41.2, "max": 44.8 } }
      ]
    }
  }
}
```

(Valeurs illustratives ; `variable`, `unit`, `encoding` viennent du registre comme aujourd'hui.)

- `encoding` est déclaré **une fois par couche** : il est fixe par couche dans le registre, et
  c'est indispensable au fondu (mélange d'octets de même encodage).
- Chaque couche porte son propre `run` et son `generated_at` (heure de la bascule de ce run).
- `frames` est trié par `forecast_hour` croissant, 20 entrées, pas de 3 h.
- `texture` est relatif à `layers/`.
- `stats` par échéance (la légende affiche celles de l'échéance la plus proche de `t`).

### 4.3 Rétention

À chaque publication d'un manifeste, supprimer les dossiers `layers/<run>/` dont le run est
**strictement plus ancien que le plus ancien run cité par le manifeste précédent** (celui lu en
début de passage). Restent ainsi : le run courant, le run précédent (visiteurs dont le CDN sert
encore l'ancien manifeste pendant ≤ 300 s), et tout run en cours de téléchargement (plus récent,
cité nulle part). La rétention **ne touche que** les clés de la forme `layers/<run>/…` ; les
clés héritées (`layers/latest.json`, `layers/<couche>.png`) sont supprimées **à la main une
semaine après le déploiement** (à noter dans HISTORY §9).

Volume : au plus 3 runs × 20 échéances × 9 couches × ~250 Ko ≈ **135 Mo** (R2 : 4,5 Go / 10).
Opérations : ~180 écritures par run × 4 runs/jour ≈ 22 000/mois (quota gratuit classe A : 1 M).

## 5. Front : données et temps

### 5.1 Module `web/src/time/` (logique pure)

- État : instant `t` (ms UTC) et mode **`live`** (suit l'heure courante, mode au démarrage) ou
  **`fixed`** (choisi par l'utilisateur).
- `framePair(frames, t)` → `{ a, b, f }` : les deux échéances qui encadrent `t` et le facteur
  `f ∈ [0, 1]`. Hors de la plage d'une couche : première ou dernière échéance, `f = 0`, et un
  indicateur `clamped` (le statut dit « No forecast beyond <heure> for this layer », cas typique
  de GEFS-chem avec un run de retard).
- Plage de la frise : de **maintenant** (arrondi à l'heure inférieure) à la **dernière échéance
  GFS**, bornée à maintenant + 48 h. Les échéances antérieures à maintenant ne sont pas
  atteignables.
- Nouveau manifeste pendant la session : `t` est conservé **en heure absolue**, puis ramené dans
  la nouvelle plage. En mode `live`, `t` suit l'horloge (mise à jour chaque minute avec le
  bandeau).
- Tests unitaires purs (pas de DOM, pas de WebGL).

### 5.2 Parseur du manifeste v3

`web/src/data/manifest.ts` accepte le schéma **3** (clé `forecast.json`), valide `frames`
(non vide, trié, pas régulier, `texture` relative sans `..`), et rejette le v2. `config.ts` :
URL du manifeste → `layers/forecast.json`.

### 5.3 Stockage des échéances et mémoire

- Par échéance chargée, on garde **le seul canal R** dans un `Uint8Array` (1440×721 ≈ 1 Mo) au
  lieu du RGBA 4 Mo actuel (extraction à la lecture des pixels, le bitmap est fermé aussitôt).
- `clouds` (`soften`) : le tableau flouté est calculé au chargement et gardé **à côté** du brut
  (brut → tooltip/étiquettes, flouté → rendu).
- GPU : **deux textures `RedFormat` fixes (A et B)** par globe, réécrites (≈ 1 Mo chacune) quand
  la paire change. La mémoire GPU des couches devient constante quel que soit le nombre
  d'échéances.
- Cache : le `LayerCache` garde jusqu'à **2 couches** (profil `high`) ou **1** (profil `low`)
  avec **leurs échéances chargées** ; éviction = libération de toutes les échéances de la
  couche. Couche active épinglée comme aujourd'hui.
- Pire cas : 2 couches × 20 Mo + vent 20 × 2 Mo ≈ 80 Mo de mémoire CPU (profil `high`) ;
  ≈ 60 Mo (profil `low`).

### 5.4 Chargement progressif

1. **Démarrage** : seule la **paire qui encadre maintenant** est chargée (2 images au lieu
   d'une, ≈ +250 Ko). Premier affichage comparable à aujourd'hui.
2. **Premier contact avec la frise** (lecture ou déplacement du curseur) : chargement du reste
   des échéances de la couche active (et du vent s'il est affiché), en partant de `t` **vers
   l'avant** puis vers l'arrière, **3 requêtes simultanées** au plus.
3. **Changement de couche** en cours de session frise : d'abord la paire autour de `t`, puis le
   reste.
4. **Lecture** : si l'échéance suivante n'est pas encore chargée, l'animation **attend** (état
   « buffering », statut discret) au lieu de sauter.
5. Échec d'une échéance : réessai au prochain besoin ; tant qu'elle manque, la paire se replie
   sur l'échéance voisine chargée (`f = 0`), statut « Some forecast hours failed to load ».

## 6. Front : rendu et interpolation

### 6.1 Couches scalaires (shader `patch.frag.glsl`)

- Uniforms `uLayerA`, `uLayerB`, `uMix` (remplacent `uLayer`). L'octet est mélangé **avant**
  la LUT : `v = mix(sampleA, sampleB, uMix)` puis `texture2D(uLut, …)`. La palette et les
  isobares (calculées sur `v`) restent justes.
- Le Catmull-Rom (9 lectures) s'applique à chacune des deux textures ; **quand `uMix == 0.0`,
  une branche sur uniform saute la seconde série** : à l'arrêt sur une échéance exacte, le coût
  reste celui d'aujourd'hui.
- Encodage `sqrt` (rain, pm25, dust) : le mélange en espace encodé est une approximation
  visuelle acceptée ; les valeurs affichées (§6.2) sont exactes à l'interpolation linéaire près.

### 6.2 Valeurs CPU (tooltip, étiquettes)

- `sampleValue` lit A et B, **décode chacune**, puis interpole linéairement avec `f`.
- Étiquettes : le cache de valeurs par ville est invalidé quand `t` change ; pendant la lecture,
  rafraîchissement limité à **≈ 4 Hz**.
- Légende : `stats` de l'échéance la plus proche de `t`.

### 6.3 Vent

- `WindField` porte deux champs `uv` (A, B) et `f` ; `sampleUV` échantillonne les deux et
  interpole (pas d'allocation par particule). Les particules continuent **sans
  réinitialisation** quand la paire ou `f` change.
- Le `WindLoader` garde les champs `uv` par échéance (même politique de chargement que §5.4).

### 6.4 « Données anciennes »

Le seuil passe de « échéance valide il y a plus de 6 h » à « **run GFS de plus de 12 h** »
(`STALE_AFTER_MS` → `STALE_RUN_AFTER_MS`). En fonctionnement normal un run a au plus ~10 h.

## 7. Interface

### 7.1 Panneau `#timeline`

- Emplacement : en bas au centre, entre la légende et les couches ; sur mobile (règle media
  existante), ligne pleine largeur **au-dessus de la légende**.
- Contenu :
  - bouton **▶ / ⏸** (`aria-label` « Play forecast » / « Pause forecast », cible ≥ 44 px sur
    mobile) ;
  - `<input type="range">` natif, pas de **1 h**, de maintenant à la fin de la plage ;
    `aria-valuetext` du type « Sat 27, 15:00 (+3 h) » ;
  - libellé de l'instant choisi, en **heure locale** du navigateur (jour + heure) ;
  - bouton **Now** (retour au mode `live`), visible seulement en mode `fixed`.
- Lecture : **3 h par seconde** (48 h ≈ 16 s), boucle vers maintenant après **1 s** de pause en
  fin de frise ; déplacer le curseur met la lecture en pause ; aucune lecture automatique
  (`prefers-reduced-motion` respecté de fait).
- Bandeau : affiche l'instant choisi, p. ex. « run 06Z · valid Sat 15:00 · +9 h ».
- Le panneau se replie avec les autres (`#toggle-overlay`).

### 7.2 Textes

- Chaînes en anglais dans `web/src/i18n/en.ts` (garde-fou `english.test.ts`).
- Panneau About, `<meta name="description">`, `og:description`, JSON-LD : « updated hourly »
  et « forecast valid for the current hour » deviennent « 48-hour forecast, updated four times
  a day » (formulation exacte au plan).

### 7.3 Organisation du code

`main.ts` (488 lignes) ne doit pas absorber la frise : la logique de temps vit dans
`web/src/time/`, le panneau dans `web/src/ui/timeline.ts`, le stockage des échéances dans
`web/src/data/` ; `main.ts` ne fait que raccorder (`t` → paire → uniforms / tooltip / vent /
étiquettes).

## 8. Déploiement sans trou

1. Sur la branche `feat/timeline`, tests verts.
2. `gh workflow run pipeline.yml --ref feat/timeline` : publie `forecast.json` et le dossier du
   run courant (nouvelles clés). Le pipeline de `master` continue d'écrire `latest.json` et
   `layers/<couche>.png` pour le site en production, sans conflit de clés.
3. Vérifier `https://data.globelayers.com/layers/forecast.json` (20 échéances par couche).
4. Merge dans `master` → le front v3 se déploie sur des données déjà présentes ; le cron suivant
   tourne avec le nouveau code.
5. Une semaine plus tard : suppression manuelle de `layers/latest.json` et `layers/<couche>.png`.

## 9. Tests

### 9.1 pytest

- `run_selection` : run le plus récent et `FRAME_HOURS` ; délais par source.
- Reprise : échéances déjà présentes sur R2 sautées ; 404 en milieu de frise → arrêt sans
  erreur, manifeste non basculé.
- Bascule seulement à 20/20 ; premier déploiement sans run complet → candidat plus ancien.
- GEFS-chem en retard ou en échec → entrées reprises.
- Manifeste v3 (forme, tri, encodage par couche, `texture` relative).
- Rétention : règle « plus ancien que le plus ancien run du manifeste précédent » ; clés
  héritées jamais supprimées ; run en cours jamais supprimé.
- CLI `--max-frames`.

### 9.2 Vitest

- `time/` : `framePair` (bornes, `f`, `clamped`), plage, `live`/`fixed`, nouveau run.
- Parseur v3 (acceptation, rejets).
- Stockage des échéances : canal R seul, ordre de chargement (vers l'avant puis l'arrière),
  concurrence ≤ 3, éviction par couche, profil `low`.
- Globe : uniforms `uLayerA`/`uLayerB`/`uMix`.
- Interpolation : `sampleValue` sur deux échéances, `sampleUV` du vent.
- Contrôleur de frise : lecture, pause au déplacement, boucle, buffering, bouton Now.
- `english.test.ts` étendu aux nouvelles chaînes.

## 10. Validation et mesures (avec l'accord de l'utilisateur, RAM limitée)

- **Mesures réelles** : durée d'un passage complet du pipeline (run neuf), durée d'un passage
  « rien à faire », poids transféré pour une lecture complète d'une couche + vent, mémoire du
  processus navigateur en lecture.
- **Navigateur (Brave)** : démarrage identique à aujourd'hui, curseur, lecture fluide, fondu
  sans à-coup, vent continu, tooltip et étiquettes cohérents, GEFS-chem borné, aucune erreur
  GLSL ni console.
- **Téléphone** : frise à portée de pouce, lecture fluide, pas de rechargement de page pour
  cause de mémoire.

## 11. Critères d'acceptation

1. `forecast.json` v3 publié, 20 échéances f003–f060 par couche, images `immutable`.
2. Un run incomplet ne remplace jamais un run complet ; un passage coupé reprend au suivant.
3. Au plus 3 dossiers de run sur R2 ; clés héritées intactes jusqu'à suppression manuelle.
4. Premier affichage : 2 images de couche chargées, pas davantage.
5. Curseur de maintenant à +48 h au pas de 1 h ; lecture 3 h/s en boucle ; fondu continu.
6. Mémoire GPU des couches constante (2 textures R8) ; CPU ≤ ~80 Mo en profil `high`.
7. Tooltip et étiquettes affichent la valeur interpolée à `t`.
8. Tests pytest et Vitest verts ; `history_check` vert ; déploiement sans trou (§8).

## 12. Hors périmètre (à porter à la feuille de route si besoin)

- Paramètre d'URL `?t=` (partage d'un instant).
- Heures passées (analyse, observations).
- Horizon au-delà de 48 h, pas de 1 h.
- Décodage des PNG dans un worker (à reconsidérer seulement si les mesures §10 montrent des
  à-coups pendant le préchargement).
- Marques de jours sur la frise.
