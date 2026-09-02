# Spec — Globe Three.js + heatmap température

**Date :** 2026-09-02 · **Statut :** validée en brainstorming, à planifier
**Périmètre :** sous-projet 2 — phases 2, 3, 5 et 7 de `docs/PLAN.md`. Le relief
(phase 4) et les finitions (phase 6 : tooltip, auto-rotation, atmosphère, pubs)
font l'objet des specs 3 et 4.

## 1. Objectif

Un site statique affichant un globe 3D navigable, portant la texture de
température produite par le pipeline (spec 1), coloré par une palette
multi-arrêts, avec légende, bandeau de fraîcheur des données et slider
d'opacité. Fluide sur mobile modeste grâce à deux niveaux de subdivision choisis
selon le GPU. Déployé automatiquement sur Cloudflare Workers Static Assets.

Décisions prises le 2026-09-02 (voir aussi `HISTORY.md` §5) :

- **TypeScript** + Vite + Three.js, aucune autre dépendance d'exécution ;
- **un seul `ShaderMaterial` custom** dès le premier jour (approche A) : le relief
  et le hillshading de la spec 3 s'y ajoutent sans migration ;
- **Blue Marble NASA 4K commitée**, une seule résolution pour les deux tiers ;
- **Workers Static Assets** plutôt que Pages (recommandation Cloudflare 2026 pour
  tout nouveau projet ; Pages est gelé) ;
- **déploiement par GitHub Actions après tests verts**, sur push `master` ;
- **Vitest sur la logique pure** ; le rendu est validé à l'œil (§9).

Principe directeur inchangé (`HISTORY.md` §4) : tout ce qui est cher se fait
hors ligne, tout ce qui est vivant se fait sur GPU. Le CPU ne touche jamais un
pixel de heatmap.

## 2. Architecture

```
web/
  index.html                 # canvas plein écran + overlay UI
  package.json  vite.config.ts  tsconfig.json  wrangler.jsonc
  public/
    assets/blue-marble-4k.jpg          # NASA BMNG, 4096×2048, ~1,5 Mo, commité
    _headers                           # cache long sur /assets/*, court sur index
  src/
    main.ts                  # bootstrap : tier → scène → données → UI
    config.ts                # DATA_BASE_URL, REFRESH_MS, STALE_AFTER_MS
    data/metadata.ts         # type LatestMetadata + parseMetadata()
    data/sampling.ts         # heatmapUv(lon, lat, grid) — formules spec 1 §4 en TS
    data/loader.ts           # fetch JSON, fetch PNG → Texture, boucle de rafraîchissement
    gpu/tier.ts              # detectTier() → "high" | "low"
    render/scene.ts          # renderer, caméra, OrbitControls, resize, boucle rAF
    render/globe.ts          # SphereGeometry selon tier + ShaderMaterial + uniforms
    render/colormap.ts       # arrêts °C → LUT (Uint8Array) → DataTexture + gradient CSS
    render/shaders/globe.vert.glsl
    render/shaders/globe.frag.glsl     # importés en `?raw`
    ui/overlay.ts            # légende, slider opacité, bandeau, statut
  tests/                     # vitest : metadata, sampling, colormap, tier, loader
```

Frontières, chacune testable seule :

| Module | Fait | Dépend de | Ne fait pas |
|---|---|---|---|
| `data/metadata.ts` | valide et type `latest.json` | rien | réseau, Three.js |
| `data/sampling.ts` | lon/lat → UV heatmap | `grid` | Three.js |
| `data/loader.ts` | fetch JSON + PNG, décide du refetch, fabrique la `Texture` | `metadata`, Three.js (`Texture` seulement) | rendu |
| `gpu/tier.ts` | choisit `high`/`low` | `WebGLRenderingContext`, `navigator`, URL | géométrie |
| `render/*` | scène, géométrie, matériau, LUT | Three.js, uniforms reçus | fetch |
| `ui/overlay.ts` | DOM de l'overlay | valeurs reçues, callback slider | GPU, réseau |
| `main.ts` | câble tout | tous | logique |

`config.ts` : `DATA_BASE_URL = import.meta.env.VITE_DATA_BASE_URL ??
"https://pub-97483d42990244b3b19ae530da791d26.r2.dev/gfs"`, `REFRESH_MS = 15 min`,
`STALE_AFTER_MS = 6 h`.

## 3. Chargement des données

Contrat : spec 1 §4 (`latest.json` `schema_version` 1, PNG 1440 × 721 gris 8 bits).

