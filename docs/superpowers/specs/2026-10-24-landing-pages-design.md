# Lot G — Pages de référencement par couche et par région, menu de navigation

Date : 2026-10-24 · Statut : conception, à valider par l'utilisateur · Chantier audience ③ (HISTORY §8)

## 1. Intention

Search Console : une seule page indexée (`/`), 0 impression en 28 jours. Le site ne répond à
aucune recherche réelle. Le lot G crée des **pages d'entrée indexables**, chacune ciblant une
recherche (« world temperature map », « Sahara dust forecast », « Antarctica temperature map »…),
qui **ouvrent directement le globe** réglé sur la bonne couche et la bonne vue.

Il pose aussi la **navigation du site** : un menu ☰ en tiroir, comme une appli, qui liste les
pages aujourd'hui et accueillera demain des articles (décision utilisateur : « on va avoir de plus
en plus d'articles »). Sur chaque page, un **résumé court** explique quoi regarder ; sur l'accueil,
il sert de **mode d'emploi** (couches, recherche de ville, About, curseur 48 h, capture…).

**Succès** (décision utilisateur) : les 17 URLs indexées dans Google Search Console et Bing
Webmaster, avec des impressions non nulles sous 4 à 6 semaines après déploiement.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- 16 nouvelles pages statiques + l'accueil retravaillé (§3), chacune avec son `<title>`, sa
  description, son canonical, son Open Graph, son JSON-LD et un texte rédigé, présents **dans le
  HTML servi** (pas injectés par JS seulement).
- Le globe démarre sur la couche et la vue de la page.
- Résumé visible (≈ 2 lignes) + « Read more » qui ouvre le texte complet dans un panneau.
- Menu ☰ en tiroir latéral, toujours accessible.
- L'adresse suit la couche (§5).
- Sitemap à 17 URLs (IndexNow les relaie déjà automatiquement : `tools/indexnow.py` lit le sitemap).

**Non-objectifs**
- Pas d'articles dans ce lot (le menu leur réserve une section, masquée tant qu'elle est vide).
- Pas de pages par ville, pas de génération massive.
- Pas de chiffres du run dans le texte (texte fixe « evergreen », décision utilisateur).
- Pas d'image Open Graph régénérée par le pipeline.
- Pas de nouvelle couche (neige, forêt/déforestation : demandées, notées en HISTORY R5 pour plus tard).
- Pas d'autre langue : site en anglais seul.

**Anti-objectifs** (échec même si ça « marche »)
- Promettre ce qu'on n'a pas : pas de « tracker », pas de trajectoire ni de nom de cyclone, pas
  d'« alerte ». Les pages ouragans/typhons expliquent comment *repérer* un système sur la carte
  vent + pression.
- Pages perçues comme du contenu mince ou dupliqué : chaque texte est propre à sa page.
- Ralentir ou alourdir l'ouverture du globe ; casser la capture, le partage, la vue dans l'URL.
- Masquer le globe : le résumé reste discret et refermable.
- Mettre « ma position » dans une URL (règle existante, garde 5°).

## 3. Les pages

Adresses en mot-clé dans le chemin (décision utilisateur), avec barre finale.

