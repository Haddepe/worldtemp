---
name: updating-history
description: Use when updating HISTORY.md after a session, a plan execution, or any change to the site/app. Derives the sections to touch from the session's actual diff instead of relying on memory, then verifies the result. Triggers on "met à jour HISTORY", "update HISTORY", "mets l'historique à jour", or the end of any plan execution.
---

# Mettre à jour HISTORY.md

`HISTORY.md` est la trace de continuité du projet. Deux dérives le guettent, et
elles sont **structurelles, pas un manque de sérieux** :

- **§3 est la seule section « état courant »** d'un document par ailleurs
  append-only. Les autres accumulent des entrées datées dont le passé reste vrai ;
  §3, elle, se périme à chaque commit sans que rien ne le signale.
- **On écrit spontanément l'entrée §9**, qui est narrative et intéressante, puis on
  s'arrête. Les sections structurelles ne réclament rien.

D'où cette procédure : **partir du diff, pas de la mémoire.**

## Procédure

### 1. Établir le périmètre réel de la session

```bash
git log --oneline <base>..HEAD          # <base> = main avant la session, ou le dernier merge
git diff --stat <base>..HEAD
```

Ne pas se fier au souvenir de ce qui a été fait. Le diff est la source.

### 2. Dériver les sections à toucher

Pour chaque type de changement observé dans le diff, la ou les sections qu'il
**force**. Une entrée §9 seule n'est jamais suffisante dès qu'il y a du code.

