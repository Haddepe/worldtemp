# Site public (lot D) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** faire de globelayers.com un site public mondial : tout le site en anglais, référencement et partage (balises, fichiers statiques, image Open Graph, icônes), panneau « About » indexable, mesure d'audience sans cookie, déclaration aux moteurs de recherche.

**Architecture:** une seule langue, l'anglais. Les chaînes d'interface sont centralisées dans `web/src/i18n/en.ts` (`STRINGS`), réexportées par `web/src/i18n/index.ts` ; les messages de console et d'exception passent aussi en anglais mais restent en ligne. Un test garde-fou (`english.test.ts`) interdit tout français dans ce qui est livré au navigateur. Référencement entièrement statique : balises écrites à la main dans `index.html`, fichiers dans `web/public/`. Le beacon Cloudflare Web Analytics est injecté au build de production par un petit plugin Vite. Aucun changement du pipeline, du manifeste, des tuiles, de R2 ni des paramètres d'URL.

**Tech Stack:** TypeScript, Vite, Vitest (environnement **node, sans DOM**), three 0.185 ; Python 3 stdlib + pytest pour `tools/build_geo.py` ; Cloudflare Workers Static Assets (`web/public/_headers`).

**Spec:** `docs/superpowers/specs/2026-09-19-public-site-design.md` — à lire avec ce plan.

## Global Constraints

- Branche `feat/public-site` créée depuis `master` ; merge local `--no-ff` à la fin (T10), jamais de push avant T10.
- Chaque commit se termine par le trailer **littéral** `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` ; vérifier après chaque commit : `git log -1 --format=%B | grep -c 'Claude Fable 5.1'` doit afficher `1`. `git merge` n'accepte pas `-F -` : utiliser `-m`.
- **Ce qui passe en anglais** : toute chaîne livrée au navigateur — texte et attributs du DOM, `index.html`, fichiers statiques, données `geo/`, statuts, erreurs fatales, messages `console.*`, messages d'exception. **Ce qui reste en français** : commentaires du code, noms et descriptions des tests, messages de commit, `HISTORY.md`, specs, plans.
- Traductions : **copier mot pour mot** celles de la spec §3.3 et de ce plan ; ne pas en inventer d'autres.
- Unités métriques conservées (°C, km/h, hPa, mm/h, µg/m³). Point décimal, signe moins typographique `−` (U+2212) conservé, `45%` sans espace, heures `Intl` `en-GB` sur 24 h.
- Paramètres d'URL inchangés (`layer`, `wind`, `labels`, `rivers`, `lon`, `lat`, `d`, `tier`) ; identifiants de couche inchangés (`temp`, `clouds`, …).
- Fichiers texte en **LF**. Aucune nouvelle dépendance npm ni Python.
- Tests front : `cd web && npx vitest run` ; typage : `cd web && npx tsc --noEmit` ; tests Python : `.venv/Scripts/python -m pytest` depuis la racine (venv Windows). Un test Python qui exerce une boucle se lance sous `timeout 100`.
- Vitest tourne **sans DOM** : tout test qui a besoin d'un élément utilise un faux objet (voir `web/tests/toggle.test.ts`).
- Budgets (spec §8.4) : bundle JS ≤ **+2 Ko gzip** par rapport à 161,62 Ko ; `index.html` ≤ 8 Ko gzip ; `og.jpg` ≤ 150 Ko ; `places.json` ≤ 300 Ko ; `countries.json` ≤ 15 Ko ; `rivers.bin` **identique à l'octet**.
- **Ne force jamais un test au vert** : si un test du plan échoue pour une raison que le plan n'a pas prévue, arrête-toi et rapporte-le.
- La machine de l'utilisateur a peu de mémoire (1–2 Go libres) : **aucun serveur Vite ni onglet 3D sans l'accord de l'utilisateur** (T9 seulement). `TaskStop` ne tue pas le node de Vite : `netstat -ano | grep :5173` puis `taskkill //PID <pid> //F`.
- Toute action sur un compte externe (Cloudflare Web Analytics, Google Search Console, Bing Webmaster, DNS) demande l'accord explicite de l'utilisateur au moment de la faire (T10).

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `web/src/i18n/en.ts` (créé) | `STRINGS` : toutes les chaînes d'interface, en anglais |
| `web/src/i18n/index.ts` (créé) | `export { STRINGS } from "./en"` — point d'entrée unique des appelants |
| `web/src/ui/format.ts`, `web/src/layers/registry.ts` (modifiés) | formats anglais : nombres, heures, bandeau, fraîcheur, vent, rose des vents |
| `web/src/ui/layers-menu.ts`, `web/src/ui/overlay.ts`, `web/src/main.ts`, `web/src/geo/wiring.ts` (modifiés) | libellés, statuts, erreurs fatales via `STRINGS` |
| ~20 modules sous `web/src/` (modifiés) | messages de console et d'exception en anglais (T3) |
| `web/tests/english.test.ts` (créé) | garde-fou « aucun français livré » |
| `tools/build_geo.py`, `tests/test_build_geo.py` (modifiés), `web/public/geo/*.json` (régénérés) | noms `name_en` |
| `web/index.html` (modifié) | `lang="en"`, balises du §4 de la spec, panneau About, `aria-label` anglais |
| `web/public/robots.txt`, `sitemap.xml`, `favicon.svg`, `site.webmanifest` (créés), `_headers` (modifié) | fichiers statiques |
| `web/public/og.jpg`, `web/public/apple-touch-icon.png` (créés en T9) | images produites dans le navigateur |
| `web/tests/seo.test.ts` (créé) | balises, fichiers statiques, images |
| `web/src/ui/about.ts` (créé), `web/tests/about.test.ts` (créé), `web/src/style.css` (modifié) | panneau About |
| `web/src/build/beacon.ts` (créé), `web/tests/beacon.test.ts` (créé), `web/vite.config.ts` (modifié) | beacon Cloudflare au build de production |

---

### Task 1 : `STRINGS`, formats anglais et garde-fou

**Files:**
- Create: `web/src/i18n/en.ts`, `web/src/i18n/index.ts`, `web/tests/english.test.ts`
- Modify: `web/src/ui/format.ts`, `web/src/layers/registry.ts`
- Test: `web/tests/format.test.ts`, `web/tests/registry.test.ts`, `web/tests/labels-text.test.ts`, `web/tests/labels-layer.test.ts`, `web/tests/labels-controller.test.ts`

**Interfaces:**
- Produces: `STRINGS` (forme exacte ci-dessous), importé par `import { STRINGS } from "../i18n"` ; `PENDING` dans `english.test.ts`, liste des fichiers pas encore convertis, que T2 et T3 vident.

- [ ] **Step 1 : créer la branche**

```bash
git checkout master && git checkout -b feat/public-site
```

- [ ] **Step 2 : écrire `web/src/i18n/en.ts`**

```ts
/**
 * Chaînes d'interface, en anglais (spec site public §3.2). Seule langue du site aujourd'hui :
 * en ajouter une = ajouter un fichier de même forme et le choisir dans `./index.ts`.
 * Les messages de console et d'exception n'ont pas leur place ici (développeur seulement).
 */
export const STRINGS = {
  layers: {
    none: "None",
    temp: "Temperature",
    clouds: "Clouds",
    rain: "Rain",
    pressure: "Pressure",
    humidity: "Humidity",
    pm25: "PM2.5",
    dust: "Dust",
  },
  layersMenuLabel: "Layer",
  unavailable: "Unavailable",
  toggles: {
    windUnavailable: "Wind unavailable",
    labelsUnavailable: "Labels unavailable",
    riversUnavailable: "Rivers unavailable",
  },
  status: {
    noData: "Data unavailable, retrying in 15 min",
    updateFailed: "Update failed, retrying in 15 min",
    outdated: "Data is outdated",
    noMapDetail: "Map detail unavailable",
    layerUnavailable: "Layer unavailable",
    windUnavailable: "Wind unavailable",
  },
  fatal: {
    noWebgl: "This browser does not support WebGL, which the 3D globe requires.",
    contextLost: "3D rendering was interrupted by the browser. Reload the page.",
    bootFailed: "The globe could not start. Reload the page.",
    reload: "Reload",
  },
  banner: {
    valid: "valid",
    local: "local",
    justNow: "just now",
    minutesAgo: (minutes: number) => `${minutes} min ago`,
    hoursAgo: (hours: number, minutes: number) => `${hours} h ${String(minutes).padStart(2, "0")} min ago`,
  },
  wind: {
    label: "Wind",
    calm: "Calm",
    compass: ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"],
  },
  legend: { isolines: "isolines", min: "min", max: "max" },
  sources: {
    gfs_0p25: "NOAA GFS 0.25°",
    gefs_chem_0p25: "NOAA GEFS-Aerosols 0.25°",
  },
} as const;
```

