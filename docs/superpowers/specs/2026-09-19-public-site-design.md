# Spec — Site public (lot D) : site en anglais, référencement, partage, mesure d'audience

**Date :** 2026-09-19 · **Statut :** validée en brainstorming, à planifier
**Périmètre :** front (`web/`), outil `tools/build_geo.py` et ses données, fichiers statiques,
comptes externes (Cloudflare Web Analytics, Google Search Console, Bing Webmaster). **Aucun
changement** du pipeline horaire, du contrat `layers/latest.json`, des tuiles, de R2, ni des
paramètres d'URL (`layer`, `wind`, `labels`, `rivers`, `lon`, `lat`, `d`, `tier`).

## 1. Objectif

GlobeLayers est en ligne mais invisible et fermé : un `<head>` réduit à `title` + `description`,
aucun texte lisible par un moteur (canvas WebGL), un lien partagé sans image, aucune mesure
d'audience, et une interface en français seulement. Ce lot en fait un **site public mondial** :

1. **tout le site passe en anglais** (une seule langue ; d'autres langues = chantier futur) ;
2. référencement et partage : balises, fichiers statiques, image Open Graph, icônes ;
3. un panneau **« About »** qui porte le texte indexable et les sources ;
4. mesure d'audience **sans cookie** (Cloudflare Web Analytics) ;
5. déclaration du site dans Google Search Console et Bing Webmaster.

Prérequis de la monétisation visée par `docs/PLAN.md` (feuille de route HISTORY §8, P4).

## 2. Décisions (validées par l'utilisateur le 2026-09-19, ne pas rouvrir)

| Décision | Pourquoi |
|---|---|
| **Anglais seul, partout** ; pas de sélecteur de langue ni de détection | Site « global et ouvert au monde entier » ; le multilingue est un chantier futur. |
| **Cloudflare Web Analytics**, pas PostHog ni GA4 | Gratuit, sans cookie → aucun bandeau de consentement ; déjà dans le compte Cloudflare. Pas d'événements d'usage : accepté. |
| **Image Open Graph = capture réelle du globe, statique, commitée** | Montre le vrai produit, zéro infrastructure ; à refaire à la main si le look change. |
| **Texte indexable dans un panneau « About » de la page unique**, pas de pages de contenu séparées | Une seule URL, utile aussi aux visiteurs ; les pages par couche sont un lot à part. |
| **Tout statique, écrit à la main** (approche A) : ni plugin Vite de génération, ni script Worker | Une page, une URL : rien à générer. |
| **Unités métriques conservées** (°C, km/h, hPa, mm/h, µg/m³) | Standard météo mondial ; l'impérial relève du même chantier futur que les langues. |

## 3. Passage à l'anglais

### 3.1 Règle

**Toute chaîne livrée au navigateur est en anglais** : texte et attributs du DOM (`title`,
`aria-label`, `alt`), `index.html`, fichiers statiques, données `geo/`, messages de statut et
d'erreur fatale, **et aussi** les messages de `console.*` et des exceptions (`throw new …("…")`),
parce qu'ils sont dans le bundle et que cela permet un contrôle automatique strict (§8.1).

**Restent en français** (jamais livrés, ou internes au projet) : commentaires du code, noms et
descriptions des tests, messages de commit, `HISTORY.md`, specs, plans, `docs/PLAN.md`.

### 3.2 Une seule source pour les chaînes d'interface

Nouveau module **`web/src/i18n/en.ts`** : un objet `STRINGS` typé (`as const`) qui porte toutes
les chaînes d'interface — libellés de couches, interrupteurs, statuts, erreurs fatales,
fragments du bandeau et du tooltip, légende, titres d'indisponibilité, rose des vents.
`web/src/i18n/index.ts` réexporte `STRINGS` (`export { STRINGS } from "./en"`) : ajouter une
langue plus tard = ajouter un fichier et choisir ici, sans toucher aux appelants.
**Pas** de moteur d'interpolation ni de changement de langue à l'exécution : les phrases à
variable sont des fonctions (`ago: (h, m) => …`). Les messages de console et d'exception restent
en ligne dans leur module (développeur seulement, jamais traduits).

Le texte du panneau « About » et les balises vivent dans `index.html` (HTML initial, §5).

### 3.3 Conventions de forme (remplacent les conventions françaises)

| Élément | Avant | Après |
|---|---|---|
| Séparateur décimal | virgule (`20,5 °C`) | point (`20.5 °C`) ; signe moins typographique `−` conservé |
| Pourcentage | `45 %` | `45%` |
| Heure | `Intl` `fr-FR`, 24 h | `Intl` `en-GB`, 24 h (`10:00`) |
| Bandeau | `NOAA GFS 0,25° · run 06:00 UTC · valide 10:00 UTC (12:00 locale) · il y a 2 h 14` | `NOAA GFS 0.25° · run 06:00 UTC · valid 10:00 UTC (12:00 local) · 2 h 14 min ago` |
| Fraîcheur | `à l'instant`, `il y a 12 min`, `il y a 2 h 14` | `just now`, `12 min ago`, `2 h 14 min ago` |
| Rose des vents (16 points) | `O`, `SO`, `NNO`… | `W`, `SW`, `NNW`… |
| Vent (tooltip) | `Vent 23 km/h NO`, `Vent calme` | `Wind 23 km/h NW`, `Calm` |
| Couches | Aucune, Température, Nuages, Pluie, Pression, Humidité, PM2.5, Poussière | None, Temperature, Clouds, Rain, Pressure, Humidity, PM2.5, Dust |
| Interrupteurs | Vent, Étiquettes, Fleuves | Wind, Labels, Rivers |
| Légende | `isolignes 4 hPa`, `min`, `max` | `isolines 4 hPa`, `min`, `max` |
| Statuts | Données indisponibles, nouvel essai dans 15 min · Mise à jour impossible, nouvel essai dans 15 min · Données anciennes · Détail de la carte indisponible · Couche indisponible · Vent indisponible | Data unavailable, retrying in 15 min · Update failed, retrying in 15 min · Data is outdated · Map detail unavailable · Layer unavailable · Wind unavailable |
| Titres d'indisponibilité | Indisponible, Vent / Étiquettes / Fleuves indisponible(s) | Unavailable, Wind / Labels / Rivers unavailable |
| Erreurs fatales | Ce navigateur ne prend pas en charge WebGL… · Le rendu 3D a été interrompu… Rechargez la page. · Le globe n'a pas pu démarrer… · bouton Recharger | This browser does not support WebGL, which the 3D globe requires. · 3D rendering was interrupted by the browser. Reload the page. · The globe could not start. Reload the page. · Reload |
| `index.html` | `lang="fr"`, `aria-label` français, `Chargement…` | `lang="en"`, `aria-label` anglais, `Loading…` |

`VALUE_CHARS` (`labels/select.ts`, estimation de boîte) est revu si le plus long texte de valeur
change de longueur (`45%` raccourcit ; `1013 hPa`, `120 µg/m³` inchangés).

### 3.4 Noms géographiques

`tools/build_geo.py::_name` lit **`name_en`**, repli sur `name` (au lieu de `name_fr`).
`places.json` et `countries.json` sont régénérés depuis le cache Natural Earth local
(`tools/.geo-cache/`, v5.1.2) ; `rivers.bin` doit rester **identique à l'octet**. Le tri par nom
change l'ordre à rang égal : attendu. Budgets de taille des tests inchangés (places ≤ 300 Ko,
countries ≤ 15 Ko) ; les noms témoins des tests passent à l'anglais (France, Japan, Brazil,
Croatia, Luxembourg).