1. `GET {DATA_BASE_URL}/latest.json` (`cache: "no-cache"` : R2 sert
   `max-age=300`, on veut le JSON le plus frais que le CDN accepte de donner).
2. `parseMetadata(json)` : exige `schema_version === 1`, `encoding.bits === 8`,
   `encoding.min_c < encoding.max_c`, `grid.width/height` entiers positifs,
   `texture` chaîne non vide, `generated_at`/`run`/`valid_time_utc` ISO parsables.
   Toute violation → `MetadataError` avec le champ fautif.
3. `GET {DATA_BASE_URL}/{texture}?v={generated_at}` → `Blob` →
   `createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" })`
   → `Texture`. Réglages stricts, le texel est une donnée :
   `colorSpace = NoColorSpace`, `minFilter = magFilter = LinearFilter`,
   `generateMipmaps = false`, `wrapS = RepeatWrapping`, `wrapT = ClampToEdgeWrapping`,
   `flipY = true` (convention Three.js, la formule v en tient compte).
   Si `bitmap.width/height ≠ grid.width/height` → `TextureError`, texture rejetée.
4. Uniforms poussés à `globe.ts` : `uHeatmap`, `uGridSize = (width, height)`,
   `uLut` (rebâtie si `encoding` change), plus les valeurs de `stats` et les dates à
   l'UI.
5. Rafraîchissement : `setInterval(REFRESH_MS)` et `visibilitychange` → visible.
   Refetch du JSON ; si `generated_at` diffère de celui en mémoire → étape 3,
   swap de texture (`needsUpdate`), l'ancienne est `dispose()`. Sinon rien. Retard
   maximal sur R2 : 5 min de CDN + 15 min de cycle.
6. CORS : le bucket `worldtemp` autorise déjà `http://localhost:5173` ; ajouter
   l'origine `workers.dev` du site à la mise en production (§6).

## 4. Rendu

### Tier GPU (`gpu/tier.ts`)

Ordre de décision, le premier qui tranche gagne :

1. `?tier=high|low` dans l'URL.
2. `WEBGL_debug_renderer_info` → `UNMASKED_RENDERER_WEBGL` :
   `/Apple|NVIDIA|GeForce|Radeon|Arc|Iris|Xe/i` → high ;
   `/Mali-[4T]|Adreno( \(TM\))? [345]|PowerVR/i` → low.
3. Sinon : `navigator.hardwareConcurrency <= 4` ou (`/Mobi|Android/i` sur
   `userAgent` **et** `devicePixelRatio < 2`) → low, sinon high.

Pas de micro-benchmark (bruité, coûte des frames) ; à reconsidérer si un appareil
réel se classe mal. Le tier retenu et la raison sont loggés en console.

### Profils

| | high | low |
|---|---|---|
| Géométrie | `SphereGeometry(1, 768, 384)` ≈ 590 k triangles | `SphereGeometry(1, 256, 128)` ≈ 65 k |
| `setPixelRatio` | `min(devicePixelRatio, 2)` | `min(devicePixelRatio, 1.5)` |
| Blue Marble | 4K | 4K |

Géométrie créée une seule fois au démarrage, jamais régénérée.

### Scène (`render/scene.ts`)

`PerspectiveCamera` 45°, `OrbitControls` avec damping, `enablePan = false`,
distance bornée [1,3 ; 4] (rayon 1), rotation tactile native. Fond noir.
`DirectionalLight` liée à la caméra (le jour suit le regard, pas de face
nocturne) + `AmbientLight` faible. Rendu à la demande : la boucle `rAF` ne
dessine que si les contrôles ont bougé (`change`), si une texture ou un uniform a
changé, ou après un `resize`. Sinon idle : batterie mobile.

### Matériau (`render/globe.ts` + shaders)

Uniforms : `uBaseMap`, `uHeatmap`, `uLut`, `uGridSize`, `uHeatmapOpacity`,
`uLightDir`. Vertex shader : transmet `vUv` et la normale ; pas de displacement
(spec 3). Fragment shader, cœur :