et `web/src/i18n/index.ts` :

```ts
/** Point d'entrée des chaînes d'interface : une seule langue aujourd'hui (spec site public §3.2). */
export { STRINGS } from "./en";
```

- [ ] **Step 3 : écrire le garde-fou `web/tests/english.test.ts`**

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou « tout ce qui est livré est en anglais » (spec site public §8.1). Seuls les littéraux
 * de chaîne sont contrôlés : les commentaires restent en français. Découpage volontairement
 * simple (commentaires | littéraux) : un littéral d'expression régulière contenant un guillemet
 * le tromperait — aucun dans `src/` aujourd'hui.
 */
const WEB = join(__dirname, "..");
const SRC = join(WEB, "src");
const TOKEN = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const FRENCH_LETTER = /[àâçèéêëîïôùûœÀÂÇÈÉÊËÎÏÔÙÛŒ«»]/;
const FRENCH_WORD = new RegExp(
  "\\b(" +
    [
      "indisponibles?", "vent", "pluie", "nuages", "couches?", "calme", "recharger", "attendue?s?",
      "invalide", "introuvable", "lignes?", "niveau", "tuiles?", "manifeste", "sur", "valide", "locale",
      "il y a", "aucune?", "villes", "pays", "fleuves", "grille", "octets?", "rang", "champs?", "doit",
      "hors", "lecture", "chargement", "isolignes", "poussi", "humidit", "pression",
    ].join("|") +
    ")\\b",
  "i",
);

/** Fichiers pas encore convertis : chaque tâche retire les siens ; vide à la fin de T3. */
const PENDING: string[] = [
  "data/loader.ts", "data/manifest.ts", "data/pixels.ts", "geo/loader.ts", "geo/wiring.ts", "gpu/tier.ts",
  "labels/data.ts", "layers/cache.ts", "main.ts", "render/wind.ts", "rivers/data.ts", "tiles/grid.ts",
  "tiles/index.ts", "tiles/loader.ts", "tiles/manifest.ts", "ui/layers-menu.ts", "ui/overlay.ts",
  "wind/loader.ts", "wind/sim.ts",
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tsFiles(path) : name.endsWith(".ts") ? [path] : [];
  });
}

function frenchLiterals(source: string): string[] {
  return (source.match(TOKEN) ?? [])
    .filter((t) => !t.startsWith("//") && !t.startsWith("/*"))
    .filter((t) => FRENCH_LETTER.test(t) || FRENCH_WORD.test(t));
}

describe("tout ce qui est livré est en anglais (spec site public §3.1)", () => {
  const files = tsFiles(SRC).map((path) => ({ path, rel: relative(SRC, path).replaceAll("\\", "/") }));

  it.each(files.filter((f) => !PENDING.includes(f.rel)))("$rel : aucun littéral français", ({ path }) => {
    expect(frenchLiterals(readFileSync(path, "utf8"))).toEqual([]);
  });

  it("la liste PENDING ne cite que des fichiers existants", () => {
    const known = new Set(files.map((f) => f.rel));
    expect(PENDING.filter((p) => !known.has(p))).toEqual([]);
  });
});
```

- [ ] **Step 4 : lancer le garde-fou, vérifier qu'il échoue sur les deux fichiers de cette tâche**

Run: `cd web && npx vitest run tests/english.test.ts`
Expected: FAIL sur `ui/format.ts` et `layers/registry.ts` (littéraux `"à l'instant"`, `"Vent calme"`, `"Température"`…), vert sur les autres fichiers hors `PENDING`. Si un **autre** fichier échoue, l'ajouter à `PENDING` n'est pas la réponse : arrête-toi et rapporte-le (l'inventaire du plan serait incomplet).

- [ ] **Step 5 : mettre à jour les tests de format (ils doivent devenir rouges)**

Dans `web/tests/format.test.ts`, remplacer les attentes :

| Avant | Après |
|---|---|
| `"il y a 12 min"` | `"12 min ago"` |
| `"à l'instant"` | `"just now"` |
| `"il y a 1 h 35"` | `"1 h 35 min ago"` |
| `"23,4 °C"` | `"23.4 °C"` |
| `"0,1 mm/h"` | `"0.1 mm/h"` |
| `"Vent 36 km/h S"` / `E` / `N` | `"Wind 36 km/h S"` / `E` / `N` |
| `"Vent 36 km/h O"` | `"Wind 36 km/h W"` |
| `"Vent 25 km/h SO"` | `"Wind 25 km/h SW"` |
| `"Vent calme"` (deux fois) | `"Calm"` |

Dans le même fichier, toute attente sur `formatBanner` : `0,25°` → `0.25°`, `valide` → `valid`, `locale)` → `local)`, `il y a …` → forme anglaise ci-dessus. Toute attente sur `legendTicks` avec une virgule décimale passe au point. Toute attente sur `compassPoint` : `O`→`W`, `SO`→`SW`, `NO`→`NW`, `SSO`→`SSW`, `OSO`→`WSW`, `ONO`→`WNW`, `NNO`→`NNW`.

Dans `web/tests/registry.test.ts` : `"23,4 °C"`→`"23.4 °C"`, `"0,0 °C"`→`"0.0 °C"`, `"43 %"`→`"43%"`, `"0,4 mm/h"`→`"0.4 mm/h"`, `"100 %"`→`"100%"`, `"−12,3 °C"`→`"−12.3 °C"` ; toute attente sur un `label` de couche prend la valeur de `STRINGS.layers`.

Dans `web/tests/labels-text.test.ts` : `"50,0 °C"`→`"50.0 °C"`, `"0 %"`→`"0%"`. Dans `web/tests/labels-layer.test.ts` : `"10,0 °C"`→`"10.0 °C"`, `"12,0 °C"`→`"12.0 °C"`. Dans `web/tests/labels-controller.test.ts` : `"50,0 °C"`→`"50.0 °C"`.

Run: `cd web && npx vitest run tests/format.test.ts tests/registry.test.ts tests/labels-text.test.ts tests/labels-controller.test.ts`
Expected: FAIL (le code produit encore du français).

- [ ] **Step 6 : convertir `web/src/layers/registry.ts`**

Ajouter `import { STRINGS } from "../i18n";`. Remplacer `fixed`, `formatTemperature` (commentaire) et `percent` :

```ts
function fixed(v: number, decimals: number): string {
  let s = v.toFixed(decimals);
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  return s.replace("-", "−");
}

/** « 23.4 °C » (spec navigation §6, spec site public §3.3) : une décimale, point, signe « − » U+2212, jamais « −0.0 ». */
export function formatTemperature(celsius: number): string {
  return `${fixed(celsius, 1)} °C`;
}

const percent = (v: number) => `${fixed(v, 0)}%`;
```

Dans le tableau `LAYERS`, remplacer chaque `label: "…"` par la chaîne correspondante : `label: STRINGS.layers.temp`, `.clouds`, `.rain`, `.pressure`, `.humidity`, `.pm25`, `.dust` (les `id`, `unit`, palettes et `ticks` ne changent pas).

- [ ] **Step 7 : convertir `web/src/ui/format.ts`**

Ajouter `import { STRINGS } from "../i18n";`, puis :

```ts
function hhmm(isoUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(
    new Date(isoUtc),
  );
}

export function formatAgo(isoUtc: string, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(isoUtc)) / 60_000));
  if (minutes < 1) return STRINGS.banner.justNow;
  if (minutes < 60) return STRINGS.banner.minutesAgo(minutes);
  return STRINGS.banner.hoursAgo(Math.floor(minutes / 60), minutes % 60);
}

/** Libellés des modèles du manifeste (champ `model`) ; repli sur l'id. */
export const SOURCE_LABELS: Record<string, string> = STRINGS.sources;
```

Dans `formatBanner`, remplacer les deux dernières lignes par :

```ts
  const local = validLocal === validUtc ? "" : ` (${validLocal} ${STRINGS.banner.local})`;
  return `${sourceLabel(entry.model)} · run ${run} UTC · ${STRINGS.banner.valid} ${validUtc} UTC${local} · ${formatAgo(entry.generated_at, nowMs)}`;
```

`tickLabel` perd sa virgule :

```ts
/** Libellé court d'une graduation : entier si entier, sinon une décimale. */
function tickLabel(v: number): string {
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace("-", "−");
}
```

Supprimer la constante locale `COMPASS` et faire lire `STRINGS.wind.compass` à `compassPoint` ; `formatWind` :

```ts
export function compassPoint(deg: number): string {
  return STRINGS.wind.compass[Math.round(deg / 22.5) % 16]!;
}