## 4. `<head>` et métadonnées (`web/index.html`)

- `<html lang="en">`, `<title>GlobeLayers — Live 3D Weather Globe</title>`.
- `meta description` (≤ 160 caractères) : globe 3D interactif, température, vent, nuages, pluie,
  pression, humidité, qualité de l'air, données NOAA GFS mises à jour chaque heure.
- `link rel="canonical" href="https://globelayers.com/"`, `meta robots` `index, follow`,
  `meta theme-color` (couleur de fond du site).
- Open Graph : `og:type` `website`, `og:site_name`, `og:title`, `og:description`, `og:url`,
  `og:locale` `en_US`, `og:image` **absolue** `https://globelayers.com/og.jpg`,
  `og:image:width` 1200, `og:image:height` 630, `og:image:alt`.
- `twitter:card` `summary_large_image` (+ `twitter:title`, `twitter:description`, `twitter:image`).
- Icônes : `link rel="icon" type="image/svg+xml" href="/favicon.svg"`,
  `link rel="apple-touch-icon" href="/apple-touch-icon.png"`, `link rel="manifest" href="/site.webmanifest"`.
- JSON-LD `WebApplication` : `name`, `url`, `description`, `applicationCategory` `WeatherApplication`,
  `operatingSystem` `Any`, `browserRequirements` `Requires WebGL`, `inLanguage` `en`,
  `isAccessibleForFree` `true`, `offers` (prix 0), `image`.