```glsl
// Grille cellulaire spec 1 §4 : 1440 colonnes sans bouclage (u), 721 lignes
// pôles inclus (v). Miroir TS : data/sampling.ts (heatmapUv). Garder les deux alignés.
vec2 hm = vec2(vUv.x + 0.5 / uGridSize.x,
               1.0 - ((1.0 - vUv.y) * (uGridSize.y - 1.0) + 0.5) / uGridSize.y);
float t = texture2D(uHeatmap, hm).r;              // 0..1, bilinéaire natif
vec3 heat = texture2D(uLut, vec2(t, 0.5)).rgb;    // LUT 256×1, déjà linéaire
vec3 base = texture2D(uBaseMap, vUv).rgb;         // sRGB → linéaire par Three.js
vec3 albedo = mix(base, heat, uHeatmapOpacity);
float lambert = max(dot(normalize(vNormal), uLightDir), 0.0);
gl_FragColor = vec4(albedo * (0.25 + 0.75 * lambert), 1.0);
```

Pourquoi `RepeatWrapping` en u : la dernière colonne est 179,75°, le filtrage
bilinéaire entre 179,75° et −180° passe par le bord et retombe sur la colonne 0.
Aucune couture au méridien 180°. Pourquoi `uTempMin/Max` n'apparaissent pas :
`t` normalisé indexe directement la LUT ; les °C n'interviennent que dans
`colormap.ts` pour placer les arrêts, alimenté par `encoding` — une seule source,
`latest.json`.

`SphereGeometry` de Three.js place u = 0 au méridien −180° et v = 1 au pôle Nord,
même convention que les deux textures équirectangulaires : aucune rotation. La
vérification est visuelle (critère 2 : continents Blue Marble et heatmap alignés).

### Colormap (`render/colormap.ts`)

Arrêts en °C, densifiés là où vivent 99 % des pixels :

| °C | −90 | −45 | −30 | −15 | 0 | 10 | 20 | 30 | 45 | 60 |
|---|---|---|---|---|---|---|---|---|---|---|
| couleur | violet quasi-noir | bleu foncé | bleu | cyan | vert | jaune | orange | rouge | rouge foncé | magenta foncé |

`buildLut(stops, min_c, max_c): Uint8Array` (256 × 4 RGBA, interpolation linéaire
en RGB entre arrêts placés à `(°C − min_c) / (max_c − min_c)`) alimente **à la
fois** la `DataTexture` (`NoColorSpace`, `LinearFilter`, `ClampToEdge`) et le
gradient CSS de la légende (`linear-gradient` construit depuis les mêmes arrêts).
Une seule source de vérité pour la palette.

## 5. Interface (`ui/overlay.ts`, HTML/CSS hors canvas)

- **Bas gauche, légende** : barre gradient 256 px, graduations tous les 10 °C de
  −40 à +40, repères `stats.min_c` et `stats.max_c` réels.
- **Bas droite, slider** `uHeatmapOpacity` 0 → 1, défaut 0,85.
- **Haut, bandeau** : « NOAA GFS 0,25° · run 12:00 UTC · valide 16:00 UTC (18:00
  locale) · mis à jour il y a 12 min ». Le « il y a » se recalcule chaque minute.
- **Statut** : « Chargement… », « Données indisponibles, nouvel essai dans
  15 min », « Données anciennes » (si `valid_time_utc` > `STALE_AFTER_MS`).
- **`#ad-slot`** : conteneur vide à hauteur réservée, masqué. Réserve la place
  pour la phase 6 sans décalage de mise en page futur.
- Mobile : overlay repliable d'un tap, `viewport-fit=cover`, tailles en `rem`.

## 6. Build et déploiement

- `vite build` → `web/dist/`, hash dans les noms d'assets. Cible de poids au
  premier chargement : **< 3 Mo** (Three.js ≈ 150 Ko gzip, Blue Marble ≈ 1,5 Mo,
  PNG ≈ 220 Ko).
- `web/wrangler.jsonc` : `name: "worldtemp"`, `compatibility_date` du jour,
  `assets: { directory: "./dist" }`, **pas de `main`** : Worker sans script,
  requêtes statiques gratuites.
- `web/public/_headers` : `/assets/*` → `Cache-Control: public, max-age=31536000,
  immutable` ; `/` et `/index.html` → `max-age=0, must-revalidate`. Les données ne
  transitent pas par le Worker : le navigateur lit R2 directement.