/** Ligne vent du tooltip (spec vent §10) : « Wind 23 km/h NW », « Calm » sous 1 km/h. */
export function formatWind(u: number, v: number): string {
  const kmh = Math.round(3.6 * Math.hypot(u, v));
  if (kmh < 1) return STRINGS.wind.calm;
  return `${STRINGS.wind.label} ${kmh} km/h ${compassPoint(windDirection(u, v))}`;
}
```

- [ ] **Step 8 : tout relancer**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: `tsc` propre ; tous les tests verts, **y compris** `english.test.ts` sur `ui/format.ts` et `layers/registry.ts`. `VALUE_CHARS` (`labels/select.ts`) reste à 9 : le plus long texte de valeur est toujours « 120 µg/m³ ».

- [ ] **Step 9 : commit**

```bash
git add web/src/i18n web/src/ui/format.ts web/src/layers/registry.ts web/tests
git commit -m "feat(i18n): chaînes d'interface en anglais, formats anglais, garde-fou english.test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 2 : libellés, statuts et erreurs fatales de l'interface

**Files:**
- Modify: `web/src/ui/layers-menu.ts`, `web/src/ui/overlay.ts`, `web/src/main.ts`, `web/src/geo/wiring.ts`, `web/index.html`, `web/tests/english.test.ts`
- Test: `web/tests/geo-wiring.test.ts`, tout test de `layers-menu` ou d'`overlay` qui compare un libellé

**Interfaces:**
- Consumes: `STRINGS` de T1 (`import { STRINGS } from "../i18n"` ; depuis `main.ts` : `"./i18n"`).
- Produces: `index.html` avec `lang="en"` (T6 et T7 modifient le même fichier ensuite).

- [ ] **Step 1 : mettre à jour les attentes des tests (rouge)**

`web/tests/geo-wiring.test.ts` : `"Étiquettes indisponibles"` → `"Labels unavailable"`, `"Fleuves indisponibles"` → `"Rivers unavailable"`. Chercher les autres attentes françaises : `grep -rn "Aucune\|Indisponible\|Recharger\|isolignes" web/tests` ; remplacer par `None`, `Unavailable`, `Reload`, `isolines`.

Run: `cd web && npx vitest run tests/geo-wiring.test.ts`
Expected: FAIL sur les deux titres.

- [ ] **Step 2 : `web/src/geo/wiring.ts`**

Ajouter `import { STRINGS } from "../i18n";`. Remplacer `"Étiquettes indisponibles"` par `STRINGS.toggles.labelsUnavailable` et `"Fleuves indisponibles"` par `STRINGS.toggles.riversUnavailable`. (Les `console.warn` et le `throw` de ce fichier sont traités en T3 : le fichier reste dans `PENDING`.)

- [ ] **Step 3 : `web/src/ui/layers-menu.ts` et `web/src/ui/overlay.ts`**

`layers-menu.ts` : `import { STRINGS } from "../i18n";` ; `container.setAttribute("aria-label", "Couche")` → `STRINGS.layersMenuLabel` ; `button(NONE, "Aucune")` → `button(NONE, STRINGS.layers.none)` ; `disabled ? "Indisponible" : ""` → `disabled ? STRINGS.unavailable : ""`.

`overlay.ts` : `import { STRINGS } from "../i18n";` ; dans `setLegend`, `` ` · isolignes ${def.isoStep} ${def.unit}` `` → `` ` · ${STRINGS.legend.isolines} ${def.isoStep} ${def.unit}` `` ; `<span>min …` et `<span>max …` lisent `STRINGS.legend.min` / `.max` ; `button.textContent = "Recharger"` → `STRINGS.fatal.reload`. (Le `throw` de `byId` est traité en T3.)

- [ ] **Step 4 : `web/src/main.ts`**

`import { STRINGS } from "./i18n";`, puis remplacer chaque littéral :