| Ce que montre le diff | Sections obligatoires |
|---|---|
| Fichier créé, supprimé ou déplacé | **§3** (arbre) |
| Nouveau dossier sous `pipeline/`, `web/src/`, `tools/` | **§3** |
| Étape ajoutée/retirée du pipeline GFS, ou du chemin de rendu | **§3** |
| Dépendance Python ou npm, script, service externe, source de données | **§2** |
| Choix d'architecture, arbitrage tranché, décision utilisateur | **§5** (avec le POURQUOI, pas seulement le quoi) |
| Défaut non trivial rencontré, surtout trouvé par une revue | **§6** |
| Phase du plan livrée / branche mergée | **§7** (une ligne : date, nom, statut, commit de merge, nb de tests) |
| Dette créée **ou résolue** | **§8** (ajouter ; et rayer/marquer résolu ce qui l'est) |
| Toute session, sans exception | **§9** (entrée datée, nb de tests, état du build, prochaine action) |
| Nouvelle section `## N.` | **Sommaire** |

**§8 dans les deux sens.** Retirer la dette résolue compte autant que noter la
nouvelle : une dette marquée « NON résolu » alors qu'elle est fermée depuis des
semaines envoie le lecteur suivant sur une fausse piste.

**§3 décrit ce qui EXISTE, jamais ce qui est prévu.** L'arbre cible du projet vit
dans `docs/PLAN.md`. Un fichier planifié écrit en §3 est un fichier fantôme, et
c'est précisément ce que l'étape 4 signale.

### 3. Écrire

- Style : dense, factuel, en français, tableaux courts. Les détails longs vivent
  dans les specs et les plans ; y renvoyer plutôt que recopier.
- Ne jamais dupliquer du code dans le document : décrire le quoi et le pourquoi,
  pointer les fichiers.
- Une affirmation vérifiable (nombre de tests, sha de merge, chemin de fichier) se
  **vérifie** avant d'être écrite. Une entrée fausse coûte zéro à écrire et se
  paie plus tard.

### 4. Vérifier

```bash
python tools/history_check.py
```

Compare mécaniquement le document au dépôt :

- fichiers cités en §3 dont plus aucun chemin du dépôt ne se termine ainsi ;
- dossiers de code que §3 ne nomme jamais (dérivés de `git ls-files`, donc le
  gitignoré n'est jamais réclamé) ;
- merges de branche sans ligne au tableau §7 ;
- pied de page « Dernière mise à jour » en retard sur le dernier commit ayant
  touché `HISTORY.md`.

Le contrôle sort en 1 tant qu'il reste un écart. Il ne couvre pas §2, §5, §6, §8
et §9 : c'est l'étape 2 qui les couvre, et elles relèvent du jugement.

⚠️ Le contrôle du pied de page a une **latence d'un commit**, assumée : il compare
au dernier commit du document et non à la date du jour, ce qui le garde
déterministe et évite un rouge sur chaque coquille corrigée. Concrètement,
**penser à bumper le pied de page dans le même commit** que la mise à jour —
sinon l'écart n'apparaîtra qu'à la session suivante.

Les tests de la logique du contrôle : `python -m unittest discover -s tests`.

### 📐 Forme du pied de page : UNE ENTRÉE PAR LIGNE

Le pied de page est une **chaîne** de sessions : `**Dernière mise à jour :**` en
tête, puis un `**Entrée précédente :**` par session passée. **Chaque entrée occupe
sa propre ligne.**

Pour le mettre à jour, une seule opération : **insérer la nouvelle entrée en tête
et rétrograder l'ancienne** en `**Entrée précédente :**`. Concrètement, ancrer
l'édition sur le **préfixe** de la première ligne :

```
old: **Dernière mise à jour :** <date> (**<titre de l'entrée en place>**
new: **Dernière mise à jour :** <nouvelle date> (**<nouveau titre>** … )
     **Entrée précédente :** <date> (**<titre de l'entrée en place>**
```

⛔ **Ne jamais réécrire la chaîne entière, ne jamais l'élaguer.** Les vieilles
entrées sont la trace ; elles ne coûtent rien et personne ne les relit en bloc.

**Pourquoi une entrée par ligne** *(leçon importée d'un projet précédent, où la
chaîne avait atteint 34 Ko sur UNE seule ligne)* : git diffe **par ligne**.
Toucher un caractère d'une ligne de 34 Ko rapporte « ligne supprimée, ligne
ajoutée » — donc **le même diff pour une coquille corrigée et pour une chaîne
effacée**. Mesuré là-bas sur une mise à jour simulée : **72,8 Ko de diff imprimé
avant, 10,9 Ko après**. Le rendu est identique, un saut de ligne simple valant un
espace en Markdown.

⚠️ **Ce document est en LF**, comme le reste du dépôt. Tout script qui le réécrit
doit en émettre aussi, sinon git rapporte le **fichier entier** comme modifié.
Pour relire un diff de pied de page : `git show <sha> --word-diff -- HISTORY.md`.

## Contenir le coût en contexte

Un `HISTORY.md` mûr devient cher à lire : compter environ **2,3 caractères par
token** (du français accentué truffé de gras, de backticks et d'emoji se
fragmente deux fois plus que de l'anglais nu). Trois règles en découlent — les
deux premières s'appliquent dès maintenant, la troisième quand le document aura
grossi.

**① UNE SEULE PASSE, EN FIN DE SESSION.** Rédiger l'entrée §9 une fois, quand le
travail est fini et que l'histoire est connue — pas à chaque étape. Une session
qui écrit au fil de l'eau réécrit les mêmes paragraphes cinq fois : mesuré sur un
projet précédent, **22 K tokens d'éditions au lieu des ~8 K** qu'aurait coûté une
passe unique. Exception : une session longue avec risque réel d'interruption, où
une trace intermédiaire vaut mieux que rien.

**② LIRE PAR SECTION, JAMAIS EN ENTIER.** Passer par le sommaire, puis `Read` avec
`offset`/`limit` sur la seule section utile. Relever le coût des grosses sections
dans le document lui-même dès qu'il dépasse quelques dizaines de Ko.

**③ ARCHIVER §9 AU-DELÀ D'UNE DIZAINE D'ENTRÉES.** Les vieilles entrées vont dans
`docs/history-archive.md`, **déplacées telles quelles** — jamais résumées, jamais
élaguées. Couper sur une **date** (celle où commence le flux de travail courant) et
non sur un compte : une frontière datée se justifie et se retrouve sans compter.
Laisser le pointeur `- 📦 **Entrées antérieures au …**` en fin de §9 et
`**Entrées antérieures :**` en fin de pied de page. Même traitement pour le pied.

## Signes que la mise à jour est incomplète

| Symptôme | Ce qu'il faut faire |
|---|---|
| « J'ai ajouté l'entrée §9, c'est fait » | Rejouer l'étape 2 : du code a-t-il bougé ? Alors §3 et §7 au minimum. |
| Un fichier a été supprimé mais §3 n'a pas été rouverte | §3 documente alors un fichier fantôme, ce qui est pire que de ne rien documenter. |
| Une décision a été prise sans que son pourquoi soit écrit | §5. Le quoi se relit dans le code ; le pourquoi se perd. |
| `python tools/history_check.py` n'a pas été lancé | Le lancer. C'est le seul contrôle qui échoue bruyamment. |
