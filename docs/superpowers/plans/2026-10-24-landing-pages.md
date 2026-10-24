# Lot G — Pages de référencement et tiroir de navigation : plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** 16 pages statiques indexables (8 couche, 8 région) + accueil retravaillé, qui ouvrent le globe réglé sur leur couche/vue, avec résumé refermable, panneau « Read more », tiroir ☰ et adresse qui suit la couche.

**Architecture :** un registre unique `web/src/pages/registry.ts` (données pures, textes anglais) dont tout dérive. Au build, un plugin Vite rend chaque page à partir d'`index.html` (le gabarit, qui porte déjà le contenu de l'accueil) et émet `dist/<slug>/index.html` + `dist/sitemap.xml`. Au démarrage, la page courante (`location.pathname`) fournit des paramètres par défaut injectés dans la query string « de démarrage », si bien que le code de parsing existant (`parseLayerParam`, `parseWindParam`, vue `lon/lat/d`) ne change presque pas. Navigation interne par `history.pushState` + `popstate`.

**Tech Stack :** TypeScript, Vite 8 (plugin maison), Vitest 4 (sans DOM : faux éléments, cf. `tests/about.test.ts`), three.js (inchangé).

**Spec :** `docs/superpowers/specs/2026-10-24-landing-pages-design.md` — l'exécutant la lit avant toute tâche.

## Global Constraints

- Code interne, commentaires, noms de tests, commits, HISTORY : **français**. Tout texte livré (HTML, chaînes TS) : **anglais** ; `tests/english.test.ts` le garde et couvre automatiquement tout `src/**/*.ts`.
- Adresses : chemins en mot-clé avec barre finale, liste exacte en Task 1.
- Meta description : 80–160 caractères (règle existante `seo.test.ts`).
- Texte « Read more » : 150–300 mots par page, propre à la page ; rien d'inexact sur les sources (NOAA GFS 0,25°, GEFS-Aerosols, 4 runs/jour, 48 h par pas de 3 h).
- Interdits de texte : « tracker », « track », « alert », noms ou trajectoires de cyclones.
- « Ma position » jamais dans une URL (règle existante, `ViewGuard`) : la navigation interne ne doit pas réécrire `lon/lat/d` pendant la garde.
- Aucune dépendance npm nouvelle. Bundle JS : ≤ +6 Ko gzip (référence : `npm run build` sur `master` avant la Task 1, noter la valeur).
- Fichiers statiques en LF ; `public/_headers` : HTML en `public, max-age=0, must-revalidate`.
- Stockage local (résumé masqué) : clé `globelayers.summaryHidden`, chaque accès dans `try/catch`, le site marche sans.
- Le poste a ≈ 1–2 Go de RAM libre : **ne pas lancer de serveur de dev ni ouvrir le globe dans un navigateur sans l'accord de l'utilisateur** (Task 6).
- HISTORY à jour avant tout push (`python tools/history_check.py` bloque la CI).

## Review Focus

1. **Arrivée par une URL partagée sur une page** (`/sahara-dust-forecast/?layer=rain&lon=…`) : les paramètres explicites priment sur ceux de la page → test `pageDefaultsSearch` (Task 2).
2. **Retour navigateur après navigation interne** : la couche, le vent et le contenu reviennent à la page précédente sans recharger → test `stateForPath` + étape de validation (Tasks 2, 5, 6).
3. **Chemin inconnu ou sans barre finale** (`/wind-map`, `/foo/`) : `/wind-map` → page vent ; `/foo/` → accueil (Cloudflare servira 404 de toute façon, mais le JS ne doit pas planter) → test `pageForPath` (Task 2).
4. **Stockage local indisponible** (navigation privée, Brave strict) : résumé visible, ✕ marche pour la session → test `summaryHidden` avec un stockage qui lève (Task 4).
5. **Clic avec Ctrl/Cmd/molette sur un lien du tiroir** : nouvel onglet normal, pas d'interception → test `shouldIntercept` (Task 4).

---

### Task 1 : Registre des pages et textes

