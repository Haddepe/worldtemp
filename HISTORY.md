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
| Pipeline de données | Python 3.11+ | `xarray`, `cfgrib` (exige `eccodes`), `numpy`, `Pillow`, `requests` |
| Source de données | NOMADS / GFS 0,25° (NOAA) | script de filtrage `filter_gfs_0p25.pl`, variable `TMP` à 2 m |
| Frontend | Vite + Three.js | vanilla, shaders GLSL custom, pas de framework lourd |
| Sortie | Fichiers statiques (PNG + JSON) | **aucun serveur applicatif** |
| Hébergement | Statique + CDN ; pipeline en cron | cible non encore tranchée (VPS ou CI planifiée) — voir §8 |
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
tools/
  history_check.py             # contrôle mécanique de HISTORY.md contre le dépôt
tests/
  test_history_check.py        # 30 tests unittest de la logique du contrôle
HISTORY.md                     # ce document
.gitattributes                 # LF partout, quelle que soit la config git locale
.gitignore
```

Aucun code applicatif n'est encore écrit : ni `pipeline/`, ni `web/`.

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
| **Plage de température FIXE [-90 °C, +60 °C]**, encodée 8 bits (`pixel = (T+90)/150*255`) | Une plage dynamique obligerait le shader à lire des métadonnées par frame. La plage fixe couvre les records mondiaux (Vostok ≈ -89 °C, Vallée de la Mort ≈ +57 °C) au prix de ~0,59 °C par niveau. **Source de vérité unique**, à recopier avec commentaire croisé dans `grib_to_texture.py`, les shaders et `colormap.js`. |
| **ShaderMaterial custom dès la Phase 2**, même trivial | Tout le projet finit dans ces shaders. Partir d'un matériau standard imposerait une migration au moment précis où la scène devient complexe. |
| **Colormap en LUT 1D (texture 256 × 1)**, pas de rampe codée en dur | Changer de palette sans toucher au shader, et une seule source de vérité entre le rendu et la légende. |
| **Arrêts de couleur concentrés entre -45 °C et +45 °C** | 99 % des pixels y vivent. Une rampe linéaire sur toute la plage rendrait la carte terne au quotidien pour couvrir des extrêmes qui n'apparaissent presque jamais. |
| **Le tier `low` est un citoyen de première classe**, testé régulièrement via `?tier=low` | Un fallback qu'on ne regarde jamais se dégrade en silence. La normal map est conservée en `low` : c'est elle, pas la densité de maillage, qui porte la qualité perçue. |
| **Détection GPU par faisceau d'indices**, jamais un seul signal | `WEBGL_debug_renderer_info` est souvent masqué, `hardwareConcurrency` ment sur mobile, le micro-benchmark coûte des frames. Aucun n'est fiable seul ; le paramètre d'URL permet de forcer pour tester. |
| **Le pipeline ne casse jamais le site** : sur échec NOMADS, la dernière texture valide reste en place | Une panne côté fournisseur ne doit pas se voir côté visiteur. Écriture atomique (temporaire + rename) et idempotence pour la même raison. |
| **Ordre strict des phases**, critères d'acceptation validés visuellement avant de continuer | Le rendu 3D se débogue mal en couches empilées : un artefact de la Phase 4 est indiscernable d'un artefact de la Phase 5 si les deux arrivent ensemble. |
| **`history_check` en Python stdlib**, pas en TypeScript *(2026-08-29)* | Le portage TS depuis le projet d'origine imposait un `package.json` + `node_modules` à la RACINE (tsx, typescript, vitest) juste pour vérifier un document — en plus du `node_modules` de `web/`. La version stdlib tourne sur un dépôt nu, et Python est déjà la Phase 1. |
| **Les dossiers surveillés par le contrôle sont dérivés de `git ls-files`**, pas du disque | Le gitignoré (`node_modules/`, `.venv/`, `web/public/data/`) n'est jamais réclamé au document, et une racine encore vide ne produit aucun bruit. La version d'origine lisait le disque et devait exclure des dossiers en dur. |

## 6. Problèmes rencontrés & solutions

*(Aucun pour l'instant — cette section se remplit au fil des sessions. Y consigner
les défauts non triviaux, surtout ceux trouvés par une revue plutôt que par un
test : ce sont eux qui se reproduisent.)*

## 7. Historique par plan (chronologie)

| Date | Plan / branche | Statut | Merge | Tests |
|---|---|---|---|---|
| — | *(aucun plan livré à ce jour)* | — | — | — |

## 8. Dette technique connue

| # | Dette | Impact | Statut |
|---|---|---|---|
| 1 | **Cible d'hébergement non tranchée** — VPS avec cron, ou CI planifiée déposant sur un CDN | Bloque la Phase 7 ; influe sur la fréquence réelle du pipeline | 🔴 ouvert |
| 2 | **`cfgrib` exige `eccodes`**, binaire natif à installer hors pip | Rend l'environnement de dev non reproductible par `pip install` seul ; à documenter en §2 dès la Phase 1 | 🔴 ouvert |
| 3 | **Encodage température dupliqué en trois endroits** (Python, GLSL, JS) sans garde mécanique | Une plage modifiée d'un seul côté produit une carte fausse mais plausible — le pire mode d'échec | 🔴 ouvert, à surveiller dès la Phase 5 |
| 4 | **Aucune source de heightmap fixée** — ETOPO 2022 ou heightmap NASA prête à l'emploi | Bloque la Phase 4 ; le choix conditionne le script de préparation et la profondeur de bits | 🔴 ouvert |
| 5 | **Pas de CI** : les 30 tests ne tournent qu'à la main | Une régression du contrôle de document passe inaperçue | 🟡 acceptable tant que le dépôt est mono-utilisateur |

## 9. État actuel & prochaine action

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

**Dernière mise à jour :** 2026-08-29 (**amorçage du dépôt** — `git init`, plan déplacé en `docs/PLAN.md`, skill `updating-history` + `tools/history_check.py` installés, 30 tests verts, aucun code applicatif)