## 5. Panneau « About »

- Bouton **`?`** (`#about-open`, `aria-label="About GlobeLayers"`) dans le bandeau, à côté du
  bouton de repli.
- **`<dialog id="about">`** natif, ouvert par `showModal()` : piège à focus, `Échap`, fond
  assombri (`::backdrop`) fournis par le navigateur. Bouton « Close », clic sur le fond = fermer.
- Contenu **dans le HTML initial** (indexable), en anglais, ≈ 200–300 mots : `h1` GlobeLayers et
  une phrase de présentation ; `h2` *Layers* (liste des huit couches + vent, une ligne chacune) ;
  `h2` *Data & freshness* (NOAA GFS 0.25° horaire, GEFS-Aerosols toutes les 3 h, délai 4–6 h) ;
  `h2` *Sources & credits* (NOAA, NASA Blue Marble, GEBCO, © OpenStreetMap contributors, Natural
  Earth) ; `h2` *Privacy* (« cookie-free audience measurement by Cloudflare Web Analytics; no
  personal data, no advertising trackers »).
- Module **`web/src/ui/about.ts`** : `createAbout(dialog, openButton, closeButton)` — ouvre,
  ferme, ferme au clic sur le fond ; testable avec de faux éléments comme `ui/toggle.ts`.
- Le dialog est modal et au-dessus de tout : il n'entre pas dans `panelRects()` (les étiquettes
  sont de toute façon masquées par le fond).
- `#ad-slot` : inchangé, toujours caché.

## 6. Fichiers statiques (`web/public/`)

| Fichier | Contenu |
|---|---|
| `robots.txt` | `User-agent: *` / `Allow: /` / `Sitemap: https://globelayers.com/sitemap.xml` |
| `sitemap.xml` | une URL, `https://globelayers.com/` (sans `lastmod` : rien ne le tiendrait à jour) |
| `favicon.svg` | globe simple dessiné à la main, lisible à 16 px, clair et sombre |
| `apple-touch-icon.png` | 180 × 180, fond plein |
| `site.webmanifest` | `name`, `short_name`, `icons`, `theme_color`, `background_color`, `display` `browser` ; **pas** de service worker (PWA = feuille de route R6) |
| `og.jpg` | 1200 × 630, ≤ 150 Ko : capture du build local (température + vent, Europe/Atlantique, panneaux repliés, étiquettes allumées), nom « GlobeLayers » incrusté |
| `_headers` | cache 1 jour pour ces fichiers (`/og.jpg`, `/favicon.svg`, `/apple-touch-icon.png`, `/site.webmanifest`, `/robots.txt`, `/sitemap.xml`) |

## 7. Mesure d'audience et moteurs de recherche

- **Cloudflare Web Analytics** : `<script defer src="https://static.cloudflareinsights.com/beacon.min.js"
  data-cf-beacon='{"token": "…"}'>` en fin de `<body>`, **injecté au build de production
  seulement** (petit plugin `transformIndexHtml` dans `vite.config.ts`, `apply: "build"`) pour ne
  pas compter `localhost`. Le jeton est public par nature (repo public : sans objet). Le site est
  créé dans le tableau de bord Cloudflare **par l'utilisateur ou avec son accord explicite**.
- **Google Search Console** : propriété de domaine `globelayers.com`, vérification par
  enregistrement DNS TXT sur Cloudflare, envoi de `sitemap.xml`.
- **Bing Webmaster** : ajout du site, vérification, envoi de `sitemap.xml`.
- Ces trois actions touchent des comptes externes : **accord de l'utilisateur à chacune**, après
  le déploiement.

## 8. Tests et validation

### 8.1 Vitest