**Files :**
- Create : `web/src/pages/registry.ts`
- Test : `web/tests/pages-registry.test.ts`

**Interfaces :**
- Produces :
  ```ts
  export interface PageView { lon: number; lat: number; d: number }
  export interface PageDef {
    slug: string;                 // "" pour l'accueil, sinon "temperature-map"…
    kind: "home" | "layer" | "region";
    layer: string | null;         // id de LAYERS ou null (aucune couche)
    windForced: boolean;          // true : vent allumé sauf reduced-motion (spec §5)
    view: PageView | null;        // null : vue par défaut du site
    title: string;                // <title>
    description: string;          // meta description, 80–160 car.
    h1: string;
    summary: string;              // ≈ 2 lignes, texte brut
    body: string[];               // paragraphes du « Read more », texte brut (pas de HTML)
    menuLabel: string;            // libellé dans le tiroir
    ogImage: string;              // chemin absolu depuis la racine, "/og.jpg" en attendant Task 6
    ogAlt: string;
    related: string[];            // slugs liés, en fin de « Read more »
  }
  export const PAGES: readonly PageDef[];      // ordre = ordre du tiroir : home, 8 layer, 8 region
  export const SITE = "https://globelayers.com";
  export function pagePath(p: PageDef): string; // "/" ou "/<slug>/"
  ```

Pages (slug → couche, vent forcé, vue) :

| slug | kind | layer | windForced | view (lon, lat, d) |
|---|---|---|---|---|
| `""` | home | temp | false | null |
| `temperature-map` | layer | temp | false | null |
| `wind-map` | layer | null | true | null |
| `cloud-map` | layer | clouds | false | null |
| `rain-map` | layer | rain | false | null |
| `pressure-map` | layer | pressure | false | null |
| `humidity-map` | layer | humidity | false | null |
| `air-quality-map` | layer | pm25 | false | null |
| `dust-forecast` | layer | dust | false | null |
| `sahara-dust-forecast` | region | dust | false | (-5, 20, 2.0) |
| `europe-heatwave-map` | region | temp | false | (12, 48, 1.8) |
| `atlantic-hurricane-map` | region | pressure | true | (-55, 22, 2.0) |
| `pacific-typhoon-map` | region | pressure | true | (135, 20, 2.0) |
| `india-air-quality-map` | region | pm25 | false | (80, 22, 1.8) |
| `antarctica-temperature-map` | region | temp | false | (0, -89, 2.2) |
| `arctic-temperature-map` | region | temp | false | (0, 89, 2.2) |
| `amazon-rainfall-map` | region | rain | false | (-60, -5, 1.8) |