- CI, `.github/workflows/test.yml` étendu :
  - job `web` (parallèle à `pytest`) : `actions/setup-node` 24, `npm ci`,
    `vitest run`, `vite build`, artefact `dist` ;
  - job `deploy` : `needs: [pytest, web]`, `if: github.event_name == 'push' &&
    github.ref == 'refs/heads/master'`, `npx wrangler deploy` dans `web/`, secrets
    `CLOUDFLARE_API_TOKEN` (modèle « Edit Cloudflare Workers », créé au dashboard,
    posé par l'utilisateur via `Get-Clipboard | gh secret set`) et
    `CLOUDFLARE_ACCOUNT_ID`.
- URL : `https://worldtemp.<sous-domaine>.workers.dev`. Après le premier déploiement,
  ajouter cette origine au CORS du bucket R2 (par l'API, comme le 2026-09-02).
- Dev local : `npm run dev` sur `http://localhost:5173`, déjà autorisé par le CORS.

## 7. Gestion d'erreurs (navigateur)

Règle : **le globe Blue Marble s'affiche toujours** ; aucune exception non attrapée.

| Situation | Comportement |
|---|---|
| WebGL indisponible | Message plein écran « navigateur non compatible », rien d'autre n'est tenté |
| JSON injoignable, non-JSON ou `MetadataError` | Globe seul, statut « Données indisponibles », `console.warn` avec la cause, nouvel essai au cycle suivant |
| PNG injoignable ou `TextureError` (dimensions ≠ `grid`) | Texture précédente conservée si elle existe, sinon globe seul + statut |
| `valid_time_utc` plus vieux que `STALE_AFTER_MS` | Heatmap affichée, statut « Données anciennes » |
| `webglcontextlost` | Message « rendu interrompu », bouton recharger |
| `encoding` change entre deux refetch | LUT rebâtie, texture rechargée, rien d'autre |

## 8. Tests

Vitest, logique pure, sans WebGL ni DOM (sauf `overlay` qui reste hors tests) :

- **`metadata`** : le JSON d'exemple de la spec 1 passe ; `schema_version: 2`,
  `encoding.bits: 16`, `grid` absent, `generated_at` non ISO → `MetadataError`
  nommant le champ.
- **`sampling`** (mêmes nombres que la spec 1 §4) : `heatmapUv(−180, 90)` =
  `(1/2880, 1 − 0,5/721)` ; `heatmapUv(0, 0)` = `(0,5 + 1/2880, 1 − 360,5/721)` ;
  `heatmapUv(179,75, −90)` → `u = 1 − 1/2880`, `v = 0,5/721`.
- **`colormap`** : LUT de 1024 octets ; `buildLut` déterministe ; pour
  `min −90 / max 60`, l'arrêt −45 °C tombe à l'index `round(45/150·255) = 77` ;
  le premier texel est la couleur de −90, le dernier celle de +60 ; le gradient
  CSS cite les mêmes arrêts dans le même ordre.
- **`tier`** : table de noms GPU → tier ; `?tier=` prime sur tout ; sans extension,
  `hardwareConcurrency 4` → low, `8` + desktop → high.
- **`loader`** (fetch simulé) : `generated_at` identique → aucun fetch PNG ;
  différent → fetch avec `?v=<generated_at>` ; erreur JSON → état « indisponible »
  et texture précédente intacte.

Le rendu est validé à l'œil selon §9, sur desktop et sur un téléphone, avec et
sans `?tier=low`. `test.yml` exécute vitest et le build à chaque push/PR.

## 9. Critères d'acceptation

1. `npm run dev` : globe Blue Marble navigable, 60 fps sur desktop, aucune couture
   au méridien 180°, pôles sans artefact grossier.
2. Heatmap réelle depuis R2 : à opacité 0,5 les continents de la heatmap
   coïncident avec ceux de Blue Marble ; gradients lisses sans pixels visibles ;
   tropiques chauds, pôles froids, cohérents avec la saison.
3. Bandeau : run / valide identiques à `latest.json` ; légende identique à la LUT
   (mêmes arrêts, mêmes couleurs).
4. `?tier=low` sur desktop : maillage visiblement moins dense, toujours beau ; sur
   téléphone milieu de gamme, navigation ≥ 30 fps stables ; tier loggé.
5. Après une nouvelle publication sur R2, la texture change sans rechargement dans
   les 15 min (observable en forçant `gh workflow run pipeline.yml` à l'heure
   suivante).
6. Push sur `master` → `test.yml` vert → site en ligne sur `workers.dev` ;
   `/assets/*` en `immutable`, `index.html` revalidé ; poids initial < 3 Mo
   (onglet Réseau).

## 10. Hors périmètre

- Relief (displacement, normal map, hillshading) : spec 3, tranche la dette n° 4
  (source heightmap).
- Tooltip lat/lon/°C, auto-rotation, atmosphère fresnel, publicités réelles :
  spec 4. `data/sampling.ts` et `#ad-slot` les préparent.
- Domaine personnalisé, analytics, i18n.
- Micro-benchmark GPU, textures 8K, KTX2/WebP.