- **`seo.test.ts`** (lit `web/index.html` et `web/public/`) : `lang="en"` ; chaque balise du §4
  présente ; toute URL de balise absolue en `https://globelayers.com` ; `description` ≤ 160
  caractères ; JSON-LD parsable avec les champs du §4 ; `sitemap.xml` = `canonical` ; `robots.txt`
  cite le sitemap ; `site.webmanifest` parsable ; `og.jpg` existe, ≤ 150 Ko, 1200 × 630 (lecture
  de l'en-tête JPEG) ; le texte « About » (titres du §5) est dans le HTML initial.
- **`english.test.ts` — contrôle « tout est en anglais »** : (a) aucune lettre accentuée française
  `[àâçèéêëîïôùûœÀÂÇÈÉÊËÎÏÔÙÛŒ]` dans `index.html` ; (b) aucune dans les **littéraux de chaîne** des
  fichiers `web/src/**/*.ts` (commentaires exclus par un découpage simple) ; (c) liste de mots
  français interdits dans ces mêmes littéraux (`indisponible`, `Vent`, `Pluie`, `Nuages`,
  `attendu`, `invalide`, `il y a`…). Les données `geo/` sont exclues de (a) : les noms anglais
  portent des accents légitimes (São Paulo) ; elles sont couvertes par pytest (§8.2).
- **`about.test.ts`** : ouverture, fermeture, clic sur le fond.
- Tests existants mis à jour : `format`, `registry`, `wind-select`/`format` (rose des vents),
  `toggle`, `geo-wiring`, `labels-*`, tout test qui compare une chaîne française.

### 8.2 pytest

`test_build_geo.py` : `_name` préfère `name_en` ; fichiers commités — noms témoins anglais,
`Japon`/`Brésil`/`Allemagne` absents, budgets tenus, `rivers.bin` inchangé.

### 8.3 Validation navigateur (avec l'accord de l'utilisateur : RAM de la machine ≈ 1–2 Go libres)

1. **Revue « tout en anglais » à l'œil**, 1000 px et 500 px : bandeau, menu, interrupteurs,
   légende de chaque couche, tooltip (valeur + vent), étiquettes de villes et de pays, statuts
   (simulés), écran fatal (simulé), panneau About, titres au survol, texte de l'onglet.
2. Panneau About : ouverture, `Échap`, clic sur le fond, focus rendu au bouton, lisible à 500 px.
3. Lighthouse SEO ≥ 95 sur le build local.
4. Après déploiement : `og.jpg`, `robots.txt`, `sitemap.xml`, `favicon.svg` en 200 sur
   `globelayers.com` ; aperçu du lien dans un débogueur Open Graph ; beacon chargé (requête
   `cloudflareinsights` en 200), aucun cookie posé.

### 8.4 Budgets

Bundle JS : **≤ +2 Ko gzip** (chaînes déplacées, `about.ts`, pas de dépendance). `index.html` :
≤ 8 Ko gzip. Aucune nouvelle dépendance npm ni Python.

## 9. Critères d'acceptation

1. Aucun texte français visible ou annoncé (lecteur d'écran) nulle part sur le site ; `english.test.ts` vert.
2. Villes et pays étiquetés en anglais (Germany, Japan, Brazil, Munich, Vienna).
3. Nombres avec point décimal, rose des vents anglaise, bandeau et fraîcheur en anglais.
4. Un lien `https://globelayers.com/` collé dans un débogueur Open Graph montre titre, description et image 1200 × 630.
5. `robots.txt`, `sitemap.xml`, favicon et manifeste servis en 200 ; Lighthouse SEO ≥ 95.
6. Le panneau About s'ouvre et se ferme au clavier et au pointeur ; son texte est dans le HTML initial.
7. Le beacon Cloudflare se charge en production, pas en local ; aucun cookie.
8. `globelayers.com` vérifié dans Google Search Console et Bing Webmaster, sitemap envoyé.
9. Vitest, `tsc`, pytest verts ; budgets du §8.4 tenus ; fluidité inchangée (aucun code de rendu touché).

## 10. Hors périmètre (à porter à la feuille de route, HISTORY §8)

Autres langues et sélecteur de langue ; unités impériales ; pages de contenu par couche ;
événements d'usage (PostHog) ; publicité et bandeau de consentement ; PWA / hors-ligne ;
image Open Graph dynamique par couche.