**Pages couche (8)** — vue par défaut du site (celle de l'accueil sans paramètres).

| Chemin | Globe | Recherche visée |
|---|---|---|
| `/temperature-map/` | `layer=temp` | world temperature map |
| `/wind-map/` | vent animé allumé, `layer=none` *(mon choix : le vent seul se lit le mieux ; à ajuster si moins joli)* | global wind map |
| `/cloud-map/` | `layer=clouds` | world cloud cover map |
| `/rain-map/` | `layer=rain` | world rain / precipitation map |
| `/pressure-map/` | `layer=pressure` | sea level pressure map |
| `/humidity-map/` | `layer=humidity` | humidity map |
| `/air-quality-map/` | `layer=pm25` | air quality / PM2.5 map |
| `/dust-forecast/` | `layer=dust` | dust forecast map |

**Pages région (8)** — couche + vue caméra (`lon`, `lat`, `d`) choisies à la main.

| Chemin | Globe | Recherche visée |
|---|---|---|
| `/sahara-dust-forecast/` | dust, Afrique du Nord / Atlantique est | Sahara dust forecast |
| `/europe-heatwave-map/` | temp, Europe | Europe heatwave / temperature map |
| `/atlantic-hurricane-map/` | pressure + vent, Atlantique tropical | hurricane wind map |
| `/pacific-typhoon-map/` | pressure + vent, Pacifique ouest | typhoon wind map |
| `/india-air-quality-map/` | pm25, sous-continent indien | India air quality map |
| `/antarctica-temperature-map/` | temp, centré sur le pôle Sud | Antarctica temperature map |
| `/arctic-temperature-map/` | temp, centré sur le pôle Nord | Arctic / North Pole temperature map |
| `/amazon-rainfall-map/` | rain, bassin amazonien | Amazon rainfall map |

Noms de chemins et cadrages exacts : à finaliser par le constructeur (vérifier au globe que la
vue est belle, notamment aux pôles : OrbitControls borne l'angle polaire à quelques epsilon du
pôle, la vue doit rester correcte). La Chine n'est pas visée (règle existante) : la page Inde
s'appelle Inde, même si la carte montre l'Asie.

**Accueil `/`** : reste la page générale (température, vue par défaut), titre actuel conservé,
avec le résumé « mode d'emploi » (§4).

**`/` et `/temperature-map/`** montrent le même globe (décision utilisateur : garder les deux,
**textes distincts**) : `/` parle du site et de son usage, `/temperature-map/` de la température.
Chacune a son propre canonical (pas de canonical croisé). Revenir à la température depuis le menu
des couches mène à `/temperature-map/` ; `/` reste joignable par le nom du site dans le tiroir et
par « How to use ».

## 4. Contenu de chaque page

- `<title>` et meta description propres (description 80–160 caractères, règle de `seo.test.ts`).
- `<h1>` visible (dans le résumé).
- **Résumé** : ≈ 2 lignes, ce que montre la carte et quoi y regarder. Sur l'accueil : mode
  d'emploi court (choisir une couche, chercher une ville 🔍, ma position 📍, capture 📷, curseur
  48 h, About ?).
- **Texte complet** (« Read more ») : 150–300 mots, anglais, rédigé par Claude, **relu par
  l'utilisateur avant merge**. Contenu : ce que mesure la couche, unité, source (NOAA GFS ou
  GEFS-Aerosols, résolution, 4 runs/jour, 48 h par pas de 3 h), comment lire la légende, ce qui
  est intéressant dans la région ou la couche. Rien d'inexact sur les sources.
- **Liens internes** : chaque panneau « Read more » se termine par des liens vers les pages
  voisines (même couche ↔ ses régions, et inversement) ; le tiroir liste tout.
- **Open Graph / Twitter** : titre, description, URL, image propres à la page.
- **JSON-LD** : un bloc par page, cohérent avec celui de l'accueil (`WebApplication`) ; le type
  exact pour les sous-pages (`WebPage` + `isPartOf`, ou autre) est laissé au constructeur.
- Le texte doit être **dans le HTML statique** servi pour l'URL : un robot sans JS voit titre,
  h1, résumé et texte complet.

**Images Open Graph** : une image 1200 × 630 par page (16 + l'actuelle `og.jpg` pour l'accueil),
capture fixe du globe sur la vue de la page, commitée, régénérée à la main si besoin. ⚠ Les faire
demande d'ouvrir le globe dans un navigateur : **demander l'accord de l'utilisateur avant**
(RAM du poste ≈ 1–2 Go, règle existante). En attendant les images, une page peut pointer sur `og.jpg`.

## 5. Comportement

**Démarrage** : la page fixe sa couche/vent/vue par défaut ; les paramètres d'URL explicites
(`?layer=`, `?lon=`…) priment, comme aujourd'hui (une vue partagée reste fidèle).

**L'adresse suit la couche** (décision utilisateur) :
- Changer de couche dans le menu des couches → l'adresse devient la page couche correspondante
  (`/temperature-map/` → `/rain-map/`), sans recharger ; `<title>`, h1, résumé et texte suivent.
- Depuis une page région, changer de couche → bascule vers la page couche correspondante.
- Faire tourner ou zoomer le globe → seuls `lon`/`lat`/`d` changent (comportement actuel), la page reste.
- Le vent : `/wind-map/` correspond à « vent allumé, aucune couche ». Choisir une couche depuis
  `/wind-map/` mène à la page de cette couche ; la règle fine (vent allumé par-dessus une couche
  = quelle page ?) est laissée au constructeur, en gardant : une combinaison couche/vent → une
  seule adresse canonique.
- **Vent par défaut** (décision utilisateur) : sur `/wind-map/`, `/atlantic-hurricane-map/` et
  `/pacific-typhoon-map/`, le vent est **allumé quel que soit le tier** (le tier `low` garde son
  nombre réduit de particules, `web/src/wind/select.ts`) **sauf** si « réduire les animations »
  est actif : alors il reste éteint et le résumé invite à l'allumer (« turn on Wind… »). Un
  `?wind=` explicite prime. Toutes les autres pages, accueil compris, gardent la règle actuelle.