Les vues sont des valeurs de départ ; Task 6 les ajuste à l'œil. Le titre de l'accueil reste `GlobeLayers — Live 3D Weather Globe` et sa description reste celle d'`index.html` aujourd'hui (le test `seo.test.ts` existant l'exige). Le résumé de l'accueil est le mode d'emploi (couche, 🔍, 📍, 📷, curseur 48 h, ?) ; son `body` reprend l'esprit du panneau About sans le recopier.

- [ ] **Step 1 : Écrire les tests** — `tests/pages-registry.test.ts` :
  - `"17 pages, slugs uniques, accueil en tête"` : `PAGES.length === 17`, `PAGES[0].kind === "home"`, `new Set(slugs).size === 17`, 8 `layer`, 8 `region`.
  - `"chaque couche citée existe dans LAYERS"` : `layer === null || layerDef(layer) !== undefined`.
  - `"description 80–160 caractères, titres uniques"`.
  - `"Read more : 150 à 300 mots, textes distincts"` : somme des mots de `body` ∈ [150, 300] ; aucun paragraphe identique entre deux pages.
  - `"aucun mot interdit"` : `/\b(track(er|ing)?|alerts?)\b/i` absent de tous les champs texte.
  - `"related ne cite que des slugs existants, jamais soi-même"`.
  - `"vent forcé seulement pour vent, ouragans, typhons"` : `PAGES.filter(p => p.windForced).map(p => p.slug)` égale `["wind-map", "atlantic-hurricane-map", "pacific-typhoon-map"]`.
  - `"vues bornées"` : `|lat| ≤ 89`, `|lon| ≤ 180`, `d ∈ [MIN_DISTANCE, MAX_DISTANCE]` (`src/render/scene.ts`).
  - `"pagePath"` : `"/"` pour l'accueil, `"/wind-map/"` pour le vent.
- [ ] **Step 2 : Lancer** `npx vitest run tests/pages-registry.test.ts` → FAIL (module absent).
- [ ] **Step 3 : Écrire `registry.ts`** avec les 17 pages et tous les textes (anglais, sobre, factuel ; chaque page région explique quoi chercher sur la carte, ex. panaches de poussière traversant l'Atlantique, spirale de basse pression et vents forts autour d'un cyclone, froid du plateau antarctique).
- [ ] **Step 4 : Lancer** `npx vitest run tests/pages-registry.test.ts tests/english.test.ts` → PASS.
- [ ] **Step 5 : Commit** — `feat(pages): registre des 17 pages et leurs textes`.

### Task 2 : Logique pure de routage et des paramètres de démarrage

**Files :**
- Create : `web/src/pages/route.ts`
- Test : `web/tests/pages-route.test.ts`

**Interfaces :**
- Consumes : `PAGES`, `PageDef`, `pagePath` (Task 1).
- Produces :
  ```ts
  /** "/wind-map/" et "/wind-map" → page vent ; inconnu → accueil. */
  export function pageForPath(pathname: string): PageDef;
  /** Ajoute à `search` les paramètres de la page absents : layer (id ou "none"), wind=1 si windForced
   *  et !reducedMotion, lon/lat/d si view. Les paramètres présents ne sont jamais écrasés. Préfixé par "?". */
  export function pageDefaultsSearch(search: string, page: PageDef, reducedMotion: boolean): string;
  /** Page cible après un changement de couche par l'utilisateur ; la page courante si elle ne change pas. */
  export function pageAfterLayerChange(current: PageDef, layer: string | null, windOn: boolean): PageDef;
  /** Query string à garder en changeant de page : retire layer, wind, lon, lat, d ; garde le reste. */
  export function searchForPageChange(search: string): string;
  ```
  Règles de `pageAfterLayerChange` (spec §5) : couche X non nulle → la page `layer` de X (temp → `temperature-map`, jamais l'accueil) ; `null` et `windOn` → `wind-map` ; `null` et vent éteint → accueil. Si la page courante est déjà la bonne page couche, la renvoyer telle quelle. Le vent seul ne change jamais de page (pas de fonction dédiée).

- [ ] **Step 1 : Tests** :
  - `pageForPath` : `"/"` → home ; `"/wind-map/"` et `"/wind-map"` → `wind-map` ; `"/foo/"` → home ; `"/WIND-MAP/"` → home (sensible à la casse, comme Cloudflare).
  - `pageDefaultsSearch` : accueil + `""` → `?layer=temp` ; `wind-map` + `""` + reducedMotion false → contient `layer=none` et `wind=1` ; idem reducedMotion true → pas de `wind` ; `sahara-dust-forecast` + `""` → `layer=dust&lon=-5&lat=20&d=2` ; **`sahara-dust-forecast` + `?layer=rain&lon=10&lat=10`** → garde `layer=rain`, `lon=10`, `lat=10` (et n'ajoute pas `d` de la page, la vue explicite est un tout : si `lon` ou `lat` est présent, ne rien ajouter de la vue) ; `?wind=0` sur `wind-map` reste `wind=0`.
  - `pageAfterLayerChange` : depuis home vers `rain` → `rain-map` ; depuis `rain-map` vers `temp` → `temperature-map` ; depuis `sahara-dust-forecast` vers `dust` → `dust-forecast` ; depuis `rain-map` vers `null` vent allumé → `wind-map` ; vers `null` vent éteint → home ; depuis `temperature-map` vers `temp` → même objet.
  - `searchForPageChange("?layer=rain&wind=1&labels=0&lon=1&lat=2&d=3")` → `"?labels=0"` ; `searchForPageChange("?layer=rain")` → `""` (chaîne vide quand rien ne reste, pour un `pushState` vers `"/rain-map/"` sans `?`).
- [ ] **Step 2 : Lancer** `npx vitest run tests/pages-route.test.ts` → FAIL.
- [ ] **Step 3 : Implémenter** `route.ts` (URLSearchParams ; formats de `lon/lat/d` comme `withView`, `src/geo/params.ts`, mais sans `toFixed` imposé : `String(n)`).
- [ ] **Step 4 : Lancer** → PASS.
- [ ] **Step 5 : Commit** — `feat(pages): routage pur et paramètres de démarrage par page`.

### Task 3 : Rendu HTML des pages, gabarit, sitemap et plugin de build

**Files :**
- Create : `web/src/build/pages.ts`
- Modify : `web/index.html` (ajout du résumé, du panneau « Read more », du tiroir ; contenu = accueil)
- Modify : `web/vite.config.ts` (plugin `worldtemp:pages`)
- Delete : `web/public/sitemap.xml`
- Modify : `web/public/_headers` (une règle par page, cf. étape 5)
- Modify : `web/tests/seo.test.ts`, `web/tests/english.test.ts` (sitemap statique retiré de la liste)
- Test : `web/tests/pages-render.test.ts`

**Interfaces :**
- Consumes : `PAGES`, `PageDef`, `pagePath`, `SITE` (Task 1).
- Produces :
  ```ts
  /** Rend la page `page` à partir du gabarit index.html : remplace <title>, meta description,
   *  canonical, og:url/title/description/image/image:alt, twitter:*, le JSON-LD, et le contenu
   *  des éléments #summary-title, #summary-text, #more-body, #drawer-nav. Idempotent. */
  export function renderPageHtml(template: string, page: PageDef): string;
  export function renderSitemap(pages: readonly PageDef[]): string;
  /** HTML de la liste du tiroir (sections Maps, Regions ; Articles absente), aria-current sur `current`. */
  export function renderDrawerNav(current: PageDef): string;
  /** HTML du corps « Read more » : <h2>, <p> par paragraphe, puis liste de liens `related`. */
  export function renderMoreBody(page: PageDef): string;
  ```
  Les textes passent par un échappement HTML (`&`, `<`, `>`, `"`). JSON-LD : accueil inchangé (`WebApplication`) ; autres pages `{"@type":"WebPage", name, url, description, inLanguage:"en", image, isPartOf:{"@type":"WebApplication", name:"GlobeLayers", url:"https://globelayers.com/"}}`.

Balisage ajouté à `index.html` (ids fixés, les tâches suivantes en dépendent) :
- dans `#banner`, en tête : `<button id="drawer-open" type="button" aria-label="Menu" aria-haspopup="dialog">☰</button>` ;
- sous le bandeau, dans `#overlay` : `<section id="summary" class="panel" aria-labelledby="summary-title"><h1 id="summary-title">…</h1><p id="summary-text">…</p><button id="more-open" type="button" aria-haspopup="dialog">Read more</button><button id="summary-close" type="button" aria-label="Hide summary">✕</button></section>` ;
- `<dialog id="more" aria-labelledby="more-title"><div class="about-body"><button id="more-close" type="button" aria-label="Close">×</button><div id="more-body">…</div></div></dialog>` (le `<h2 id="more-title">` est produit par `renderMoreBody`) ;
- `<dialog id="drawer" aria-label="Site menu"><div class="drawer-body"><header><a id="drawer-home" href="/">GlobeLayers</a><button id="drawer-close" type="button" aria-label="Close menu">✕</button></header><a id="drawer-howto" href="/">How to use</a><nav id="drawer-nav">…</nav><button id="drawer-about" type="button">About</button></div></dialog>`.
- Le `<h1 id="about-title">` du panneau About devient `<h2 id="about-title">` (un seul h1 par page) ; adapter l'assertion de `seo.test.ts` en conséquence.

- [ ] **Step 1 : Tests** `tests/pages-render.test.ts` (gabarit lu depuis `web/index.html`) :
  - `"l'accueil rendu égale index.html"` : `renderPageHtml(html, PAGES[0]) === html` (le gabarit reste la source de l'accueil, aucune dérive possible).
  - Pour chaque page (`it.each`) : un seul `<h1`, `<title>` = `page.title`, canonical = `SITE + pagePath(page)`, `og:url` idem, `og:image` = `SITE + page.ogImage`, description du JSON-LD = meta description, `#summary-title` contient `page.h1`, `#more-body` contient chaque paragraphe (échappé), `#drawer-nav` contient les 16 liens `href="/<slug>/"` et `aria-current="page"` sur la page courante seulement (accueil : aucun).
  - `"échappement"` : une page factice avec `title: 'A <b> & "c"'` rend `A &lt;b&gt; &amp; &quot;c&quot;`.
  - `renderSitemap(PAGES)` : 17 `<loc>`, `https://globelayers.com/` en premier, toutes avec barre finale, XML en LF.
- [ ] **Step 2 : Lancer** → FAIL.
- [ ] **Step 3 : Implémenter** `src/build/pages.ts` (remplacements par expressions régulières ancrées sur les ids/attributs ; chaque remplacement doit trouver exactement une occurrence, sinon `throw` — un gabarit modifié casse le build au lieu de produire une page incomplète). Mettre à jour `index.html` avec le balisage ci-dessus, contenu = rendu de l'accueil (lancer une fois `renderPageHtml` pour générer, puis vérifier l'idempotence par le test).
- [ ] **Step 4 : Plugin `worldtemp:pages`** dans `vite.config.ts` :
  - `apply: "build"`, hook `generateBundle(_, bundle)` : lire l'asset `index.html` du bundle (déjà transformé : scripts hachés, beacon), et pour chaque page sauf l'accueil, `this.emitFile({ type: "asset", fileName: \`${slug}/index.html\`, source: renderPageHtml(html, page) })` ; émettre `sitemap.xml` = `renderSitemap(PAGES)`.
  - Dev (`configureServer`) : middleware qui, pour un `req.url` dont le chemin est celui d'une page non-accueil, réécrit `req.url` en `/` (le JS applique le contenu de la page au démarrage, Task 5). Pas de rendu serveur en dev.
- [ ] **Step 5 : `_headers`** : pour chaque page non-accueil, un bloc `/<slug>/\n  Cache-Control: public, max-age=0, must-revalidate`. Garder `/sitemap.xml` en `max-age=86400`. Test ajouté à `seo.test.ts` : chaque `pagePath` non-accueil a son bloc exact.
- [ ] **Step 6 : Tests existants** : `seo.test.ts` — le test sitemap lit désormais `renderSitemap(PAGES)` ; `english.test.ts` — retirer `public/sitemap.xml` de `statics`, ajouter un `it.each(PAGES)` qui passe `renderPageHtml(html, page)` au contrôle `FRENCH_LETTER`/`FRENCH_WORD`. Supprimer `public/sitemap.xml` ; garder sa ligne `_headers`.
- [ ] **Step 7 : Lancer** `npm test` et `npm run typecheck` → PASS. Puis `npm run build` et vérifier : `ls dist/*/index.html | wc -l` → 16 ; `grep -c "<loc>" dist/sitemap.xml` → 17 ; `grep -o '<link rel="canonical"[^>]*>' dist/rain-map/index.html` → `https://globelayers.com/rain-map/` ; les `<script type="module" src="/assets/…">` de `dist/rain-map/index.html` sont en chemin absolu.
- [ ] **Step 8 : IndexNow lit le nouveau sitemap** (sans rien envoyer) : depuis la racine, `python -c "import sys; sys.path.insert(0,'tools'); import indexnow, pathlib; print(len(indexnow.urls_from_sitemap(pathlib.Path('web/dist/sitemap.xml').read_text())))"` depuis la racine → `17`.
- [ ] **Step 9 : Commit** — `feat(pages): rendu des 16 pages et du sitemap au build`.

### Task 4 : Interface — résumé, « Read more », tiroir, styles

**Files :**
- Create : `web/src/ui/summary.ts`, `web/src/ui/drawer.ts`
- Modify : `web/src/ui/about.ts` (renommer `createAbout` en `createDialog`, sans alias ; mettre à jour l'unique appelant `main.ts` et `tests/about.test.ts`)
- Modify : `web/src/style.css`, `web/src/i18n/en.ts`
- Test : `web/tests/summary.test.ts`, `web/tests/drawer.test.ts`

**Interfaces :**
- Consumes : `PageDef` (Task 1), `renderMoreBody`, `renderDrawerNav` (Task 3), ids du balisage (Task 3).
- Produces :
  ```ts
  // ui/about.ts
  export function createDialog(dialog: HTMLDialogElement, openButton: HTMLButtonElement, closeButton: HTMLButtonElement): void;
  // ui/summary.ts
  export const SUMMARY_KEY = "globelayers.summaryHidden";
  export function summaryHidden(storage: Pick<Storage, "getItem"> | null): boolean;   // lève → false
  export function setSummaryHidden(storage: Pick<Storage, "setItem" | "removeItem"> | null, hidden: boolean): void; // lève → ignoré
  export interface Summary { show(page: PageDef, notice: string | null): void; reveal(): void; onLayout(cb: () => void): void }
  export function createSummary(storage: Storage | null): Summary; // DOM : #summary, #summary-title, #summary-text, #summary-close, #more, #more-body
  // ui/drawer.ts
  /** Clic gauche sans modificateur, lien interne vers une page connue. */
  export function shouldIntercept(e: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, href: string, origin: string): boolean;
  export interface Drawer { setCurrent(page: PageDef): void }
  export function createDrawer(opts: { navigate: (page: PageDef) => void; openAbout: () => void; revealSummary: () => void }): Drawer;
  ```
  `STRINGS.pages.windReducedMotion = "Reduced motion is on, so the animation is paused: switch on Wind to see the flow."` (`notice` passé à `show` quand une page `windForced` démarre vent éteint par reduced-motion).

Comportement : `show` remplace h1, texte, corps « Read more » (`renderMoreBody`), `document.title` et `<meta name="description">`/canonical (pour une navigation interne) ; masqué si `summaryHidden` ; ✕ masque et mémorise ; `reveal` ré-affiche et efface la mémoire. Tiroir : `<dialog>` modal (Échap, focus fournis par le navigateur), ✕, clic sur le fond, liens interceptés selon `shouldIntercept` → `navigate(page)` puis fermeture ; `How to use` → `revealSummary()` puis `navigate(accueil)` ; `About` → ferme le tiroir, `openAbout()`.

Styles : `#summary` en rangée 2 de la grille, `grid-column: 1`, `justify-self: start`, `max-width: 24rem` ; ✕ en haut à droite. `#search` occupe aussi la rangée 2 : **la recherche ouverte masque le résumé** par `#overlay:has(#search:not([hidden])) #summary { display: none; }` (aucun JS). `src/build/pages.ts` est importé à l'exécution par `summary.ts`/`drawer.ts` : il ne doit importer aucun module Node. Tiroir : `position: fixed; inset: 0 auto 0 0; width: min(20rem, 85vw); margin: 0; height: 100%; max-height: none;` style `.panel`, glisse depuis la gauche (`transform`, désactivé sous `prefers-reduced-motion`) ; liens ≥ 40 px de haut. Mobile (`max-width: 600px`) : `#summary` pleine largeur, police 0,85 rem, texte limité à 3 lignes (`-webkit-line-clamp: 3`).

- [ ] **Step 1 : Tests** :
  - `summary.test.ts` : `summaryHidden(null) === false` ; stockage `{getItem: () => "1"}` → true ; stockage dont `getItem` lève → false ; `setSummaryHidden` avec `setItem` qui lève ne lève pas ; `setSummaryHidden(s, false)` appelle `removeItem(SUMMARY_KEY)`.
  - `drawer.test.ts` : `shouldIntercept` vrai pour `/rain-map/` clic gauche simple ; faux avec `ctrlKey`, `metaKey`, `shiftKey`, `button: 1` ; faux pour `https://www.openstreetmap.org/…` ; faux pour `/unknown/` ; vrai pour `/` (accueil).
  - `about.test.ts` : renommer les appels en `createDialog`.
- [ ] **Step 2 : Lancer** → FAIL.
- [ ] **Step 3 : Implémenter** `summary.ts`, `drawer.ts`, renommage `createDialog`, chaîne i18n, CSS.
- [ ] **Step 4 : Lancer** `npm test` et `npm run typecheck` → PASS.
- [ ] **Step 5 : Commit** — `feat(ui): résumé refermable, panneau Read more et tiroir de navigation`.

### Task 5 : Câblage dans `main.ts` — démarrage, adresse qui suit, navigation interne

**Files :**
- Modify : `web/src/main.ts`
- Modify : `web/src/capture/view-url.ts` seulement si nécessaire (la vue doit continuer à s'écrire dans la query string de la page courante)

**Interfaces :**
- Consumes : `pageForPath`, `pageDefaultsSearch`, `pageAfterLayerChange`, `searchForPageChange` (Task 2) ; `createSummary`, `createDrawer`, `createDialog`, `STRINGS.pages.windReducedMotion` (Task 4) ; `parseLayerParam`, `parseWindParam` (existants) ; `goTo`/`flight` (existants, `main.ts` ≈ l. 463–505).

Changements :
1. **Démarrage** : `let page = pageForPath(location.pathname)` ; `const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches` ; `const bootSearch = pageDefaultsSearch(location.search, page, reduced)`. Remplacer **toutes** les lectures de `location.search` qui servent au démarrage par `bootSearch` : vue `lon/lat/d` (l. 91), `parseWindParam` (l. 279), `parseLayerParam` au premier manifeste (l. 795). `bootSearch` n'est **jamais** écrit dans l'URL. Si `page.windForced && reduced && !new URLSearchParams(location.search).has("wind")` → `notice = STRINGS.pages.windReducedMotion`. `summary.show(page, notice)` ; `drawer.setCurrent(page)`.
2. **Adresse qui suit la couche** : dans `activate(id, fromUser)` (l. 645), quand `fromUser`, calculer `next = pageAfterLayerChange(page, id, windOn)` ; si `next !== page` : `history.pushState({ slug: next.slug }, "", pagePath(next) + searchForPageChange(location.search) )`, `page = next`, `summary.show(page, null)`, `drawer.setCurrent(page)` ; sinon garder le `replaceState(withLayerParam…)` existant. Sur une page dont le chemin exprime déjà la couche, ne pas réécrire `?layer=` (le retirer : `searchForPageChange` le fait).
3. **Navigation interne** (`navigate(target)` passé à `createDrawer`) : `history.pushState(…)` comme ci-dessus, puis `applyPage(target)` ; `window.addEventListener("popstate", () => applyPage(pageForPath(location.pathname)))`.
   `applyPage(p)` : `page = p` ; couche : `activate(p.layer, false)` ; vent : si `p.windForced` → `windToggle.setOn(!reduced)` et `windOn = !reduced` puis `applyWind()` (sinon ne pas toucher au vent) ; vue : si `p.view`, `flight.start(p.view.lon, p.view.lat, p.view.d, …)` à l'arrivée `history.replaceState(null, "", withView(location.search, …))` — **sauf** si la garde « ma position » est active (`viewGuard`), auquel cas voler quand même mais ne pas écrire la vue (même règle que `goTo`) ; `summary.show(p, …)` ; `drawer.setCurrent(p)`.
4. **Disposition mobile** : `applyShift` (l. 215) prend `top = max(banner.bottom, summary.bottom si visible)` ; `new ResizeObserver(applyShift).observe(byId("summary"))` ; `summary.onLayout(applyShift)`.
5. **About depuis le tiroir** : `openAbout = () => byId<HTMLDialogElement>("about").showModal()`.

- [ ] **Step 1 :** Ajouter à `tests/pages-route.test.ts` le cas de la Review Focus n° 2 au niveau logique : `pageForPath(pagePath(p)) === p` pour toutes les pages (aller-retour exact utilisé par `popstate`).
- [ ] **Step 2 : Lancer** → PASS attendu dès que Task 2 est faite (garde-fou de non-régression) ; si FAIL, corriger `pageForPath`.
- [ ] **Step 3 : Implémenter** les points 1 à 5 dans `main.ts`.
- [ ] **Step 4 : Lancer** `npm test`, `npm run typecheck`, `npm run build` → PASS ; noter la taille gzip du bundle (≤ référence + 6 Ko).
- [ ] **Step 5 : Commit** — `feat(pages): démarrage par page, adresse qui suit la couche, navigation interne`.

### Task 6 : Validation dans le navigateur, cadrages, images Open Graph, HISTORY

⚠ **Demander l'accord de l'utilisateur avant de lancer `npm run dev` / `vite preview` et d'ouvrir le globe** (RAM). Préférer `vite preview` sur le build (pages réellement rendues).

**Files :**
- Modify : `web/src/pages/registry.ts` (vues ajustées, `ogImage`)
- Create : `web/public/og/<slug>.jpg` × 16
- Modify : `web/public/_headers` (`/og/*` en `max-age=86400`)
- Modify : `web/tests/seo.test.ts` (chaque `ogImage` existe, JPEG 1200 × 630, ≤ 150 Ko — réutiliser `jpegSize`)
- Modify : `HISTORY.md`

- [ ] **Step 1 :** Avec accord, `npm run build && npx vite preview --port 5173 --strictPort` ; ouvrir `/`, chaque page couche et chaque page région. Checklist par page : bonne couche, vent conforme (allumé sur vent/ouragans/typhons), vue belle (pôles : globe bien centré sur le pôle, pas de retournement), résumé sous le bandeau, « Read more » ouvre le bon texte, tiroir marque la page courante.
- [ ] **Step 2 :** Parcours : accueil → menu couches « Rain » → adresse `/rain-map/` → « Temperature » → `/temperature-map/` → tiroir « Sahara dust » → vol, adresse `/sahara-dust-forecast/?lon=…` → bouton retour ×2 → `/rain-map/` puis `/temperature-map/` avec la bonne couche et le bon texte. URL partagée `/sahara-dust-forecast/?layer=rain` → pluie. ✕ du résumé, rechargement → résumé toujours masqué ; « How to use » le rouvre. Ctrl+clic sur un lien du tiroir → nouvel onglet. Mobile (500 px, limite connue du pont, dette 35) : résumé pleine largeur, globe visible, légende/frise intactes.
- [ ] **Step 3 :** Ajuster les vues du registre si besoin ; relancer `npm test`.
- [ ] **Step 4 : Images OG** : fenêtre 1200 × 630, résumé masqué, panneaux repliés (▾) ; pour chaque page, exporter le canvas en JPEG (qualité ~0,85, ≤ 150 Ko) vers `web/public/og/<slug>.jpg` (par `evaluate_script` : `canvas.toDataURL("image/jpeg", 0.85)` puis écriture du fichier côté outil). Mettre `ogImage: "/og/<slug>.jpg"` dans le registre (l'accueil garde `/og.jpg`). Ajouter le test d'images et la règle `_headers`.
- [ ] **Step 5 :** `npm test` → PASS. Arrêter le serveur.
- [ ] **Step 6 : HISTORY** via le skill `updating-history` (§3 : `src/pages/`, `src/build/pages.ts`, `ui/summary.ts`, `ui/drawer.ts`, `public/og/`, sitemap généré ; §5 : décisions d'exécution ; §7 : ligne du merge ; §8 : lot G livré, nouvelles dettes ; §9 ; pied de page). `python tools/history_check.py` → ✓.
- [ ] **Step 7 : Commit** — `feat(pages): cadrages validés et images de partage par page` puis `docs(history): lot G`.
- [ ] **Après merge et déploiement (utilisateur)** : renvoyer le sitemap dans Search Console et Bing, demander l'indexation des pages principales (spec §7).