| Littéral actuel | Remplacement |
|---|---|
| `"Ce navigateur ne prend pas en charge WebGL, nécessaire au globe 3D."` | `STRINGS.fatal.noWebgl` |
| `"Le rendu 3D a été interrompu par le navigateur. Rechargez la page."` | `STRINGS.fatal.contextLost` |
| `"Le globe n'a pas pu démarrer. Rechargez la page."` | `STRINGS.fatal.bootFailed` |
| `"Vent indisponible"` (titre de l'interrupteur, argument de `createToggle`) | `STRINGS.toggles.windUnavailable` |
| `"Vent indisponible"` (affecté à `windNotice`) | `STRINGS.status.windUnavailable` |
| `"Données indisponibles, nouvel essai dans 15 min"` | `STRINGS.status.noData` |
| `"Mise à jour impossible, nouvel essai dans 15 min"` (deux fois) | `STRINGS.status.updateFailed` |
| `"Données anciennes"` | `STRINGS.status.outdated` |
| `"Détail de la carte indisponible"` (deux fois) | `STRINGS.status.noMapDetail` |
| `"Couche indisponible"` | `STRINGS.status.layerUnavailable` |

- [ ] **Step 5 : `web/index.html`**

`<html lang="fr">` → `<html lang="en">` ; `aria-label="Globe 3D météo"` → `aria-label="3D weather globe"` ; `Chargement…` → `Loading…` ; `aria-label="Replier ou déployer les panneaux"` → `aria-label="Collapse or expand panels"` ; `aria-label="Légende de la couche"` → `aria-label="Layer legend"` ; boutons `Vent` / `Étiquettes` / `Fleuves` → `Wind` / `Labels` / `Rivers`. Le `<title>` et la `description` sont réécrits en T6.

- [ ] **Step 6 : étendre le garde-fou à `index.html` et sortir les fichiers terminés de `PENDING`**

Dans `web/tests/english.test.ts`, retirer `"ui/layers-menu.ts"` de `PENDING` (les autres fichiers de cette tâche gardent des messages développeur jusqu'à T3) et ajouter dans le `describe` :

```ts
  it("index.html : aucun texte français", () => {
    const html = readFileSync(join(WEB, "index.html"), "utf8");
    expect(html).toContain('<html lang="en">');
    expect(html.match(FRENCH_LETTER)).toBeNull();
    expect(html.match(FRENCH_WORD)).toBeNull();
  });
```

- [ ] **Step 7 : vérifier**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tout vert. Si `index.html : aucun texte français` échoue sur la balise `description`, c'est attendu **seulement** si elle est encore en français : la traduire tout de suite par `Interactive 3D weather globe: temperature, wind, clouds, rain, pressure, humidity and air quality worldwide, from NOAA GFS data updated hourly.` et `<title>` par `GlobeLayers — Live 3D Weather Globe`.

- [ ] **Step 8 : commit**

```bash
git add web/src web/index.html web/tests
git commit -m "feat(i18n): interface en anglais — menu, légende, statuts, erreurs fatales, index.html

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 3 : messages développeur (console, exceptions) en anglais

**Files:**
- Modify: tous les fichiers encore dans `PENDING` de `web/tests/english.test.ts`
- Test: `web/tests/english.test.ts` (`PENDING` vidé), tests qui comparent un message d'exception

**Interfaces:**
- Consumes: `PENDING` de T1. Produces: `PENDING` supprimé — le garde-fou couvre tout `web/src/`.

- [ ] **Step 1 : vider `PENDING` (rouge)**

Dans `web/tests/english.test.ts`, remplacer le tableau par `const PENDING: string[] = [];`.

Run: `cd web && npx vitest run tests/english.test.ts`
Expected: FAIL, un test rouge par fichier restant, chacun listant ses littéraux français. Cette liste est la feuille de travail de la tâche.

- [ ] **Step 2 : traduire, fichier par fichier**

Les messages restent **en ligne** (pas dans `STRINGS`). Préfixe `[worldtemp]` conservé. Traductions à copier :

| Fichier | Avant → Après |
|---|---|
| `data/loader.ts` | `` `texture ${…}×${…}, grille ${…}×${…} attendue` `` → `` `texture ${…}×${…}, expected grid ${…}×${…}` `` ; `` `HTTP ${r.status} sur ${url}` `` → `` `HTTP ${r.status} for ${url}` `` (deux fois) ; `` `[worldtemp] lecture des pixels de la couche ${this.id} impossible :` `` → `` `[worldtemp] cannot read pixels of layer ${this.id}:` `` |
| `data/manifest.ts` | `"objet attendu"` → `"expected an object"` ; `"nombre attendu"` → `"expected a number"` ; `"entier strictement positif attendu"` → `"expected a strictly positive integer"` ; `"chaîne non vide attendue"` → `"expected a non-empty string"` ; `"date ISO 8601 UTC attendue (YYYY-MM-DDTHH:MM:SSZ)"` → `"expected an ISO 8601 UTC date (YYYY-MM-DDTHH:MM:SSZ)"` ; `` `8 attendu, reçu ${bits}` `` → `` `expected 8, got ${bits}` `` ; `"doit être < max"` → `"must be < max"` ; `"« linear » ou « sqrt » attendu"` → `'expected "linear" or "sqrt"'` ; `` `version inconnue (${…}), 2 attendue` `` → `` `unknown version (${…}), expected 2` `` ; `"aucune couche"` → `"no layer"` |
| `data/pixels.ts` | `"[worldtemp] lecture des pixels de la heatmap impossible :"` → `"[worldtemp] cannot read heatmap pixels:"` |
| `geo/loader.ts` | `"[worldtemp] villes indisponibles :"` → `"[worldtemp] cities unavailable:"` ; `"[worldtemp] pays indisponibles :"` → `"[worldtemp] countries unavailable:"` ; `"étiquettes indisponibles"` → `"labels unavailable"` |
| `geo/wiring.ts` | `"[worldtemp] étiquettes indisponibles :"` → `"[worldtemp] labels unavailable:"` ; `"[worldtemp] fleuves indisponibles :"` → `"[worldtemp] rivers unavailable:"` ; `` `HTTP ${r.status} sur ${url}` `` → `` `HTTP ${r.status} for ${url}` `` |
| `gpu/tier.ts` | `` `paramètre d'URL tier=${forced}` `` → `` `URL parameter tier=${forced}` `` ; `` `GPU « ${i.rendererName} »` `` → `` `GPU "${i.rendererName}"` `` (deux fois) ; `"heuristique par défaut"` → `"default heuristic"` |
| `labels/data.ts` | `` `${key} : objet attendu` `` → `` `${key}: expected an object` `` ; `` `${key} : version ${…} inconnue` `` → `` `${key}: unknown version ${…}` `` ; `` `${key} : tableau attendu` `` → `` `${key}: expected an array` `` ; `` `${key} : ligne de ${width} champs attendue` `` → `` `${key}: expected rows of ${width} fields` `` ; `longitude invalide` / `latitude invalide` / `nom invalide` → `invalid longitude` / `invalid latitude` / `invalid name` (même forme `${key}: …`) ; `"places : population invalide"` → `"places: invalid population"` ; `"places : drapeau de capitale hors {0, 1}"` → `"places: capital flag outside {0, 1}"` ; `"countries : rang invalide"` → `"countries: invalid rank"` |
| `layers/cache.ts` | `"capacité ≥ 1 attendue"` → `"expected capacity ≥ 1"` |
| `main.ts` | `` `HTTP ${m.status} sur manifest.json` `` → `` `HTTP ${m.status} for manifest.json` `` ; `` `HTTP ${i.status} sur ${…}` `` → `` `HTTP ${i.status} for ${…}` `` ; `"canvas #globe introuvable"` → `"canvas #globe not found"` ; `` `[worldtemp] tuiles : map ≤ …, sat ≤ …` `` → `` `[worldtemp] tiles: map ≤ …, sat ≤ …` `` ; `"[worldtemp] tuiles indisponibles, repli Blue Marble 4K :"` → `"[worldtemp] tiles unavailable, falling back to Blue Marble 4K:"` ; `` `[worldtemp] couche ${id} indisponible :` `` → `` `[worldtemp] layer ${id} unavailable:` `` ; `` `[worldtemp] couche ${id} ${entry.run} f${…}, valide ${…}` `` → `` `[worldtemp] layer ${id} ${entry.run} f${…}, valid ${…}` `` ; `"[worldtemp] vent indisponible :"` → `"[worldtemp] wind unavailable:"` ; `"[worldtemp] manifeste indisponible :"` → `"[worldtemp] manifest unavailable:"` |
| `render/wind.ts` | `"tampon de positions de taille inattendue"` → `"unexpected position buffer size"` |
| `rivers/data.ts` | `"en-tête tronqué"` → `"truncated header"` ; `"magic WTRV attendu"` → `"expected magic WTRV"` ; `` `version ${…} inconnue` `` → `` `unknown version ${…}` `` ; `"ligne tronquée"` → `"truncated line"` ; `"octet réservé non nul"` → `"non-zero reserved byte"` ; `"ligne de moins de deux points"` → `"line with fewer than two points"` ; `"lignes non triées par rang"` → `"lines not sorted by rank"` ; `"points tronqués"` → `"truncated points"` ; `"coordonnée hors bornes"` → `"coordinate out of range"` ; `"octets en trop"` → `"trailing bytes"` |
| `tiles/grid.ts` | `` `${…} n'est pas un ancêtre de ${…}` `` → `` `${…} is not an ancestor of ${…}` `` |
| `tiles/index.ts` | `"en-tête invalide"` → `"invalid header"` ; `` `niveau ${z} tronqué` `` → `` `truncated level ${z}` `` |
| `tiles/loader.ts` | `` `HTTP ${r.status} sur ${url}` `` → `` `HTTP ${r.status} for ${url}` `` |
| `tiles/manifest.ts` | `` `${what} : objet attendu` `` → `` `${what}: expected an object` `` ; `` `${what}.${field} : entier ≥ 0 attendu` `` → `` `${what}.${field}: expected an integer ≥ 0` `` ; `` `${what}.${field} : chaîne attendue` `` → `` `${what}.${field}: expected a string` `` ; `"schema_version 1 attendu"` → `"expected schema_version 1"` |
| `ui/overlay.ts` | `` `élément #${id} introuvable` `` → `` `element #${id} not found` `` |
| `wind/loader.ts` | `"encodage du vent non linéaire"` → `"non-linear wind encoding"` ; `` `vent ${…}×${…}, grille ${…}×${…} attendue` `` → `` `wind ${…}×${…}, expected grid ${…}×${…}` `` ; `"pixels du vent illisibles"` → `"unreadable wind pixels"` |
| `wind/sim.ts` | `"count ≥ 1, trail ≥ 2 et stride ≥ 1 attendus"` → `"expected count ≥ 1, trail ≥ 2 and stride ≥ 1"` |

Un littéral français que ce tableau ne cite pas mais que le garde-fou signale : le traduire dans le même esprit et le citer dans le rapport de tâche.

- [ ] **Step 3 : mettre à jour les tests qui comparent un message**

Run: `cd web && npx vitest run`
Tout test rouge parce qu'il attend l'ancien message français (`toThrowError("…")`, `toHaveBeenCalledWith("[worldtemp] …")`) : remplacer l'attente par la traduction du tableau. Ne toucher à **aucune autre** assertion.

- [ ] **Step 4 : supprimer `PENDING`**

Dans `web/tests/english.test.ts`, supprimer la constante `PENDING`, son commentaire, le filtre `.filter((f) => !PENDING.includes(f.rel))` et le test `la liste PENDING ne cite que des fichiers existants`.

Run: `cd web && npx tsc --noEmit && npx vitest run && npx vite build 2>&1 | grep "index-"`
Expected: tout vert ; taille gzip du bundle ≤ 163,62 Ko.

- [ ] **Step 5 : commit**

```bash
git add web/src web/tests
git commit -m "feat(i18n): messages de console et d'exception en anglais, garde-fou sur tout src/

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 4 : noms géographiques en anglais

**Files:**
- Modify: `tools/build_geo.py`, `tests/test_build_geo.py`
- Regenerate: `web/public/geo/places.json`, `web/public/geo/countries.json`

**Interfaces:**
- Consumes: cache local `tools/.geo-cache/` (Natural Earth v5.1.2, déjà présent ; sinon le script le télécharge).
- Produces: fichiers `geo/` en anglais, même schéma (`[lon, lat, name, pop, cap]`, `[lon, lat, name, rank]`).

- [ ] **Step 1 : tests rouges**

Dans `tests/test_build_geo.py` :
- helpers `place(...)` et `country(...)` : renommer le paramètre `name_fr` en `name_en` et la clé `"NAME_FR"` en `"NAME_EN"` ; renommer de même tous les appels (`name_fr="Allemagne"` → `name_en="Germany"`, `name_fr="Russie"` → `name_en="Russia"`, `name_fr="Croatie"` → `name_en="Croatia"`, `name_fr="Malte"` → `name_en="Malta"`, `name_fr="Cité du Vatican"` → `name_en="Vatican"`, `name_fr="Monaco"`/`"France"`/`"Luxembourg"`/`"Kosovo"` inchangés en valeur) ;
- `test_props_ignore_la_casse_des_cles` : `{"NAME_EN": "Paris", "pop_max": 3}` → `{"name_en": "Paris", "pop_max": 3}` ;
- renommer `test_build_places_name_fr_vide_replie_sur_name` en `test_build_places_name_en_vide_replie_sur_name` (`name_en=""`) ;
- `test_build_countries_point_d_etiquette_rang_et_tri` : attendu `[[44.69, 58.25, "Russia", 1], [2.55, 46.7, "France", 2], [9.68, 50.96, "Germany", 2]]` (tri par rang puis **nom anglais** : France avant Germany) ;
- `test_build_countries_ecarte_les_rangs_jamais_affichables` : attendu `[("Croatia", 6), ("Malta", 7)]` ;
- `test_build_countries_tri_tient_compte_du_rang_majore` : attendu `["Luxembourg", "Malta"]` ;
- ajouter :

```python
def test_name_prefere_name_en_puis_name():
    assert bg._name({"name_en": "Munich", "name": "München", "name_fr": "Munich (fr)"}) == "Munich"
    assert bg._name({"name_en": "", "name": "München"}) == "München"
    assert bg._name({"name_fr": "Allemagne"}) == ""
```

- `test_fichiers_commites_places` : inchangé sauf si un nom témoin diffère en anglais (`Paris`, `Tokyo`, `Lyon`, `Marseille`, `Monaco` sont identiques) ;
- `test_fichiers_commites_countries` : `{"France", "Japon", "Brésil"}` → `{"France", "Japan", "Brazil", "Germany"}` ; ajouter `assert not {"Japon", "Brésil", "Allemagne"} & set(by_name)` ; micro-États `("Monaco", "Andorre", "Cité du Vatican")` → `("Monaco", "Andorra", "Vatican")` ; vrais pays `("Croatie", "Luxembourg")` → `("Croatia", "Luxembourg")`.

Run: `timeout 100 .venv/Scripts/python -m pytest tests/test_build_geo.py -q`
Expected: FAIL (`_name` lit encore `name_fr`, fichiers commités en français).

- [ ] **Step 2 : `tools/build_geo.py`**

```python
def _name(p: dict) -> str:
    """Nom anglais (site en anglais, spec site public §3.4) ; repli sur le nom local."""
    return (p.get("name_en") or p.get("name") or "").strip()
```

Mettre à jour la docstring de `props` (`NAME_FR` → `NAME_EN`) et le commentaire d'en-tête du fichier s'il cite `NAME_FR`.

- [ ] **Step 3 : régénérer et vérifier que les fleuves n'ont pas bougé**

```bash
sha1sum web/public/geo/rivers.bin > /tmp/rivers.before
timeout 110 .venv/Scripts/python tools/build_geo.py
sha1sum -c /tmp/rivers.before
git status --short web/public/geo
```

Expected: `rivers.bin: OK` ; seuls `places.json` et `countries.json` modifiés. Si le nom anglais de « Vatican » n'est pas exactement `Vatican` dans Natural Earth (`Vatican City`…), adapter le nom témoin du test au nom réel **lu dans le fichier généré**, et le dire dans le rapport.

- [ ] **Step 4 : tests verts**

Run: `timeout 110 .venv/Scripts/python -m pytest -q`
Expected: tout vert (mêmes skips qu'avant : eccodes, GDAL).

- [ ] **Step 5 : commit**

```bash
git add tools/build_geo.py tests/test_build_geo.py web/public/geo
git commit -m "feat(geo): noms de villes et de pays en anglais (name_en)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 5 : `<head>` et fichiers statiques

**Files:**
- Create: `web/public/robots.txt`, `web/public/sitemap.xml`, `web/public/favicon.svg`, `web/public/site.webmanifest`, `web/tests/seo.test.ts`
- Modify: `web/index.html` (`<head>`), `web/public/_headers`

**Interfaces:**
- Produces: `seo.test.ts` avec les helpers `read(path)` et `metaContent(html, key)` ; T7 et T9 y ajoutent des tests.

- [ ] **Step 1 : écrire `web/tests/seo.test.ts` (rouge)**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..");
const SITE = "https://globelayers.com";
const read = (path: string) => readFileSync(join(WEB, path), "utf8");
const html = read("index.html");

/** Contenu de `<meta name|property="key" content="…">`. */
function metaContent(source: string, key: string): string | null {
  const m = source.match(new RegExp(`<meta\\s+(?:name|property)="${key}"\\s+content="([^"]*)"`));
  return m ? m[1]! : null;
}

describe("référencement — <head> (spec site public §4)", () => {
  it("langue, titre, description courte", () => {
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>GlobeLayers — Live 3D Weather Globe</title>");
    const description = metaContent(html, "description")!;
    expect(description.length).toBeGreaterThan(80);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("canonical, robots, theme-color", () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE}/" />`);
    expect(metaContent(html, "robots")).toBe("index, follow");
    expect(metaContent(html, "theme-color")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("Open Graph et Twitter : URL absolues, image 1200 × 630", () => {
    expect(metaContent(html, "og:type")).toBe("website");
    expect(metaContent(html, "og:site_name")).toBe("GlobeLayers");
    expect(metaContent(html, "og:locale")).toBe("en_US");
    expect(metaContent(html, "og:url")).toBe(`${SITE}/`);
    expect(metaContent(html, "og:image")).toBe(`${SITE}/og.jpg`);
    expect(metaContent(html, "og:image:width")).toBe("1200");
    expect(metaContent(html, "og:image:height")).toBe("630");
    for (const key of ["og:title", "og:description", "og:image:alt", "twitter:title", "twitter:description"]) {
      expect(metaContent(html, key), key).toBeTruthy();
    }
    expect(metaContent(html, "twitter:card")).toBe("summary_large_image");
    expect(metaContent(html, "twitter:image")).toBe(`${SITE}/og.jpg`);
  });

  it("icônes et manifeste", () => {
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />');
  });

  it("JSON-LD WebApplication parsable", () => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const ld = JSON.parse(m![1]!);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("WebApplication");
    expect(ld.name).toBe("GlobeLayers");
    expect(ld.url).toBe(`${SITE}/`);
    expect(ld.applicationCategory).toBe("WeatherApplication");
    expect(ld.inLanguage).toBe("en");
    expect(ld.isAccessibleForFree).toBe(true);
    expect(ld.offers.price).toBe("0");
    expect(ld.image).toBe(`${SITE}/og.jpg`);
  });
});

describe("référencement — fichiers statiques (spec site public §6)", () => {
  it("robots.txt autorise tout et cite le sitemap", () => {
    const robots = read("public/robots.txt");
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it("sitemap.xml : une URL, celle du canonical", () => {
    const locs = [...read("public/sitemap.xml").matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${SITE}/`]);
  });

  it("favicon.svg et manifeste", () => {
    expect(read("public/favicon.svg")).toContain("<svg");
    const manifest = JSON.parse(read("public/site.webmanifest"));
    expect(manifest.name).toBe("GlobeLayers");
    expect(manifest.display).toBe("browser");
    expect(manifest.icons.map((i: { src: string }) => i.src)).toEqual(["/favicon.svg", "/apple-touch-icon.png"]);
    expect(manifest.theme_color).toBe(metaContent(html, "theme-color"));
  });

  it("_headers : cache d'un jour pour les fichiers de référencement", () => {
    const headers = read("public/_headers");
    for (const path of ["/og.jpg", "/favicon.svg", "/apple-touch-icon.png", "/site.webmanifest", "/robots.txt", "/sitemap.xml"]) {
      expect(headers, path).toContain(`${path}\n  Cache-Control: public, max-age=86400`);
    }
  });

  it("aucun fichier statique en CRLF", () => {
    for (const path of ["public/robots.txt", "public/sitemap.xml", "public/favicon.svg", "public/site.webmanifest", "public/_headers"]) {
      expect(existsSync(join(WEB, path)), path).toBe(true);
      expect(read(path).includes("\r"), path).toBe(false);
    }
  });
});
```

Run: `cd web && npx vitest run tests/seo.test.ts`
Expected: FAIL (balises et fichiers absents).

- [ ] **Step 2 : `<head>` de `web/index.html`**

Le fond du site est noir (`background: #000`, `web/src/style.css:13`) : `theme-color` et `background_color` valent `#000000`. Remplacer le contenu du `<head>` par :

```html
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>GlobeLayers — Live 3D Weather Globe</title>
    <meta name="description" content="Interactive 3D weather globe: temperature, wind, clouds, rain, pressure, humidity and air quality worldwide, from NOAA GFS data updated hourly." />
    <meta name="robots" content="index, follow" />
    <meta name="theme-color" content="#000000" />
    <link rel="canonical" href="https://globelayers.com/" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="GlobeLayers" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:url" content="https://globelayers.com/" />
    <meta property="og:title" content="GlobeLayers — Live 3D Weather Globe" />
    <meta property="og:description" content="Explore today's weather on an interactive 3D globe: temperature, animated wind, clouds, rain, pressure, humidity and air quality." />
    <meta property="og:image" content="https://globelayers.com/og.jpg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="3D globe showing world temperature and animated wind over Europe and the Atlantic" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="GlobeLayers — Live 3D Weather Globe" />
    <meta name="twitter:description" content="Explore today's weather on an interactive 3D globe: temperature, animated wind, clouds, rain, pressure, humidity and air quality." />
    <meta name="twitter:image" content="https://globelayers.com/og.jpg" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": "GlobeLayers",
        "url": "https://globelayers.com/",
        "description": "Interactive 3D weather globe: temperature, wind, clouds, rain, pressure, humidity and air quality worldwide, from NOAA GFS data updated hourly.",
        "applicationCategory": "WeatherApplication",
        "operatingSystem": "Any",
        "browserRequirements": "Requires WebGL",
        "inLanguage": "en",
        "isAccessibleForFree": true,
        "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
        "image": "https://globelayers.com/og.jpg"
      }
    </script>
    <link rel="stylesheet" href="/src/style.css" />
```

- [ ] **Step 3 : fichiers statiques**

`web/public/robots.txt` :

```
User-agent: *
Allow: /

Sitemap: https://globelayers.com/sitemap.xml
```

`web/public/sitemap.xml` :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://globelayers.com/</loc>
  </url>
</urlset>
```

`web/public/favicon.svg` (globe à méridiens, lisible à 16 px sur fond clair comme sombre) :

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffd166" />
      <stop offset="0.55" stop-color="#ef476f" />
      <stop offset="1" stop-color="#26547c" />
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="29" fill="url(#g)" stroke="#0b0f14" stroke-width="3" />
  <g fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="2.5">
    <ellipse cx="32" cy="32" rx="12" ry="29" />
    <path d="M4 32h56M9 17h46M9 47h46" />
  </g>
</svg>
```

`web/public/site.webmanifest` (mêmes couleurs que `theme-color`) :

```json
{
  "name": "GlobeLayers",
  "short_name": "GlobeLayers",
  "description": "Live 3D weather globe",
  "start_url": "/",
  "display": "browser",
  "theme_color": "#000000",
  "background_color": "#000000",
  "icons": [
    { "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml" },
    { "src": "/apple-touch-icon.png", "sizes": "180x180", "type": "image/png" }
  ]
}
```

Ajouter à la fin de `web/public/_headers` (une ligne vide entre les blocs, comme l'existant) :

```
/og.jpg
  Cache-Control: public, max-age=86400

/favicon.svg
  Cache-Control: public, max-age=86400

/apple-touch-icon.png
  Cache-Control: public, max-age=86400

/site.webmanifest
  Cache-Control: public, max-age=86400

/robots.txt
  Cache-Control: public, max-age=86400

/sitemap.xml
  Cache-Control: public, max-age=86400
```

- [ ] **Step 4 : vérifier**

Run: `cd web && npx vitest run tests/seo.test.ts tests/english.test.ts`
Expected: PASS. (`og.jpg` et `apple-touch-icon.png` n'existent pas encore : aucun test de cette tâche ne les lit ; T9 les crée et ajoute leurs tests.)

- [ ] **Step 5 : commit**

```bash
git add web/index.html web/public web/tests/seo.test.ts
git commit -m "feat(seo): balises Open Graph, JSON-LD, canonical, robots, sitemap, favicon, manifeste

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 6 : panneau « About »

**Files:**
- Create: `web/src/ui/about.ts`, `web/tests/about.test.ts`
- Modify: `web/index.html` (`<body>`), `web/src/style.css`, `web/src/main.ts`, `web/tests/seo.test.ts`

**Interfaces:**
- Produces: `createAbout(dialog, openButton, closeButton): void` dans `web/src/ui/about.ts`.

- [ ] **Step 1 : `web/tests/about.test.ts` (rouge)**

```ts
import { describe, expect, it, vi } from "vitest";
import { createAbout } from "../src/ui/about";

/** Faux éléments : Vitest tourne sans DOM. */
function fakeButton() {
  let click: (() => void) | null = null;
  return { el: { addEventListener: (_: string, cb: () => void) => { click = cb; } } as unknown as HTMLButtonElement, click: () => click?.() };
}
function fakeDialog() {
  let onClick: ((e: { target: unknown }) => void) | null = null;
  const dialog = {
    open: false,
    showModal: vi.fn(() => { dialog.open = true; }),
    close: vi.fn(() => { dialog.open = false; }),
    addEventListener: (_: string, cb: (e: { target: unknown }) => void) => { onClick = cb; },
  };
  return { el: dialog as unknown as HTMLDialogElement, raw: dialog, clickOn: (target: unknown) => onClick?.({ target }) };
}

describe("createAbout — panneau About (spec site public §5)", () => {
  it("le bouton « ? » ouvre en modal, une seule fois", () => {
    const d = fakeDialog(), open = fakeButton(), close = fakeButton();
    createAbout(d.el, open.el, close.el);
    open.click();
    open.click();
    expect(d.raw.showModal).toHaveBeenCalledTimes(1);
  });
  it("le bouton Close ferme", () => {
    const d = fakeDialog(), open = fakeButton(), close = fakeButton();
    createAbout(d.el, open.el, close.el);
    open.click();
    close.click();
    expect(d.raw.close).toHaveBeenCalledTimes(1);
  });
  it("un clic sur le fond (la cible est le dialog lui-même) ferme ; un clic dans le contenu ne ferme pas", () => {
    const d = fakeDialog(), open = fakeButton(), close = fakeButton();
    createAbout(d.el, open.el, close.el);
    open.click();
    d.clickOn({ some: "paragraph" });
    expect(d.raw.close).not.toHaveBeenCalled();
    d.clickOn(d.el);
    expect(d.raw.close).toHaveBeenCalledTimes(1);
  });
});
```

Run: `cd web && npx vitest run tests/about.test.ts` — Expected: FAIL (module absent).

- [ ] **Step 2 : `web/src/ui/about.ts`**

```ts
/**
 * Panneau « About » (spec site public §5) : `<dialog>` natif ouvert en modal — piège à focus,
 * Échap et retour du focus au bouton sont fournis par le navigateur. Le contenu vit dans
 * `index.html` (HTML initial, indexable) ; ici, seulement l'ouverture et la fermeture.
 */
export function createAbout(dialog: HTMLDialogElement, openButton: HTMLButtonElement, closeButton: HTMLButtonElement): void {
  openButton.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
  });
  closeButton.addEventListener("click", () => dialog.close());
  // Le contenu est enveloppé dans un <div> : une cible égale au dialog = clic sur le fond.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
}
```

- [ ] **Step 3 : HTML**

Dans `web/index.html`, dans `#banner`, avant `#toggle-overlay` :

```html
        <button id="about-open" type="button" aria-label="About GlobeLayers" aria-haspopup="dialog">?</button>
```

et juste avant `<div id="tooltip"` :

```html
    <dialog id="about" aria-labelledby="about-title">
      <div class="about-body">
        <button id="about-close" type="button" aria-label="Close">×</button>
        <h1 id="about-title">GlobeLayers</h1>
        <p>GlobeLayers is a live 3D weather globe. Spin it, zoom in, and read today's weather anywhere on Earth, straight from open forecast data.</p>
        <h2>Layers</h2>
        <ul>
          <li><strong>Temperature</strong> — air temperature 2 m above ground, in °C.</li>
          <li><strong>Wind</strong> — animated streamlines of the 10 m wind; speed and direction on hover.</li>
          <li><strong>Clouds</strong> — total cloud cover, in %.</li>
          <li><strong>Rain</strong> — precipitation rate, in mm/h.</li>
          <li><strong>Pressure</strong> — mean sea-level pressure with isobars, in hPa.</li>
          <li><strong>Humidity</strong> — relative humidity 2 m above ground, in %.</li>
          <li><strong>PM2.5</strong> and <strong>Dust</strong> — fine particles and desert dust near the surface, in µg/m³.</li>
          <li><strong>Labels</strong> and <strong>Rivers</strong> — cities with the value of the active layer, countries, and major rivers.</li>
        </ul>
        <h2>Data &amp; freshness</h2>
        <p>Weather layers come from the NOAA GFS model at 0.25° resolution and are refreshed every hour; air quality comes from NOAA GEFS-Aerosols, refreshed every 3 hours. Forecast data reaches the globe 4 to 6 hours after each model run, and the banner always shows the run and valid time on screen.</p>
        <h2>Sources &amp; credits</h2>
        <p>NOAA GFS and GEFS-Aerosols (public domain) · NASA Blue Marble · GEBCO bathymetry and relief · © OpenStreetMap contributors · Natural Earth.</p>
        <h2>Privacy</h2>
        <p>GlobeLayers uses cookie-free audience measurement by Cloudflare Web Analytics. No personal data is collected and there are no advertising trackers.</p>
      </div>
    </dialog>
```

- [ ] **Step 4 : câblage et style**

`web/src/main.ts`, juste après `const ui = createOverlay();` :

```ts
  createAbout(byId<HTMLDialogElement>("about"), byId<HTMLButtonElement>("about-open"), byId<HTMLButtonElement>("about-close"));
```

avec les imports `import { createAbout } from "./ui/about";` et `byId` ajouté à l'import existant de `./ui/overlay` (`import { byId, createOverlay } from "./ui/overlay";`).

`web/src/style.css`, à la fin (réutiliser les variables `--panel-bg` et `--panel-muted` existantes) :

```css
/* Panneau About (spec site public §5) : <dialog> modal, contenu indexable dans index.html. */
#about-open {
  background: none; border: 1px solid currentColor; border-radius: 50%;
  width: 1.4rem; height: 1.4rem; padding: 0; color: inherit; font: inherit; line-height: 1; cursor: pointer;
}
#about {
  padding: 0; border: none; border-radius: 0.75rem; color: inherit;
  background: var(--panel-bg); backdrop-filter: blur(10px);
  width: min(36rem, calc(100vw - 2rem)); max-height: calc(100vh - 2rem);
}
#about::backdrop { background: rgba(0, 0, 0, 0.55); }
#about .about-body { position: relative; padding: 1.25rem 1.5rem 1.5rem; overflow-y: auto; max-height: calc(100vh - 2rem); }
#about h1 { font-size: 1.3rem; margin: 0 0 0.5rem; }
#about h2 { font-size: 0.95rem; margin: 1.1rem 0 0.35rem; color: var(--panel-muted); text-transform: uppercase; letter-spacing: 0.04em; }
#about p, #about li { font-size: 0.9rem; line-height: 1.45; }
#about ul { margin: 0; padding-left: 1.1rem; }
#about-close {
  position: absolute; top: 0.6rem; right: 0.75rem; background: none; border: none;
  color: inherit; font-size: 1.5rem; line-height: 1; cursor: pointer;
}
```

`#banner` est un `.panel` (`pointer-events: auto`) : le bouton y est cliquable sans règle de plus.

- [ ] **Step 5 : le texte est dans le HTML initial — ajouter à `web/tests/seo.test.ts`**

```ts
describe("panneau About (spec site public §5)", () => {
  it("texte indexable dans le HTML initial", () => {
    for (const heading of ['<h1 id="about-title">GlobeLayers</h1>', "<h2>Layers</h2>", "<h2>Data &amp; freshness</h2>", "<h2>Sources &amp; credits</h2>", "<h2>Privacy</h2>"]) {
      expect(html, heading).toContain(heading);
    }
    expect(html).toContain("cookie-free audience measurement");
    expect(html).toContain('id="about-open"');
  });
});
```

- [ ] **Step 6 : vérifier**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tout vert, `english.test.ts` compris.

- [ ] **Step 7 : commit**

```bash
git add web/src web/index.html web/tests
git commit -m "feat(about): panneau About en <dialog>, texte indexable dans le HTML initial

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 7 : beacon Cloudflare Web Analytics au build de production

**Files:**
- Create: `web/src/build/beacon.ts`, `web/tests/beacon.test.ts`
- Modify: `web/vite.config.ts`

**Interfaces:**
- Produces: `beaconTag(token: string): string` et `CF_BEACON_TOKEN` (chaîne vide tant que l'utilisateur n'a pas fourni le jeton ; T10 la remplit).

- [ ] **Step 1 : `web/tests/beacon.test.ts` (rouge)**

```ts
import { describe, expect, it } from "vitest";
import { beaconTag } from "../src/build/beacon";

describe("beaconTag — Cloudflare Web Analytics (spec site public §7)", () => {
  it("jeton vide : rien n'est injecté", () => {
    expect(beaconTag("")).toBe("");
    expect(beaconTag("   ")).toBe("");
  });
  it("jeton présent : script différé, jeton dans data-cf-beacon", () => {
    const token = "0123456789abcdef0123456789abcdef";
    expect(beaconTag(token)).toBe(
      `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${token}"}'></script>`,
    );
  });
  it("jeton non hexadécimal : refusé plutôt qu'injecté dans le HTML", () => {
    expect(() => beaconTag('x"><script>')).toThrowError("invalid Cloudflare beacon token");
  });
});
```

Run: `cd web && npx vitest run tests/beacon.test.ts` — Expected: FAIL (module absent).

- [ ] **Step 2 : `web/src/build/beacon.ts`**

```ts
/**
 * Beacon Cloudflare Web Analytics (spec site public §7). Module de build : importé par
 * `vite.config.ts` seulement, jamais par le site — il n'entre pas dans le bundle.
 * Le jeton est public par nature (il est lu dans le HTML de la page).
 */
export const CF_BEACON_TOKEN = "";

export function beaconTag(token: string): string {
  const t = token.trim();
  if (t === "") return "";
  if (!/^[0-9a-f]{32}$/i.test(t)) throw new Error("invalid Cloudflare beacon token");
  return `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${t}"}'></script>`;
}
```

- [ ] **Step 3 : plugin dans `web/vite.config.ts`**

```ts
import { defineConfig, type Plugin } from "vitest/config";
import { CF_BEACON_TOKEN, beaconTag } from "./src/build/beacon";

/** Injecté au build de production seulement : `vite dev` et `localhost` ne sont pas comptés. */
function cloudflareBeacon(): Plugin {
  return {
    name: "worldtemp:cloudflare-beacon",
    apply: "build",
    transformIndexHtml: (html) => html.replace("</body>", `  ${beaconTag(CF_BEACON_TOKEN)}\n  </body>`),
  };
}
```

et ajouter `plugins: [cloudflareBeacon()],` dans l'objet de `defineConfig` (garder `server` et `test` tels quels). Si `Plugin` n'est pas exporté par `vitest/config`, l'importer de `"vite"` (`import type { Plugin } from "vite";`).

- [ ] **Step 4 : vérifier**

Run: `cd web && npx tsc --noEmit && npx vitest run && npx vite build 2>&1 | grep "index-" && grep -c cloudflareinsights dist/index.html`
Expected: tests verts ; le `grep -c` affiche `0` (jeton vide : rien d'injecté) ; bundle JS ≤ 163,62 Ko gzip.

- [ ] **Step 5 : commit**

```bash
git add web/src/build web/tests/beacon.test.ts web/vite.config.ts
git commit -m "feat(analytics): beacon Cloudflare Web Analytics injecté au build de production

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 8 : revue de cohérence avant le navigateur (contrôleur)

**Files:** aucun nouveau ; corrections ponctuelles si la revue en trouve.

- [ ] **Step 1 : le bundle livré ne contient plus de français**

```bash
cd web && npx vite build >/dev/null 2>&1
grep -c "indisponible\|Vent \|Nuages\|Pluie\|attendu\|Recharger\|il y a" dist/assets/index-*.js dist/index.html
```

Expected: `0` pour chaque fichier. Tout résultat non nul : retrouver la source, corriger, relancer `npx vitest run`, et ajouter le mot à `FRENCH_WORD` s'il avait échappé au garde-fou.

- [ ] **Step 2 : les données geo sont en anglais**

```bash
grep -o '"Allemagne"\|"Japon"\|"Espagne"\|"Londres"\|"Vienne"\|"Pékin"' web/public/geo/*.json | head
grep -o '"Germany"\|"Japan"\|"Spain"\|"London"\|"Vienna"\|"Beijing"' web/public/geo/*.json | sort -u
```

Expected: première commande vide ; seconde : les six noms.

- [ ] **Step 3 : suites complètes**

Run: `cd web && npx tsc --noEmit && npx vitest run` puis, depuis la racine, `timeout 110 .venv/Scripts/python -m pytest -q`
Expected: tout vert. Commit seulement si quelque chose a été corrigé (`fix(i18n): …`).

---

### Task 9 : validation navigateur, image Open Graph et icône (contrôleur, **accord de l'utilisateur requis**)

**Files:**
- Create: `web/public/og.jpg`, `web/public/apple-touch-icon.png`
- Modify: `web/tests/seo.test.ts`
- Rapport : `.superpowers/sdd/2026-09-19-public-site/validation-report.md` (git-ignoré)

- [ ] **Step 1 : demander l'accord de l'utilisateur** (mémoire libre ≥ 1,5 Go : `Get-CimInstance Win32_OperatingSystem`), puis `cd web && npx vite build && npx vite preview --port 5173 --strictPort` en arrière-plan. Outils : `mcp__brave-devtools__*` ; `select_page bringToFront: true` indispensable ; viewport par `emulate`.

- [ ] **Step 2 : revue « tout en anglais » à l'œil** — 1000×800 puis 500×800 (`emulate 500x800x2,mobile,touch`), URL `http://localhost:5173/?layer=temp&lon=2&lat=46.5&d=1.35`. Relever par script **tout le texte visible et annoncé** :

```js
() => ({
  title: document.title, lang: document.documentElement.lang,
  text: document.body.innerText,
  attrs: [...document.querySelectorAll("[aria-label],[title],[alt]")].map((e) => [e.id || e.tagName, e.getAttribute("aria-label"), e.getAttribute("title"), e.getAttribute("alt")]),
  labels: [...document.querySelectorAll("#labels .label.on")].slice(0, 40).map((l) => l.textContent),
})
```

Le refaire pour chaque couche (clic sur chaque radio : légende + étiquettes avec valeur), avec le tooltip affiché (survol), à `d=1.1` sans couche, et à `lon=139&lat=36` (Asie : noms anglais). Les statuts et les écrans fatals ne se déclenchent pas à la demande : leurs textes sont couverts par `STRINGS` (T1), le garde-fou et le contrôle du bundle (T8). Aucun mot français nulle part : critère 1.

- [ ] **Step 3 : panneau About** — clic sur `?` : ouvert, fond assombri ; `Échap` ferme et rend le focus à `?` (`document.activeElement.id === "about-open"`) ; clic sur le fond ferme ; à 500 px le contenu défile sans déborder (`dialog.getBoundingClientRect()` dans le viewport).

- [ ] **Step 4 : Lighthouse SEO** — `mcp__brave-devtools__lighthouse_audit` sur `http://localhost:5173/`, catégorie SEO ≥ 95. Noter le score et chaque audit en échec.

- [ ] **Step 5 : image Open Graph** — `emulate 1200x630x1`, URL `http://localhost:5173/?layer=temp&wind=1&lon=-15&lat=45&d=1.9` ; replier les panneaux (`#toggle-overlay`), attendre 6 s (tuiles + traînées), puis injecter le nom :

```js
() => {
  const t = document.createElement("div");
  t.textContent = "GlobeLayers";
  t.style.cssText = "position:fixed;left:48px;bottom:40px;font:700 64px system-ui,sans-serif;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.7);z-index:99";
  const s = document.createElement("div");
  s.textContent = "Live 3D weather globe";
  s.style.cssText = "position:fixed;left:52px;bottom:16px;font:400 24px system-ui,sans-serif;color:#fff;opacity:.9;text-shadow:0 1px 8px rgba(0,0,0,.7);z-index:99";
  document.getElementById("banner").style.visibility = "hidden";
  document.getElementById("attribution").style.visibility = "hidden";
  document.body.append(t, s);
}
```

`take_screenshot` avec `format: "jpeg"`, `quality: 82`, `filePath` = chemin absolu de `web/public/og.jpg`. Si le fichier dépasse 150 Ko, reprendre à `quality: 70`.

- [ ] **Step 6 : icône Apple** — sur une page `about:blank`, dessiner `favicon.svg` sur un canvas 180×180 à fond plein et récupérer le PNG :

```js
async () => {
  const svg = await (await fetch("http://localhost:5173/favicon.svg")).text();
  const img = new Image();
  img.src = "data:image/svg+xml;base64," + btoa(svg);
  await img.decode();
  const c = document.createElement("canvas");
  c.width = c.height = 180;
  const g = c.getContext("2d");
  g.fillStyle = "#000000";
  g.fillRect(0, 0, 180, 180);
  g.drawImage(img, 18, 18, 144, 144);
  return c.toDataURL("image/png");
}
```

Décoder la data-URL en fichier (`python -c "import base64,sys; open('web/public/apple-touch-icon.png','wb').write(base64.b64decode(sys.argv[1].split(',')[1]))" "<dataurl>"`). Si `fetch` depuis `about:blank` est refusé, exécuter le même script sur la page `http://localhost:5173/`. Couleur de fond = `theme-color` (`#000000`).

- [ ] **Step 7 : tests des images — ajouter à `web/tests/seo.test.ts`**

```ts
/** Dimensions d'un JPEG : premier marqueur SOF0/SOF1/SOF2 (FFC0–FFC2). */
function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let o = 2;
  while (o + 9 < bytes.length) {
    if (bytes[o] !== 0xff) throw new Error("invalid JPEG marker");
    const marker = bytes[o + 1]!;
    const length = (bytes[o + 2]! << 8) | bytes[o + 3]!;
    if (marker >= 0xc0 && marker <= 0xc2) return { height: (bytes[o + 5]! << 8) | bytes[o + 6]!, width: (bytes[o + 7]! << 8) | bytes[o + 8]! };
    o += 2 + length;
  }
  throw new Error("no SOF marker");
}

describe("images de partage (spec site public §6)", () => {
  it("og.jpg : 1200 × 630, ≤ 150 Ko", () => {
    const bytes = new Uint8Array(readFileSync(join(WEB, "public/og.jpg")));
    expect(bytes.length).toBeLessThanOrEqual(150_000);
    expect(jpegSize(bytes)).toEqual({ width: 1200, height: 630 });
  });
  it("apple-touch-icon.png : PNG 180 × 180", () => {
    const b = readFileSync(join(WEB, "public/apple-touch-icon.png"));
    expect(b.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(b.readUInt32BE(16)).toBe(180);
    expect(b.readUInt32BE(20)).toBe(180);
  });
});
```

Run: `cd web && npx vitest run tests/seo.test.ts` — Expected: PASS. Regarder `og.jpg` (outil Read) : globe net, nom lisible, aucun panneau.

- [ ] **Step 8 : tout arrêter** — naviguer l'onglet vers `about:blank`, `TaskStop` du serveur, `netstat -ano | grep :5173` doit être vide (sinon `taskkill //PID <pid> //F`).

- [ ] **Step 9 : commit**

```bash
git add web/public/og.jpg web/public/apple-touch-icon.png web/tests/seo.test.ts
git commit -m "feat(seo): image Open Graph et icône Apple, capturées sur le build local

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 10 : jeton d'audience, merge, déploiement, moteurs de recherche, HISTORY (contrôleur)

- [ ] **Step 1 : jeton Cloudflare Web Analytics.** Demander à l'utilisateur : soit il crée le site `globelayers.com` dans Cloudflare → Analytics & Logs → Web Analytics et colle le jeton (32 caractères hexadécimaux), soit il autorise sa création par l'API Cloudflare. Mettre le jeton dans `CF_BEACON_TOKEN` (`web/src/build/beacon.ts`), puis `cd web && npx vitest run && npx vite build && grep -c cloudflareinsights dist/index.html` → `1`. Commit `feat(analytics): jeton Cloudflare Web Analytics`. Si l'utilisateur préfère reporter : merger quand même, noter la dette en HISTORY §8.

- [ ] **Step 2 : revue finale de branche** (`superpowers:requesting-code-review` sur `master..feat/public-site`), corrections en une vague, suites complètes vertes (`vitest`, `tsc`, `pytest`), budgets du §8.4 de la spec relevés.

- [ ] **Step 3 : HISTORY** (`updating-history`) : §2 (Cloudflare Web Analytics, Natural Earth `name_en`), §3 (`web/src/i18n/`, `web/src/build/`, `ui/about.ts`, nouveaux tests, fichiers `public/`), §5 (décisions de la spec §2 + « messages développeur en anglais, hors `STRINGS` »), §6 (défauts rencontrés), §7 (ligne du lot, sha de merge), §8 (« Chantiers à venir » : lot D livré, R1–R2 rayés ; dettes éventuelles), §9, pied de page. `python tools/history_check.py` vert.

- [ ] **Step 4 : merge et déploiement**

```bash
git checkout master
git merge --no-ff feat/public-site -m "Merge branch 'feat/public-site' — lot D : site en anglais, référencement, partage, mesure d'audience

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
cd web && npx vitest run && npx vite build && cd ..
git push origin master
```

Attendre le run `test` (`gh run watch`), puis vérifier la prod : hash du bundle identique au build local ; `curl -s -o /dev/null -w '%{http_code}'` = `200` pour `/og.jpg`, `/favicon.svg`, `/apple-touch-icon.png`, `/site.webmanifest`, `/robots.txt`, `/sitemap.xml` ; `curl -s https://globelayers.com/ | grep -c 'lang="en"'` = `1` ; `curl -s https://globelayers.com/geo/countries.json | grep -c Germany` = `1` ; beacon présent dans le HTML servi ; aucun cookie posé (`curl -sI https://globelayers.com/ | grep -ci set-cookie` = `0`).

- [ ] **Step 5 : moteurs de recherche — accord de l'utilisateur à chaque action.** Google Search Console : `mcp__gscServer__add_site` (`sc-domain:globelayers.com`), enregistrement DNS TXT de vérification sur Cloudflare (API `plugin_cloudflare` ou à la main par l'utilisateur), puis `submit_sitemap` (`https://globelayers.com/sitemap.xml`). Bing Webmaster : `add_site`, `verify_site`, `submit_sitemap`. Vérifier l'aperçu du lien dans un débogueur Open Graph (opengraph.xyz ou équivalent).

- [ ] **Step 6 : clôture** — mémoire du projet mise à jour, branche supprimée (`git branch -d feat/public-site`), HISTORY §9 final poussé, espace `.superpowers/sdd/2026-09-19-public-site/` conservé comme les précédents.