- Les autres paramètres existants (`labels`, `rivers`, `wind`, `tier`, l'échéance…) gardent leur
  comportement actuel.
- **Mon choix** : les liens du tiroir et de « Read more » naviguent **sans recharger** le globe
  (historique du navigateur, bouton retour qui fonctionne), la page région déclenche le vol animé
  existant vers sa vue. Ce sont aussi de vrais liens `<a href>` (robots, ouverture dans un nouvel
  onglet). Si le constructeur juge le rechargement complet nettement plus simple et sans coût
  visible, il peut le proposer.

**Place du résumé** (décision utilisateur, maquette ASCII choisie en conversation, aucune
maquette graphique n'existe) : **collé sous le bandeau, en haut à gauche** — h1, ≈ 2 lignes,
lien « Read more », ✕ à droite. Sur mobile, même endroit en pleine largeur. Il ne doit recouvrir
ni la légende ni la frise ; s'il pousse le globe, le globe reste visible (le constructeur ajuste
le décalage existant de `setViewOffset` si besoin et vérifie au téléphone).

```
┌─────────────────────────────────┐
│ ☰ GFS run 06Z  🔍 📍 📷 ? ▾     │
│ Sahara dust forecast        ✕   │
│ Dust plumes over the Atlantic…  │
│ Read more                       │
│            .--.          legend │
│         |  globe  |             │
│            '--'                 │
│ [▶ ────── frise 48 h ──────]    │
└─────────────────────────────────┘
```

**Résumé refermable** (décision utilisateur) : ✕ le masque ; le choix est retenu sur l'appareil
(stockage local, protégé par try/catch, le site marche sans) et vaut pour **toutes** les pages.
Le h1 reste présent dans le HTML même résumé masqué. Un moyen de le rouvrir existe (depuis le tiroir).

**Tiroir ☰** (décision utilisateur sur maquette ASCII, ci-dessous) : bouton ☰ en tête du
bandeau, à gauche du texte du run ; tiroir qui glisse depuis la gauche par-dessus le globe
(largeur, style et animation : au constructeur, dans le style `.panel` existant).

```
┌────────────────┬────────────────┐
│ ✕ GlobeLayers  │                │
│ HOW TO USE     │      .--.      │
│ MAPS           │    /      \    │
│  Temperature   │   |  globe  |  │
│  Wind …        │    \      /    │
│ REGIONS        │      '--'      │
│  Sahara dust … │                │
│ (ARTICLES)     │                │
│ About          │                │
└────────────────┴────────────────┘
``` Sections dans cet ordre :
`How to use` · `Maps` (8) · `Regions` (8) · `Articles` (masquée tant qu'elle est vide) · `About`.
La page courante y est marquée. Ferme par ✕, Échap, clic hors du tiroir. Accessible au clavier,
cibles tactiles ≥ 40 px dans le tiroir. Le bouton `?` About du bandeau reste.

**Mobile** : résumé et tiroir ne doivent pas casser la disposition verticale existante
(légende/frise collées aux bords, globe aux 42 %).

## 6. Contraintes

- Hébergement : Worker Cloudflare d'assets statiques (`web/wrangler.jsonc`, `dist/`). Chaque
  page = un `index.html` dans son dossier de `dist/`. Vérifier que les en-têtes de cache
  (`public/_headers` : HTML en `max-age=0, must-revalidate`) couvrent les nouveaux HTML.
- **Une seule source de vérité** pour les pages (chemin, couche, vent, vue, textes, image) ; les
  HTML, le sitemap, le tiroir et la bascule d'adresse en dérivent. Pas de 16 copies d'`index.html`
  maintenues à la main.
- Garde-fous existants à étendre : `web/tests/seo.test.ts` (toutes les pages), `english.test.ts`
  (textes des pages), sitemap. Ajouter un test « chaque page du registre a son HTML, son entrée
  sitemap, une description dans les bornes, un canonical juste ».
- Code interne, commentaires, commits et HISTORY en français ; tout texte visible en anglais.
- Bundle : pas de dépendance nouvelle lourde ; l'ouverture du globe ne doit pas ralentir.
- CI : le déploiement est bloqué si `history_check` échoue → HISTORY mis à jour avant push.

## 7. Après déploiement (à la main, utilisateur)

- Renvoyer le sitemap dans Google Search Console et Bing Webmaster ; demander l'indexation des
  pages principales dans Search Console.
- IndexNow : automatique au déploiement.
- Relever indexation et impressions à 2, 4 et 6 semaines (critère de succès §1).

## 8. Laissé au constructeur

Mécanique de génération des HTML au build (plugin Vite, multi-entrées, etc.) ; type JSON-LD des
sous-pages ; cadrages exacts ; règle fine vent + couche ; animation du tiroir ; découpage en tâches.
