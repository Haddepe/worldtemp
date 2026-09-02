# Globe Three.js + heatmap — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un site statique `web/` (Vite + TypeScript + Three.js) qui affiche un globe navigable portant la heatmap de température lue sur R2, avec légende, bandeau de fraîcheur et slider d'opacité, choisi en deux tiers GPU, déployé sur Cloudflare Workers Static Assets par GitHub Actions après tests verts.

**Architecture:** Modules purs testés sous Vitest en Node (`data/metadata`, `data/sampling`, `render/colormap`, `gpu/tier` via `decideTier`, `data/loader` avec dépendances injectées, `ui/format`) ; modules impurs minces (`render/scene`, `render/globe`, `ui/overlay`, `main`) validés à l'œil. Un seul `ShaderMaterial` : le fragment shader décode la texture 8 bits, indexe une LUT 256×1, mixe avec Blue Marble. Aucune constante de plage recopiée : `encoding` et `grid` viennent de `latest.json`.

**Tech Stack:** Node 24, Vite 8, TypeScript 5, Three.js 0.185, Vitest 4, Wrangler 4. Python (venv, Pillow) une seule fois pour préparer la Blue Marble.

**Spec:** `docs/superpowers/specs/2026-09-02-globe-heatmap-design.md` — le plan argumente à partir de la spec ; l'exécutant lit les deux. Contrat de données : `docs/superpowers/specs/2026-08-30-pipeline-gfs-design.md` §4.

## Global Constraints

- Données : `DATA_BASE_URL` par défaut `https://pub-97483d42990244b3b19ae530da791d26.r2.dev/gfs` ; `latest.json` `schema_version` 1 ; PNG 1440 × 721 gris 8 bits ; `REFRESH_MS = 15 × 60 × 1000` ; `STALE_AFTER_MS = 6 × 3600 × 1000`.
- Échantillonnage heatmap (spec pipeline §4) : `u = vUv.x + 0.5 / W`, `v = 1 − ((1 − vUv.y) · (H − 1) + 0.5) / H`, `wrapS = RepeatWrapping`, `wrapT = ClampToEdgeWrapping`, filtrage linéaire, pas de mipmaps, `NoColorSpace`.
- Texture heatmap depuis `ImageBitmap` : `createImageBitmap(blob, { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" })` et `texture.flipY = false` (Three.js ignore `flipY` sur un `ImageBitmap`). Effet net identique à la convention Three.js : pôle Nord en v = 1.
- Tiers : high = `SphereGeometry(1, 768, 384)`, pixelRatio ≤ 2 ; low = `SphereGeometry(1, 256, 128)`, pixelRatio ≤ 1,5. Géométrie créée une fois.
- Palette : arrêts de la spec §4 « Colormap », LUT 256 × 4 RGBA `SRGBColorSpace` (le GPU décode en linéaire), même tableau d'arrêts pour le gradient CSS.
- Aucune dépendance d'exécution autre que `three`. Pas de framework.
- Le globe Blue Marble s'affiche toujours ; aucune exception non attrapée dans `main.ts`.
- Cache : `/assets/*` (fichiers hachés par Vite) `immutable` un an ; `/textures/*` (Blue Marble, non haché) `max-age=86400` ; `index.html` `max-age=0, must-revalidate`.
- Commandes npm depuis la racine du dépôt : `npm --prefix web run <script>` (Windows et Actions). Vitest et Vite s'exécutent avec `web/` pour cwd.
- Travail sur la branche `feat/globe-heatmap` créée depuis `master`, **en place** (pas de worktree : `.venv/` et `node_modules/` locaux). Merge en T10 via `superpowers:finishing-a-development-branch`.
- Le job `test` de la CI inclut `history_check`, qui sera **rouge sur la branche** tant que §3 de `HISTORY.md` ne nomme pas `web/` (T10). Attendu ; seul le job `web` doit être vert de T1 à T9.
- Dépôt en LF. Commits en français, Conventional Commits, un commit par tâche au minimum.
- Ne jamais écrire de secret dans le chat ni dans un fichier versionné.

## Fichiers

| Fichier | Rôle |
|---|---|
| `web/package.json`, `web/package-lock.json` | dépendances, scripts `dev`/`build`/`test`/`typecheck`/`deploy` |
| `web/tsconfig.json`, `web/vite.config.ts` | TypeScript strict, Vitest (`tests/**/*.test.ts`) |
| `web/index.html`, `web/src/style.css` | canvas plein écran, overlay (bandeau, statut, légende, slider, `#ad-slot`), `#fatal` |
| `web/public/textures/blue-marble-4k.jpg` | NASA BMNG août 2004 redimensionnée 4096 × 2048 (commitée) |
| `web/public/_headers` | en-têtes de cache Workers Static Assets |
| `web/wrangler.jsonc` | Worker sans script, `assets.directory = ./dist` |
| `web/src/config.ts` | `DATA_BASE_URL`, `REFRESH_MS`, `STALE_AFTER_MS` |
| `web/src/data/metadata.ts` | `LatestMetadata`, `MetadataError`, `parseMetadata` |
| `web/src/data/sampling.ts` | `heatmapUv(lon, lat, grid)` |
| `web/src/data/loader.ts` | `DataLoader`, `LoaderDeps`, `browserDeps`, `bitmapToTexture`, `needsTextureFetch`, `textureUrl`, `isStale`, `TextureError` |
| `web/src/gpu/tier.ts` | `Tier`, `TierInputs`, `decideTier`, `detectTier` |
| `web/src/render/colormap.ts` | `STOPS`, `LUT_SIZE`, `colorAt`, `buildLut`, `legendGradientCss`, `createLutTexture` |
| `web/src/render/scene.ts` | `createScene(canvas)` → renderer, caméra, contrôles, boucle à la demande |
| `web/src/render/globe.ts` | `createGlobe(tier, baseMap)` → mesh + setters d'uniforms |
| `web/src/render/shaders/globe.vert.glsl`, `globe.frag.glsl` | shaders |
| `web/src/ui/format.ts` | `formatBanner`, `formatAgo`, `legendTicks` (purs) |
| `web/src/ui/overlay.ts` | DOM : bandeau, statut, légende, slider, fatal |
| `web/src/main.ts` | bootstrap et boucle de rafraîchissement |
| `web/tests/*.test.ts` | metadata, sampling, colormap, tier, loader, format |
| `tools/prepare_bluemarble.py` | télécharge et redimensionne la Blue Marble |
| `.github/workflows/test.yml` | jobs `test` (Python, existant), `web`, `deploy` |
| `.gitignore` | + `web/.wrangler/` |
| `HISTORY.md` | §2, §3, §5, §7, §8, §9 |

---

### Task 1 : Scaffold `web/` et `data/metadata.ts`

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/src/config.ts`, `web/src/data/metadata.ts`, `web/tests/fixtures.ts`
- Modify: `.gitignore`
- Test: `web/tests/metadata.test.ts`

**Interfaces:**
- Produces: `LatestMetadata`, `Encoding`, `Grid`, `MetadataError extends Error { field: string }`, `parseMetadata(raw: unknown): LatestMetadata`, constantes `DATA_BASE_URL`, `REFRESH_MS`, `STALE_AFTER_MS`.

- [ ] **Step 1 : Initialiser le paquet**

Créer `web/package.json` :

```json
{
  "name": "worldtemp-web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "three": "^0.185.1"
  },
  "devDependencies": {
    "@types/three": "^0.185.4",
    "typescript": "^5.9.0",
    "vite": "^8.2.2",
    "vitest": "^4.1.11",
    "wrangler": "^4.128.0"
  }
}
```

Puis `mkdir -p web/src/data web/tests` et `npm --prefix web install` (génère `package-lock.json` et `node_modules/`, gitignoré). Les versions sont des planchers : garder ce que npm résout.

- [ ] **Step 2 : `tsconfig.json`, `vite.config.ts`, `.gitignore`**

`web/tsconfig.json` :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

`web/vite.config.ts` :

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

Ajouter à `.gitignore`, sous le bloc `# Node / Vite` :

```
web/.wrangler/
```

- [ ] **Step 3 : `config.ts`**

`web/src/config.ts` :

```ts
/** Base des objets publiés par le pipeline (spec pipeline §4 : `gfs/latest.json`, `gfs/latest.png`). */
export const DATA_BASE_URL: string =
  import.meta.env.VITE_DATA_BASE_URL ??
  "https://pub-97483d42990244b3b19ae530da791d26.r2.dev/gfs";

/** Période de relecture de `latest.json` (spec §3). */
export const REFRESH_MS = 15 * 60 * 1000;

/** Au-delà, la heatmap est affichée avec le statut « Données anciennes » (spec §5). */
export const STALE_AFTER_MS = 6 * 3600 * 1000;
```

- [ ] **Step 4 : Écrire la fixture et les tests de `parseMetadata` (échec attendu)**

`web/tests/fixtures.ts` (un fichier à part : importer un `*.test.ts` depuis un autre ré-enregistrerait ses tests) :

```ts
/** Exemple de la spec pipeline §4, tel quel. */
export const SAMPLE = {
  schema_version: 1,
  model: "gfs_0p25",
  variable: "TMP_2m",
  run: "2026-08-30T06:00:00Z",
  forecast_hour: 8,
  valid_time_utc: "2026-08-30T14:00:00Z",
  generated_at: "2026-08-30T14:07:42Z",
  encoding: { bits: 8, min_c: -90, max_c: 60 },
  grid: {
    width: 1440, height: 721,
    lon_min: -180, lon_max: 179.75, lat_min: -90, lat_max: 90,
    lon_step: 0.25, lat_step: 0.25,
  },
  texture: "latest.png",
  stats: { min_c: -71.3, max_c: 48.9 },
};
```

`web/tests/metadata.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { MetadataError, parseMetadata } from "../src/data/metadata";
import { SAMPLE } from "./fixtures";

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

describe("parseMetadata", () => {
  it("accepte l'exemple de la spec et le renvoie typé", () => {
    const m = parseMetadata(clone(SAMPLE));
    expect(m.schema_version).toBe(1);
    expect(m.encoding).toEqual({ bits: 8, min_c: -90, max_c: 60 });
    expect(m.grid.width).toBe(1440);
    expect(m.texture).toBe("latest.png");
    expect(m.stats.max_c).toBe(48.9);
  });

  it("refuse schema_version 2", () => {
    const raw = clone(SAMPLE);
    raw.schema_version = 2;
    expect(() => parseMetadata(raw)).toThrowError(MetadataError);
    expect(() => parseMetadata(raw)).toThrowError(/schema_version/);
  });

  it("refuse encoding.bits 16", () => {
    const raw = clone(SAMPLE);
    raw.encoding.bits = 16;
    expect(() => parseMetadata(raw)).toThrowError(/encoding\.bits/);
  });

  it("refuse min_c >= max_c", () => {
    const raw = clone(SAMPLE);
    raw.encoding.min_c = 60;
    expect(() => parseMetadata(raw)).toThrowError(/encoding\.min_c/);
  });

  it("refuse grid absent", () => {
    const raw = clone(SAMPLE) as Record<string, unknown>;
    delete raw.grid;
    expect(() => parseMetadata(raw)).toThrowError(/grid/);
  });

  it("refuse une largeur de grille non entière", () => {
    const raw = clone(SAMPLE);
    raw.grid.width = 1440.5;
    expect(() => parseMetadata(raw)).toThrowError(/grid\.width/);
  });

  it("refuse generated_at non ISO", () => {
    const raw = clone(SAMPLE);
    raw.generated_at = "hier";
    expect(() => parseMetadata(raw)).toThrowError(/generated_at/);
  });

  it("refuse texture vide", () => {
    const raw = clone(SAMPLE);
    raw.texture = "";
    expect(() => parseMetadata(raw)).toThrowError(/texture/);
  });

  it("refuse une entrée qui n'est pas un objet", () => {
    expect(() => parseMetadata(null)).toThrowError(MetadataError);
    expect(() => parseMetadata("{}")).toThrowError(MetadataError);
  });

  it("expose le champ fautif", () => {
    const raw = clone(SAMPLE);
    raw.schema_version = 3;
    try {
      parseMetadata(raw);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MetadataError);
      expect((e as MetadataError).field).toBe("schema_version");
    }
  });
});
```

- [ ] **Step 5 : Vérifier l'échec**

Run: `npm --prefix web run test`
Expected: échec, `Cannot find module '../src/data/metadata'` (ou équivalent).

- [ ] **Step 6 : Implémenter `metadata.ts`**

`web/src/data/metadata.ts` :

```ts
/**
 * Contrat `latest.json` — spec pipeline §4, schema_version 1.
 * Le front ne recopie aucune constante : `encoding` et `grid` viennent d'ici.
 */

export interface Encoding {
  bits: number;
  min_c: number;
  max_c: number;
}

export interface Grid {
  width: number;
  height: number;
  lon_min: number;
  lon_max: number;
  lat_min: number;
  lat_max: number;
  lon_step: number;
  lat_step: number;
}

export interface LatestMetadata {
  schema_version: 1;
  model: string;
  variable: string;
  run: string;
  forecast_hour: number;
  valid_time_utc: string;
  generated_at: string;
  encoding: Encoding;
  grid: Grid;
  texture: string;
  stats: { min_c: number; max_c: number };
}

export class MetadataError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`${field} : ${message}`);
    this.name = "MetadataError";
    this.field = field;
  }
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

type Rec = Record<string, unknown>;

function record(value: unknown, field: string): Rec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MetadataError(field, "objet attendu");
  }
  return value as Rec;
}

function num(o: Rec, field: string): number {
  const v = o[field.split(".").pop() as string];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new MetadataError(field, "nombre attendu");
  }
  return v;
}

function posInt(o: Rec, field: string): number {
  const v = num(o, field);
  if (!Number.isInteger(v) || v <= 0) {
    throw new MetadataError(field, "entier strictement positif attendu");
  }
  return v;
}

function str(o: Rec, field: string): string {
  const v = o[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new MetadataError(field, "chaîne non vide attendue");
  }
  return v;
}

function isoUtc(o: Rec, field: string): string {
  const v = str(o, field);
  if (!ISO_UTC.test(v) || Number.isNaN(Date.parse(v))) {
    throw new MetadataError(field, "date ISO 8601 UTC attendue (YYYY-MM-DDTHH:MM:SSZ)");
  }
  return v;
}

export function parseMetadata(raw: unknown): LatestMetadata {
  const o = record(raw, "latest.json");

  if (o.schema_version !== 1) {
    throw new MetadataError("schema_version", `version inconnue (${String(o.schema_version)}), 1 attendue`);
  }

  const enc = record(o.encoding, "encoding");
  const encoding: Encoding = {
    bits: num(enc, "encoding.bits"),
    min_c: num(enc, "encoding.min_c"),
    max_c: num(enc, "encoding.max_c"),
  };
  if (encoding.bits !== 8) {
    throw new MetadataError("encoding.bits", `8 attendu, reçu ${encoding.bits}`);
  }
  if (!(encoding.min_c < encoding.max_c)) {
    throw new MetadataError("encoding.min_c", "doit être < encoding.max_c");
  }

  const g = record(o.grid, "grid");
  const grid: Grid = {
    width: posInt(g, "grid.width"),
    height: posInt(g, "grid.height"),
    lon_min: num(g, "grid.lon_min"),
    lon_max: num(g, "grid.lon_max"),
    lat_min: num(g, "grid.lat_min"),
    lat_max: num(g, "grid.lat_max"),
    lon_step: num(g, "grid.lon_step"),
    lat_step: num(g, "grid.lat_step"),
  };

  const st = record(o.stats, "stats");

  return {
    schema_version: 1,
    model: str(o, "model"),
    variable: str(o, "variable"),
    run: isoUtc(o, "run"),
    forecast_hour: num(o, "forecast_hour"),
    valid_time_utc: isoUtc(o, "valid_time_utc"),
    generated_at: isoUtc(o, "generated_at"),
    encoding,
    grid,
    texture: str(o, "texture"),
    stats: { min_c: num(st, "stats.min_c"), max_c: num(st, "stats.max_c") },
  };
}
```

Note : `num` reçoit un chemin pointé (`encoding.bits`) pour le message d'erreur et lit la clé après le dernier point.

- [ ] **Step 7 : Vérifier le succès et le typage**

Run: `npm --prefix web run test && npm --prefix web run typecheck`
Expected: `10 passed`, `tsc` silencieux.

- [ ] **Step 8 : Commit**

```bash
git add .gitignore web/package.json web/package-lock.json web/tsconfig.json web/vite.config.ts web/src/config.ts web/src/data/metadata.ts web/tests/fixtures.ts web/tests/metadata.test.ts
git commit -m "feat(web): scaffold Vite/TS/Vitest et parseMetadata (contrat latest.json)"
```

---

### Task 2 : `data/sampling.ts` — formules UV

**Files:**
- Create: `web/src/data/sampling.ts`
- Test: `web/tests/sampling.test.ts`

**Interfaces:**
- Consumes: `Grid` (Task 1).
- Produces: `heatmapUv(lon: number, lat: number, grid: Pick<Grid, "width" | "height">): { u: number; v: number }`.

- [ ] **Step 1 : Tests (échec attendu)**

`web/tests/sampling.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { heatmapUv } from "../src/data/sampling";

const grid = { width: 1440, height: 721 };
const EPS = 1e-12;

describe("heatmapUv — spec pipeline §4", () => {
  it("coin haut-gauche : lon -180, lat +90 → centre du pixel (0, 0)", () => {
    const { u, v } = heatmapUv(-180, 90, grid);
    expect(u).toBeCloseTo(1 / 2880, 12);
    expect(v).toBeCloseTo(1 - 0.5 / 721, 12);
  });

  it("origine : lon 0, lat 0 → colonne 720, ligne 360", () => {
    const { u, v } = heatmapUv(0, 0, grid);
    expect(Math.abs(u - (0.5 + 1 / 2880))).toBeLessThan(EPS);
    expect(Math.abs(v - (1 - 360.5 / 721))).toBeLessThan(EPS);
  });

  it("dernière colonne : lon 179,75, lat -90 → u = 1 - 1/2880, v = 0,5/721", () => {
    const { u, v } = heatmapUv(179.75, -90, grid);
    expect(u).toBeCloseTo(1 - 1 / 2880, 12);
    expect(v).toBeCloseTo(0.5 / 721, 12);
  });

  it("lon +180 retombe au-delà de 1 : c'est RepeatWrapping qui boucle", () => {
    const { u } = heatmapUv(180, 0, grid);
    expect(u).toBeCloseTo(1 + 1 / 2880, 12);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npm --prefix web run test -- sampling`
Expected: échec, module introuvable.

- [ ] **Step 3 : Implémenter**

`web/src/data/sampling.ts` :

```ts
import type { Grid } from "./metadata";

export interface Uv {
  u: number;
  v: number;
}

/**
 * Coordonnées de texture au centre du pixel GFS contenant (lon, lat).
 *
 * Grille cellulaire de la spec pipeline §4 : colonne x ↔ lon = -180 + 0,25·x
 * (1440 colonnes, dernière 179,75, pas de colonne de bouclage) ; ligne y ↔
 * lat = 90 − 0,25·y (721 lignes, pôles inclus). v est en convention Three.js
 * (0 en bas) : v = 1 − v_haut.
 *
 * MIROIR GLSL : `render/shaders/globe.frag.glsl` calcule la même chose depuis
 * vUv, où vUv.x = (lon + 180) / 360 et vUv.y = 1 − (90 − lat) / 180.
 * Modifier l'un impose de modifier l'autre.
 */
export function heatmapUv(lon: number, lat: number, grid: Pick<Grid, "width" | "height">): Uv {
  const x = ((lon + 180) / 360) * grid.width; // colonne fractionnaire
  const y = ((90 - lat) / 180) * (grid.height - 1); // ligne fractionnaire
  return {
    u: (x + 0.5) / grid.width,
    v: 1 - (y + 0.5) / grid.height,
  };
}
```

- [ ] **Step 4 : Vérifier le succès**

Run: `npm --prefix web run test`
Expected: `14 passed`.

- [ ] **Step 5 : Commit**

```bash
git add web/src/data/sampling.ts web/tests/sampling.test.ts
git commit -m "feat(web): heatmapUv, formules d'échantillonnage de la spec pipeline"
```

---

### Task 3 : `render/colormap.ts` — palette, LUT, gradient

**Files:**
- Create: `web/src/render/colormap.ts`
- Test: `web/tests/colormap.test.ts`

**Interfaces:**
- Produces: `Stop { c: number; rgb: [number, number, number] }`, `STOPS: readonly Stop[]`, `LUT_SIZE = 256`, `colorAt(stops, c): [number, number, number]`, `buildLut(stops, minC, maxC): Uint8Array` (longueur `LUT_SIZE * 4`), `legendGradientCss(stops, minC, maxC): string`, `createLutTexture(lut: Uint8Array): THREE.DataTexture`.

- [ ] **Step 1 : Tests (échec attendu)**

`web/tests/colormap.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { STOPS, LUT_SIZE, buildLut, colorAt, legendGradientCss } from "../src/render/colormap";

const MIN = -90;
const MAX = 60;

describe("STOPS", () => {
  it("couvre -90 → +60 en ordre croissant", () => {
    expect(STOPS[0]?.c).toBe(-90);
    expect(STOPS[STOPS.length - 1]?.c).toBe(60);
    for (let i = 1; i < STOPS.length; i++) {
      expect(STOPS[i]!.c).toBeGreaterThan(STOPS[i - 1]!.c);
    }
  });
});

describe("colorAt", () => {
  it("renvoie la couleur exacte d'un arrêt", () => {
    expect(colorAt(STOPS, -45)).toEqual(STOPS[1]!.rgb);
  });
  it("interpole linéairement entre deux arrêts", () => {
    const a = STOPS[4]!; // 0 °C
    const b = STOPS[5]!; // 10 °C
    const mid = colorAt(STOPS, 5);
    for (let k = 0; k < 3; k++) {
      expect(mid[k]).toBeCloseTo((a.rgb[k]! + b.rgb[k]!) / 2, 6);
    }
  });
  it("borne en dehors de la plage", () => {
    expect(colorAt(STOPS, -200)).toEqual(STOPS[0]!.rgb);
    expect(colorAt(STOPS, 200)).toEqual(STOPS[STOPS.length - 1]!.rgb);
  });
});

describe("buildLut", () => {
  const lut = buildLut(STOPS, MIN, MAX);

  it("fait 256 texels RGBA", () => {
    expect(lut).toBeInstanceOf(Uint8Array);
    expect(lut.length).toBe(LUT_SIZE * 4);
  });

  it("est déterministe", () => {
    expect(buildLut(STOPS, MIN, MAX)).toEqual(lut);
  });

  it("premier texel = couleur de -90, dernier = couleur de +60, alpha 255", () => {
    expect([lut[0], lut[1], lut[2], lut[3]]).toEqual([...STOPS[0]!.rgb, 255]);
    const o = (LUT_SIZE - 1) * 4;
    expect([lut[o], lut[o + 1], lut[o + 2], lut[o + 3]]).toEqual([...STOPS[STOPS.length - 1]!.rgb, 255]);
  });

  it("l'arrêt -45 °C tombe à l'index 77 pour [-90, 60]", () => {
    // (−45 − (−90)) / 150 · 255 = 76,5 → texel 77 ↔ −44,7 °C, à moins de 2 niveaux de l'arrêt
    const i = Math.round(((-45 - MIN) / (MAX - MIN)) * (LUT_SIZE - 1));
    expect(i).toBe(77);
    const target = STOPS[1]!.rgb;
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(lut[i * 4 + k]! - target[k]!)).toBeLessThanOrEqual(2);
    }
  });
});

describe("legendGradientCss", () => {
  it("cite les mêmes arrêts dans le même ordre, en pourcentage de la plage", () => {
    const css = legendGradientCss(STOPS, MIN, MAX);
    expect(css.startsWith("linear-gradient(to right, ")).toBe(true);
    expect(css).toContain("rgb(30, 0, 50) 0%");
    expect(css).toContain("rgb(10, 20, 110) 30%");
    expect(css).toContain("rgb(90, 0, 70) 100%");
    const order = STOPS.map((s) => css.indexOf(`rgb(${s.rgb.join(", ")})`));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]!);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npm --prefix web run test -- colormap`
Expected: échec, module introuvable.

- [ ] **Step 3 : Implémenter**

`web/src/render/colormap.ts` :

```ts
import * as THREE from "three";

export interface Stop {
  /** Température en °C. */
  c: number;
  /** Couleur sRGB 0–255. */
  rgb: [number, number, number];
}

/**
 * Palette (spec §4 « Colormap ») : arrêts densifiés entre -45 et +45 °C, là où
 * vivent 99 % des pixels ; teintes extrêmes réservées aux queues.
 * SEULE source de vérité : la LUT GPU et le gradient CSS de la légende en
 * dérivent tous deux.
 */
export const STOPS: readonly Stop[] = [
  { c: -90, rgb: [30, 0, 50] }, // violet quasi-noir
  { c: -45, rgb: [10, 20, 110] }, // bleu foncé
  { c: -30, rgb: [20, 60, 200] }, // bleu
  { c: -15, rgb: [40, 190, 230] }, // cyan
  { c: 0, rgb: [40, 170, 70] }, // vert
  { c: 10, rgb: [240, 230, 40] }, // jaune
  { c: 20, rgb: [250, 150, 20] }, // orange
  { c: 30, rgb: [220, 30, 20] }, // rouge
  { c: 45, rgb: [120, 0, 10] }, // rouge foncé
  { c: 60, rgb: [90, 0, 70] }, // magenta foncé
];

export const LUT_SIZE = 256;

/** Couleur interpolée linéairement (sRGB) à la température `c`, bornée aux arrêts extrêmes. */
export function colorAt(stops: readonly Stop[], c: number): [number, number, number] {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) throw new Error("palette vide");
  if (c <= first.c) return [...first.rgb];
  if (c >= last.c) return [...last.rgb];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (c <= b.c) {
      const t = (c - a.c) / (b.c - a.c);
      return [
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t,
      ];
    }
  }
  return [...last.rgb];
}

/**
 * LUT 256 × 1 RGBA : le texel i représente la température
 * minC + i / 255 · (maxC − minC), soit exactement le décodage du PNG 8 bits.
 */
export function buildLut(stops: readonly Stop[], minC: number, maxC: number): Uint8Array {
  const out = new Uint8Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const c = minC + (i / (LUT_SIZE - 1)) * (maxC - minC);
    const [r, g, b] = colorAt(stops, c);
    out[i * 4] = Math.round(r);
    out[i * 4 + 1] = Math.round(g);
    out[i * 4 + 2] = Math.round(b);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Gradient CSS de la légende, construit depuis les mêmes arrêts. */
export function legendGradientCss(stops: readonly Stop[], minC: number, maxC: number): string {
  const parts = stops.map((s) => {
    const pct = ((s.c - minC) / (maxC - minC)) * 100;
    const p = Number.isInteger(pct) ? String(pct) : pct.toFixed(2);
    return `rgb(${s.rgb.join(", ")}) ${p}%`;
  });
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/**
 * Texture GPU de la LUT. `SRGBColorSpace` : les octets sont du sRGB, le GPU les
 * décode en linéaire à l'échantillonnage, ce qui rend le mix avec Blue Marble
 * (elle aussi sRGB décodée) cohérent avant la conversion de sortie.
 */
export function createLutTexture(lut: Uint8Array): THREE.DataTexture {
  const tex = new THREE.DataTexture(lut, LUT_SIZE, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
```

- [ ] **Step 4 : Vérifier le succès**

Run: `npm --prefix web run test && npm --prefix web run typecheck`
Expected: `23 passed`, `tsc` silencieux. Si l'import de `three` échoue en Node, vérifier que `"type": "module"` est bien dans `package.json`.

- [ ] **Step 5 : Commit**

```bash
git add web/src/render/colormap.ts web/tests/colormap.test.ts
git commit -m "feat(web): palette, LUT 256×1 et gradient de légende depuis les mêmes arrêts"
```

---

### Task 4 : `gpu/tier.ts` — choix du tier

**Files:**
- Create: `web/src/gpu/tier.ts`
- Test: `web/tests/tier.test.ts`

**Interfaces:**
- Produces: `type Tier = "high" | "low"`, `TierInputs { urlSearch: string; rendererName: string | null; hardwareConcurrency: number | undefined; userAgent: string; devicePixelRatio: number }`, `TierDecision { tier: Tier; reason: string }`, `decideTier(inputs: TierInputs): TierDecision` (pur), `detectTier(gl: WebGLRenderingContext | WebGL2RenderingContext): TierDecision` (lit le navigateur puis `decideTier`), `PIXEL_RATIO_CAP: Record<Tier, number>`.

- [ ] **Step 1 : Tests (échec attendu)**

`web/tests/tier.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { decideTier, type TierInputs } from "../src/gpu/tier";

const desktop: TierInputs = {
  urlSearch: "",
  rendererName: null,
  hardwareConcurrency: 8,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  devicePixelRatio: 1,
};

describe("decideTier", () => {
  it("?tier=low prime sur tout", () => {
    const d = decideTier({ ...desktop, urlSearch: "?tier=low", rendererName: "NVIDIA GeForce RTX 4090" });
    expect(d.tier).toBe("low");
    expect(d.reason).toMatch(/url/i);
  });

  it("?tier=high prime sur tout", () => {
    const d = decideTier({ ...desktop, urlSearch: "?foo=1&tier=high", hardwareConcurrency: 2 });
    expect(d.tier).toBe("high");
  });

  it.each([
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)", "high"],
    ["Apple M2", "high"],
    ["AMD Radeon RX 6700 XT", "high"],
    ["Intel(R) Arc(TM) A770", "high"],
    ["Intel(R) Iris(R) Xe Graphics", "high"],
    ["Mali-T860", "low"],
    ["Mali-450 MP", "low"],
    ["Adreno (TM) 530", "low"],
    ["Adreno 418", "low"],
    ["PowerVR Rogue GE8320", "low"],
  ])("nom GPU « %s » → %s", (name, tier) => {
    expect(decideTier({ ...desktop, rendererName: name }).tier).toBe(tier);
  });

  it("GPU inconnu et extension absente : 4 cœurs → low", () => {
    const d = decideTier({ ...desktop, hardwareConcurrency: 4 });
    expect(d.tier).toBe("low");
    expect(d.reason).toMatch(/hardwareConcurrency/);
  });

  it("GPU inconnu : 8 cœurs desktop → high", () => {
    expect(decideTier(desktop).tier).toBe("high");
  });

  it("mobile avec dpr < 2 → low, mobile avec dpr 3 → high", () => {
    const mobile = { ...desktop, userAgent: "Mozilla/5.0 (Linux; Android 13) Mobile", hardwareConcurrency: 8 };
    expect(decideTier({ ...mobile, devicePixelRatio: 1.5 }).tier).toBe("low");
    expect(decideTier({ ...mobile, devicePixelRatio: 3 }).tier).toBe("high");
  });

  it("nom GPU reconnu prime sur l'heuristique", () => {
    expect(decideTier({ ...desktop, rendererName: "Apple GPU", hardwareConcurrency: 2 }).tier).toBe("high");
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npm --prefix web run test -- tier`
Expected: échec, module introuvable.

- [ ] **Step 3 : Implémenter**

`web/src/gpu/tier.ts` :

```ts
export type Tier = "high" | "low";

export interface TierInputs {
  urlSearch: string;
  rendererName: string | null;
  hardwareConcurrency: number | undefined;
  userAgent: string;
  devicePixelRatio: number;
}

export interface TierDecision {
  tier: Tier;
  reason: string;
}

export const PIXEL_RATIO_CAP: Record<Tier, number> = { high: 2, low: 1.5 };

const HIGH_GPU = /Apple|NVIDIA|GeForce|Radeon|Arc|Iris|Xe/i;
const LOW_GPU = /Mali-[4T]|Adreno( \(TM\))? [345]|PowerVR/i;
const MOBILE_UA = /Mobi|Android/i;

/**
 * Faisceau d'indices (spec §4) : l'URL prime, puis le nom du GPU, puis une
 * heuristique. Aucun signal n'est fiable seul ; pas de micro-benchmark.
 */
export function decideTier(i: TierInputs): TierDecision {
  const forced = new URLSearchParams(i.urlSearch).get("tier");
  if (forced === "high" || forced === "low") {
    return { tier: forced, reason: `paramètre d'URL tier=${forced}` };
  }

  if (i.rendererName) {
    if (HIGH_GPU.test(i.rendererName)) return { tier: "high", reason: `GPU « ${i.rendererName} »` };
    if (LOW_GPU.test(i.rendererName)) return { tier: "low", reason: `GPU « ${i.rendererName} »` };
  }

  const cores = i.hardwareConcurrency ?? 0;
  if (cores > 0 && cores <= 4) {
    return { tier: "low", reason: `hardwareConcurrency ${cores}` };
  }
  if (MOBILE_UA.test(i.userAgent) && i.devicePixelRatio < 2) {
    return { tier: "low", reason: `mobile, devicePixelRatio ${i.devicePixelRatio}` };
  }
  return { tier: "high", reason: "heuristique par défaut" };
}

/** Lit le navigateur puis délègue à `decideTier`. */
export function detectTier(gl: WebGLRenderingContext | WebGL2RenderingContext): TierDecision {
  let rendererName: string | null = null;
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  if (ext) {
    const name = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    rendererName = typeof name === "string" ? name : null;
  }
  return decideTier({
    urlSearch: window.location.search,
    rendererName,
    hardwareConcurrency: navigator.hardwareConcurrency,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
  });
}
```

- [ ] **Step 4 : Vérifier le succès**

Run: `npm --prefix web run test && npm --prefix web run typecheck`
Expected: `39 passed` (10 + 4 + 9 + 16), `tsc` silencieux.

- [ ] **Step 5 : Commit**

```bash
git add web/src/gpu/tier.ts web/tests/tier.test.ts
git commit -m "feat(web): détection du tier GPU par faisceau d'indices"
```

---

### Task 5 : Blue Marble 4K et script de préparation

**Files:**
- Create: `tools/prepare_bluemarble.py`, `web/public/textures/blue-marble-4k.jpg`

**Interfaces:**
- Produces: le fichier `/textures/blue-marble-4k.jpg` servi par Vite (4096 × 2048 JPEG, équirectangulaire, lon −180 à gauche).

- [ ] **Step 1 : Script**

`tools/prepare_bluemarble.py` :

```python
"""Prépare la texture couleur de base du globe (spec globe §2).

Source : NASA Blue Marble Next Generation, août 2004, 5400 × 2700, domaine public
(https://visibleearth.nasa.gov/images/73776). Sortie : JPEG 4096 × 2048 commité
dans web/public/textures/. À relancer seulement pour changer la source.

Usage : .venv/Scripts/python tools/prepare_bluemarble.py
"""

from __future__ import annotations

import io
import urllib.request
from pathlib import Path

from PIL import Image

URL = (
    "https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73776/"
    "world.topo.bathy.200408.3x5400x2700.jpg"
)
SOURCE_SIZE = (5400, 2700)
TARGET_SIZE = (4096, 2048)
OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "textures" / "blue-marble-4k.jpg"


def main() -> None:
    with urllib.request.urlopen(URL, timeout=120) as resp:
        data = resp.read()
    img = Image.open(io.BytesIO(data)).convert("RGB")
    if img.size != SOURCE_SIZE:
        raise SystemExit(f"taille inattendue {img.size}, {SOURCE_SIZE} attendue")
    img = img.resize(TARGET_SIZE, Image.Resampling.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "JPEG", quality=85, optimize=True, progressive=True)
    print(f"{OUT} : {OUT.stat().st_size} octets")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2 : Exécuter**

Run: `.venv/Scripts/python tools/prepare_bluemarble.py`
Expected: une ligne `… blue-marble-4k.jpg : N octets` avec N entre 800 000 et 2 000 000. Ouvrir le fichier : continents nets, Amériques à gauche, méridien 0 au centre.

- [ ] **Step 3 : Vérifier que git le prend**

Run: `git status --short web/public`
Expected: `?? web/public/textures/blue-marble-4k.jpg` (le `.gitignore` n'exclut que `web/public/assets/*.png`).

- [ ] **Step 4 : Commit**

```bash
git add tools/prepare_bluemarble.py web/public/textures/blue-marble-4k.jpg
git commit -m "feat(web): Blue Marble NASA 4K et script de préparation"
```

---

### Task 6 : Scène, globe, shaders, bootstrap — critère 1

**Files:**
- Create: `web/index.html`, `web/src/style.css`, `web/src/render/scene.ts`, `web/src/render/globe.ts`, `web/src/render/shaders/globe.vert.glsl`, `web/src/render/shaders/globe.frag.glsl`, `web/src/main.ts`

**Interfaces:**
- Consumes: `Tier`, `PIXEL_RATIO_CAP`, `detectTier` (Task 4).
- Produces: `createScene(canvas: HTMLCanvasElement): SceneHandle` avec `{ renderer, scene, camera, controls, setPixelRatioCap(cap: number), requestRender(), start() }` ; `createGlobe(tier: Tier, baseMap: THREE.Texture): Globe` avec `{ mesh, setHeatmap(texture: THREE.Texture | null, width: number, height: number), setLut(lut: THREE.DataTexture), setOpacity(o: number) }` ; `SEGMENTS: Record<Tier, [number, number]>`.

Pas de test automatisé : validation visuelle (critère 1).

- [ ] **Step 1 : `index.html` et `style.css`**

`web/index.html` :

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="description" content="Globe 3D des températures mondiales actuelles (NOAA GFS)." />
    <title>Worldtemp — températures mondiales en 3D</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <canvas id="globe" aria-label="Globe 3D des températures"></canvas>
    <div id="overlay">
      <header id="banner" class="panel" aria-live="polite">Chargement…</header>
      <div id="status" class="panel" role="status" hidden></div>
      <aside id="legend" class="panel" aria-label="Légende des températures"></aside>
      <aside id="controls" class="panel">
        <label for="opacity">Heatmap</label>
        <input id="opacity" type="range" min="0" max="1" step="0.01" value="0.85" />
      </aside>
      <div id="ad-slot" hidden></div>
    </div>
    <div id="fatal" role="alert" hidden></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`web/src/style.css` :

```css
:root {
  color-scheme: dark;
  --panel-bg: rgba(10, 12, 18, 0.72);
  --panel-fg: #e8ecf2;
  --panel-muted: #9aa3b2;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
}

html, body {
  margin: 0;
  height: 100%;
  background: #000;
  color: var(--panel-fg);
  overflow: hidden;
}

#globe {
  display: block;
  width: 100vw;
  height: 100vh;
  touch-action: none;
}

#overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  padding: max(0.75rem, env(safe-area-inset-top)) max(0.75rem, env(safe-area-inset-right))
    max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
  display: grid;
  grid-template-rows: auto 1fr auto;
  grid-template-columns: 1fr auto;
  gap: 0.5rem;
}

.panel {
  pointer-events: auto;
  background: var(--panel-bg);
  backdrop-filter: blur(6px);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
}

#banner { grid-column: 1 / -1; justify-self: center; text-align: center; }
#status { grid-column: 1 / -1; justify-self: center; color: #ffd166; }
#legend { grid-row: 3; grid-column: 1; align-self: end; justify-self: start; min-width: 16rem; }
#controls { grid-row: 3; grid-column: 2; align-self: end; display: flex; gap: 0.5rem; align-items: center; }
#ad-slot { grid-column: 1 / -1; height: 90px; }

#legend .bar { height: 0.75rem; border-radius: 0.25rem; }
#legend .ticks { position: relative; height: 1.4rem; font-size: 0.75rem; color: var(--panel-muted); }
#legend .tick { position: absolute; transform: translateX(-50%); }
#legend .extremes { font-size: 0.75rem; color: var(--panel-muted); display: flex; justify-content: space-between; }

#fatal {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 2rem;
  background: #000;
  text-align: center;
}

@media (max-width: 600px) {
  #legend { min-width: 0; width: calc(100vw - 1.5rem); grid-column: 1 / -1; }
  #controls { grid-column: 1 / -1; justify-self: end; }
}
```

- [ ] **Step 2 : Shaders**

`web/src/render/shaders/globe.vert.glsl` :

```glsl
varying vec2 vUv;
varying vec3 vNormal;

void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal); // espace vue : la lumière suit la caméra
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

`web/src/render/shaders/globe.frag.glsl` :

```glsl
uniform sampler2D uBaseMap;      // Blue Marble, sRGB décodée par le GPU
uniform sampler2D uHeatmap;      // PNG 8 bits, NoColorSpace : le texel est une donnée
uniform sampler2D uLut;          // 256×1, sRGB décodée par le GPU
uniform vec2 uGridSize;          // (1440, 721) depuis latest.json grid
uniform float uHeatmapOpacity;   // 0..1
uniform float uHasHeatmap;       // 0 tant qu'aucune texture valide n'est chargée
uniform vec3 uLightDir;          // espace vue, normalisé

varying vec2 vUv;
varying vec3 vNormal;

void main() {
  // Grille cellulaire (spec pipeline §4) : 1440 colonnes sans bouclage (u,
  // RepeatWrapping), 721 lignes pôles inclus (v). MIROIR TS : data/sampling.ts
  // (heatmapUv). Modifier l'un impose de modifier l'autre.
  vec2 hm = vec2(vUv.x + 0.5 / uGridSize.x,
                 1.0 - ((1.0 - vUv.y) * (uGridSize.y - 1.0) + 0.5) / uGridSize.y);
  float t = texture2D(uHeatmap, hm).r;             // 0..1, bilinéaire natif
  vec3 heat = texture2D(uLut, vec2(t, 0.5)).rgb;   // couleur linéaire
  vec3 base = texture2D(uBaseMap, vUv).rgb;        // couleur linéaire
  vec3 albedo = mix(base, heat, uHeatmapOpacity * uHasHeatmap);
  float lambert = max(dot(normalize(vNormal), uLightDir), 0.0);
  gl_FragColor = vec4(albedo * (0.25 + 0.75 * lambert), 1.0);
  #include <colorspace_fragment>
}
```

`#include <colorspace_fragment>` convertit la sortie linéaire vers l'espace de sortie du renderer (sRGB). Sans lui, l'image serait trop sombre.

- [ ] **Step 3 : `scene.ts`**

`web/src/render/scene.ts` :

```ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Plafond du pixel ratio (tier), appliqué avec `min(devicePixelRatio, cap)`. */
  setPixelRatioCap(cap: number): void;
  /** Demande un rendu au prochain frame (texture ou uniform changé). */
  requestRender(): void;
  start(): void;
}

/**
 * Rendu à la demande (spec §4 « Scène ») : la boucle rAF ne dessine que si les
 * contrôles bougent (damping compris) ou si `requestRender()` a été appelé.
 * Lève si WebGL est indisponible.
 */
export function createScene(canvas: HTMLCanvasElement): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 3);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 1.3;
  controls.maxDistance = 4;
  controls.rotateSpeed = 0.5;
  controls.zoomSpeed = 0.8;

  let dirty = true;
  let cap = 2;

  const applyPixelRatio = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  };

  const loop = () => {
    const moved = controls.update();
    if (moved || dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
    requestAnimationFrame(loop);
  };

  window.addEventListener("resize", resize);
  controls.addEventListener("change", () => (dirty = true));

  return {
    renderer,
    scene,
    camera,
    controls,
    setPixelRatioCap(c) {
      cap = c;
      applyPixelRatio();
      resize();
    },
    requestRender() {
      dirty = true;
    },
    start() {
      applyPixelRatio();
      resize();
      requestAnimationFrame(loop);
    },
  };
}
```

- [ ] **Step 4 : `globe.ts`**

`web/src/render/globe.ts` :

```ts
import * as THREE from "three";
import type { Tier } from "../gpu/tier";
import fragmentShader from "./shaders/globe.frag.glsl?raw";
import vertexShader from "./shaders/globe.vert.glsl?raw";

/** Subdivisions (largeur, hauteur) par tier — spec §4 « Profils ». */
export const SEGMENTS: Record<Tier, [number, number]> = {
  high: [768, 384],
  low: [256, 128],
};

export interface Globe {
  mesh: THREE.Mesh;
  /** `null` retire la heatmap (le globe redevient Blue Marble seule). */
  setHeatmap(texture: THREE.Texture | null, width: number, height: number): void;
  setLut(lut: THREE.DataTexture): void;
  setOpacity(opacity: number): void;
}

/**
 * Un seul ShaderMaterial (approche A de la spec) : la géométrie est créée une
 * fois selon le tier ; tout ce qui bouge passe par les uniforms.
 */
export function createGlobe(tier: Tier, baseMap: THREE.Texture): Globe {
  const [widthSegments, heightSegments] = SEGMENTS[tier];
  const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);

  const uniforms = {
    uBaseMap: { value: baseMap },
    uHeatmap: { value: null as THREE.Texture | null },
    uLut: { value: null as THREE.DataTexture | null },
    uGridSize: { value: new THREE.Vector2(1440, 721) },
    uHeatmapOpacity: { value: 0.85 },
    uHasHeatmap: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0.5, 0.4, 1).normalize() },
  };

  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  const mesh = new THREE.Mesh(geometry, material);

  return {
    mesh,
    setHeatmap(texture, width, height) {
      uniforms.uHeatmap.value = texture;
      uniforms.uGridSize.value.set(width, height);
      uniforms.uHasHeatmap.value = texture ? 1 : 0;
    },
    setLut(lut) {
      uniforms.uLut.value = lut;
    },
    setOpacity(opacity) {
      uniforms.uHeatmapOpacity.value = Math.min(1, Math.max(0, opacity));
    },
  };
}
```

- [ ] **Step 5 : `main.ts` (version globe seul)**

`web/src/main.ts` :

```ts
import * as THREE from "three";
import { PIXEL_RATIO_CAP, detectTier } from "./gpu/tier";
import { createGlobe } from "./render/globe";
import { createScene } from "./render/scene";

function fatal(message: string): void {
  const el = document.getElementById("fatal");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  document.getElementById("overlay")?.setAttribute("hidden", "");
}

async function boot(): Promise<void> {
  const canvas = document.getElementById("globe") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("canvas #globe introuvable");

  let sceneHandle: ReturnType<typeof createScene>;
  try {
    sceneHandle = createScene(canvas);
  } catch (e) {
    fatal("Ce navigateur ne prend pas en charge WebGL, nécessaire au globe 3D.");
    console.error(e);
    return;
  }

  const decision = detectTier(sceneHandle.renderer.getContext());
  console.info(`[worldtemp] tier ${decision.tier} — ${decision.reason}`);
  sceneHandle.setPixelRatioCap(PIXEL_RATIO_CAP[decision.tier]);

  canvas.addEventListener("webglcontextlost", (ev) => {
    ev.preventDefault();
    fatal("Le rendu 3D a été interrompu par le navigateur. Rechargez la page.");
  });

  const baseMap = await new THREE.TextureLoader().loadAsync("/textures/blue-marble-4k.jpg");
  baseMap.colorSpace = THREE.SRGBColorSpace;
  baseMap.anisotropy = sceneHandle.renderer.capabilities.getMaxAnisotropy();

  const globe = createGlobe(decision.tier, baseMap);
  sceneHandle.scene.add(globe.mesh);
  sceneHandle.start();
}

boot().catch((e: unknown) => {
  console.error(e);
  fatal("Le globe n'a pas pu démarrer. Rechargez la page.");
});
```

- [ ] **Step 6 : Vérifier typage et build**

Run: `npm --prefix web run typecheck && npm --prefix web run build`
Expected: `tsc` silencieux ; `vite build` liste `dist/index.html`, `dist/assets/index-*.js` (< 200 Ko gzip), et copie `dist/textures/blue-marble-4k.jpg`. Si `?raw` est refusé par `tsc`, vérifier `"types": ["vite/client"]` dans `tsconfig.json`.

- [ ] **Step 7 : Validation visuelle (critère 1)**

Run: `npm --prefix web run dev` puis ouvrir `http://localhost:5173`.
Vérifier et noter dans le message de fin de tâche :
- globe Blue Marble, éclairage qui suit la caméra, fond noir ;
- rotation à la souris et au doigt, zoom borné, inertie ;
- aucune couture visible en tournant vers le Pacifique (méridien 180°) ; pôles sans étoile d'artefacts grossière ;
- `http://localhost:5173/?tier=low` : console `tier low — paramètre d'URL`, maillage moins dense visible au bord du disque ;
- onglet Performance ou compteur fps du navigateur : ~60 fps en rotation sur desktop.

Corriger avant de continuer si l'un des points échoue.

- [ ] **Step 8 : Commit**

```bash
git add web/index.html web/src/style.css web/src/render web/src/main.ts
git commit -m "feat(web): scène Three.js, globe ShaderMaterial et bootstrap (globe Blue Marble navigable)"
```

---

### Task 7 : `data/loader.ts` et affichage de la heatmap — critère 2

**Files:**
- Create: `web/src/data/loader.ts`
- Modify: `web/src/main.ts`
- Test: `web/tests/loader.test.ts`

**Interfaces:**
- Consumes: `parseMetadata`, `LatestMetadata`, `MetadataError` (Task 1) ; `buildLut`, `createLutTexture`, `STOPS` (Task 3) ; `Globe` (Task 6) ; `DATA_BASE_URL`, `REFRESH_MS`, `STALE_AFTER_MS` (Task 1).
- Produces: `TextureError extends Error`, `LoaderDeps { fetchJson(url: string): Promise<unknown>; fetchBitmap(url: string): Promise<ImageBitmap> }`, `browserDeps: LoaderDeps`, `LoadedData { meta: LatestMetadata; texture: THREE.Texture }`, `textureUrl(base: string, meta: LatestMetadata): string`, `needsTextureFetch(prev: LatestMetadata | null, next: LatestMetadata): boolean`, `bitmapToTexture(bitmap: ImageBitmap, meta: LatestMetadata): THREE.Texture`, `isStale(meta: LatestMetadata, nowMs: number, staleAfterMs: number): boolean`, `class DataLoader { constructor(baseUrl: string, deps?: LoaderDeps); get data(): LoadedData | null; refresh(): Promise<LoadedData | null> }`.

- [ ] **Step 1 : Tests (échec attendu)**

`web/tests/loader.test.ts` :

```ts
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { MetadataError } from "../src/data/metadata";
import {
  DataLoader,
  TextureError,
  bitmapToTexture,
  isStale,
  needsTextureFetch,
  textureUrl,
  type LoaderDeps,
} from "../src/data/loader";
import { parseMetadata } from "../src/data/metadata";
import { SAMPLE } from "./fixtures";

const BASE = "https://example.test/gfs";
const META = parseMetadata(SAMPLE);

function fakeBitmap(width = 1440, height = 721): ImageBitmap {
  return { width, height, close() {} } as unknown as ImageBitmap;
}

function deps(json: unknown, bitmap: ImageBitmap = fakeBitmap()): LoaderDeps & {
  fetchJson: ReturnType<typeof vi.fn>;
  fetchBitmap: ReturnType<typeof vi.fn>;
} {
  return {
    fetchJson: vi.fn(async () => JSON.parse(JSON.stringify(json))),
    fetchBitmap: vi.fn(async () => bitmap),
  };
}

describe("textureUrl", () => {
  it("cache-buste avec generated_at", () => {
    expect(textureUrl(BASE, META)).toBe(`${BASE}/latest.png?v=2026-08-30T14%3A07%3A42Z`);
  });
});

describe("needsTextureFetch", () => {
  it("premier chargement → oui", () => expect(needsTextureFetch(null, META)).toBe(true));
  it("même generated_at → non", () => expect(needsTextureFetch(META, { ...META })).toBe(false));
  it("generated_at différent → oui", () =>
    expect(needsTextureFetch(META, { ...META, generated_at: "2026-08-30T15:07:42Z" })).toBe(true));
});

describe("bitmapToTexture", () => {
  it("règle la texture comme une donnée, pas une couleur", () => {
    const t = bitmapToTexture(fakeBitmap(), META);
    expect(t.colorSpace).toBe(THREE.NoColorSpace);
    expect(t.minFilter).toBe(THREE.LinearFilter);
    expect(t.magFilter).toBe(THREE.LinearFilter);
    expect(t.generateMipmaps).toBe(false);
    expect(t.wrapS).toBe(THREE.RepeatWrapping);
    expect(t.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(t.flipY).toBe(false);
    expect(t.version).toBeGreaterThan(0); // `needsUpdate = true` incrémente `version` (pas de getter)
  });
  it("refuse une image dont les dimensions ne sont pas celles de grid", () => {
    expect(() => bitmapToTexture(fakeBitmap(1441, 721), META)).toThrowError(TextureError);
  });
});

describe("isStale", () => {
  const valid = Date.parse(META.valid_time_utc);
  const sixHours = 6 * 3600 * 1000;
  it("frais sous le seuil", () => expect(isStale(META, valid + sixHours - 1, sixHours)).toBe(false));
  it("ancien au-delà du seuil", () => expect(isStale(META, valid + sixHours + 1, sixHours)).toBe(true));
});

describe("DataLoader.refresh", () => {
  it("premier appel : JSON puis PNG, renvoie les données", async () => {
    const d = deps(SAMPLE);
    const loader = new DataLoader(BASE, d);
    const got = await loader.refresh();
    expect(got?.meta.generated_at).toBe(META.generated_at);
    expect(d.fetchJson).toHaveBeenCalledWith(`${BASE}/latest.json`);
    expect(d.fetchBitmap).toHaveBeenCalledWith(textureUrl(BASE, META));
    expect(loader.data).toBe(got);
  });

  it("generated_at identique : pas de fetch PNG, renvoie null", async () => {
    const d = deps(SAMPLE);
    const loader = new DataLoader(BASE, d);
    await loader.refresh();
    const again = await loader.refresh();
    expect(again).toBeNull();
    expect(d.fetchBitmap).toHaveBeenCalledTimes(1);
  });

  it("generated_at différent : nouveau PNG, l'ancienne texture est libérée", async () => {
    const d = deps(SAMPLE);
    const loader = new DataLoader(BASE, d);
    const first = await loader.refresh();
    const dispose = vi.spyOn(first!.texture, "dispose");
    d.fetchJson.mockResolvedValueOnce({ ...SAMPLE, generated_at: "2026-08-30T15:07:42Z" });
    const second = await loader.refresh();
    expect(second).not.toBeNull();
    expect(second?.meta.generated_at).toBe("2026-08-30T15:07:42Z");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(d.fetchBitmap).toHaveBeenCalledTimes(2);
  });

  it("JSON invalide : lève MetadataError, l'état courant reste intact", async () => {
    const d = deps(SAMPLE);
    const loader = new DataLoader(BASE, d);
    const first = await loader.refresh();
    d.fetchJson.mockResolvedValueOnce({ ...SAMPLE, schema_version: 2 });
    await expect(loader.refresh()).rejects.toThrowError(MetadataError);
    expect(loader.data).toBe(first);
  });

  it("PNG aux mauvaises dimensions : lève TextureError, l'état courant reste intact", async () => {
    const d = deps(SAMPLE);
    const loader = new DataLoader(BASE, d);
    const first = await loader.refresh();
    d.fetchJson.mockResolvedValueOnce({ ...SAMPLE, generated_at: "2026-08-30T15:07:42Z" });
    d.fetchBitmap.mockResolvedValueOnce(fakeBitmap(10, 10));
    await expect(loader.refresh()).rejects.toThrowError(TextureError);
    expect(loader.data).toBe(first);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npm --prefix web run test -- loader`
Expected: échec, module introuvable.

- [ ] **Step 3 : Implémenter `loader.ts`**

`web/src/data/loader.ts` :

```ts
import * as THREE from "three";
import { parseMetadata, type LatestMetadata } from "./metadata";

export class TextureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextureError";
  }
}

export interface LoaderDeps {
  fetchJson(url: string): Promise<unknown>;
  fetchBitmap(url: string): Promise<ImageBitmap>;
}

export interface LoadedData {
  meta: LatestMetadata;
  texture: THREE.Texture;
}

/** URL du PNG avec cache-busting `?v=<generated_at>` (spec pipeline §4). */
export function textureUrl(base: string, meta: LatestMetadata): string {
  return `${base}/${meta.texture}?v=${encodeURIComponent(meta.generated_at)}`;
}

export function needsTextureFetch(prev: LatestMetadata | null, next: LatestMetadata): boolean {
  return prev === null || prev.generated_at !== next.generated_at;
}

export function isStale(meta: LatestMetadata, nowMs: number, staleAfterMs: number): boolean {
  return nowMs - Date.parse(meta.valid_time_utc) > staleAfterMs;
}

/**
 * Texture « donnée » (spec §3) : aucune conversion de couleur, filtrage
 * linéaire, bouclage en u seulement. `flipY = false` car l'orientation d'un
 * ImageBitmap est fixée à sa création (`imageOrientation: "flipY"` dans
 * `browserDeps`), Three.js ignore `flipY` pour ce type d'image.
 */
export function bitmapToTexture(bitmap: ImageBitmap, meta: LatestMetadata): THREE.Texture {
  const { width, height } = meta.grid;
  if (bitmap.width !== width || bitmap.height !== height) {
    throw new TextureError(`texture ${bitmap.width}×${bitmap.height}, grille ${width}×${height} attendue`);
  }
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

export const browserDeps: LoaderDeps = {
  async fetchJson(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
    return r.json();
  },
  async fetchBitmap(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
    const blob = await r.blob();
    return createImageBitmap(blob, {
      imageOrientation: "flipY",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
  },
};

export class DataLoader {
  private current: LoadedData | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly deps: LoaderDeps = browserDeps,
  ) {}

  get data(): LoadedData | null {
    return this.current;
  }

  /**
   * Relit `latest.json`. Renvoie les nouvelles données si `generated_at` a
   * changé, `null` sinon. Lève (`MetadataError`, `TextureError`, erreur
   * réseau) sans toucher à l'état courant.
   */
  async refresh(): Promise<LoadedData | null> {
    const meta = parseMetadata(await this.deps.fetchJson(`${this.baseUrl}/latest.json`));
    if (!needsTextureFetch(this.current?.meta ?? null, meta)) return null;
    const bitmap = await this.deps.fetchBitmap(textureUrl(this.baseUrl, meta));
    const texture = bitmapToTexture(bitmap, meta);
    const previous = this.current;
    this.current = { meta, texture };
    previous?.texture.dispose();
    return this.current;
  }
}
```

- [ ] **Step 4 : Vérifier le succès**

Run: `npm --prefix web run test && npm --prefix web run typecheck`
Expected: `52 passed`, `tsc` silencieux.

- [ ] **Step 5 : Brancher dans `main.ts`**

Remplacer la fin de `boot()` (après `sceneHandle.scene.add(globe.mesh);`) et ajouter les imports :

```ts
import { DATA_BASE_URL, REFRESH_MS } from "./config";
import { DataLoader } from "./data/loader";
import { STOPS, buildLut, createLutTexture } from "./render/colormap";
```

```ts
  sceneHandle.scene.add(globe.mesh);
  sceneHandle.start();

  const loader = new DataLoader(DATA_BASE_URL);
  let lutKey = "";

  const applyData = async () => {
    try {
      const fresh = await loader.refresh();
      if (!fresh) return;
      const { encoding, grid } = fresh.meta;
      const key = `${encoding.min_c}/${encoding.max_c}`;
      if (key !== lutKey) {
        globe.setLut(createLutTexture(buildLut(STOPS, encoding.min_c, encoding.max_c)));
        lutKey = key;
      }
      globe.setHeatmap(fresh.texture, grid.width, grid.height);
      sceneHandle.requestRender();
      console.info(`[worldtemp] données ${fresh.meta.run} f${fresh.meta.forecast_hour}, valides ${fresh.meta.valid_time_utc}`);
    } catch (e) {
      console.warn("[worldtemp] données indisponibles :", e);
    }
  };

  await applyData();
  setInterval(applyData, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void applyData();
  });
```

Brancher aussi le slider, provisoirement, en fin de `boot()` :

```ts
  const opacity = document.getElementById("opacity") as HTMLInputElement | null;
  opacity?.addEventListener("input", () => {
    globe.setOpacity(Number(opacity.value));
    sceneHandle.requestRender();
  });
```

- [ ] **Step 6 : Validation visuelle (critère 2)**

Run: `npm --prefix web run typecheck && npm --prefix web run dev`, ouvrir `http://localhost:5173`.
Vérifier :
- onglet Réseau : `latest.json` (200, R2), puis `latest.png?v=…` (200, `image/png`) ; pas d'erreur CORS en console ;
- heatmap visible : tropiques dans les jaunes-rouges, Antarctique et Arctique dans les bleus-violets, cohérents avec la saison ;
- slider à 0,5 : les côtes de la heatmap coïncident avec celles de Blue Marble (Afrique, Australie, Groenland). Si décalage d'un demi-globe → mauvais `roll` côté pipeline (impossible, testé) ou rotation UV : vérifier que la Blue Marble seule (slider 0) a bien Greenwich au centre de la texture ;
- gradients lisses, aucun pixel de 0,25° visible même zoomé au maximum ;
- méridien 180° (Pacifique, détroit de Béring) : aucune couture de couleur.

- [ ] **Step 7 : Commit**

```bash
git add web/src/data/loader.ts web/tests/loader.test.ts web/src/main.ts
git commit -m "feat(web): chargement de latest.json/latest.png depuis R2 et rafraîchissement 15 min"
```

---

### Task 8 : Overlay — légende, bandeau, statut, erreurs — critère 3

**Files:**
- Create: `web/src/ui/format.ts`, `web/src/ui/overlay.ts`
- Modify: `web/src/main.ts`
- Test: `web/tests/format.test.ts`

**Interfaces:**
- Consumes: `LatestMetadata` (Task 1), `STOPS`, `legendGradientCss` (Task 3), `isStale`, `MetadataError`, `TextureError` (Tasks 1, 7), `STALE_AFTER_MS`, `REFRESH_MS` (Task 1).
- Produces: `formatBanner(meta: LatestMetadata, nowMs: number, locale?: string, timeZone?: string): string`, `formatAgo(isoUtc: string, nowMs: number): string`, `legendTicks(minC: number, maxC: number, step?: number): { c: number; pct: number }[]` ; `createOverlay(): Overlay` avec `{ setBanner(text), setStatus(text | null), setLegend(minC, maxC, stats), onOpacity(cb: (o: number) => void), initialOpacity(): number, showFatal(text) }`.

- [ ] **Step 1 : Tests de `format.ts` (échec attendu)**

`web/tests/format.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { parseMetadata } from "../src/data/metadata";
import { formatAgo, formatBanner, legendTicks } from "../src/ui/format";
import { SAMPLE } from "./fixtures";

const META = parseMetadata(SAMPLE);
const NOW = Date.parse("2026-08-30T14:19:42Z"); // 12 min après generated_at

describe("formatAgo", () => {
  it("minutes", () => expect(formatAgo(META.generated_at, NOW)).toBe("il y a 12 min"));
  it("à l'instant sous 1 min", () => expect(formatAgo(META.generated_at, Date.parse(META.generated_at) + 30_000)).toBe("à l'instant"));
  it("heures et minutes au-delà de 60 min", () =>
    expect(formatAgo(META.generated_at, Date.parse(META.generated_at) + 95 * 60_000)).toBe("il y a 1 h 35"));
});

describe("formatBanner", () => {
  it("run, validité UTC et locale, fraîcheur", () => {
    const s = formatBanner(META, NOW, "fr-FR", "Europe/Paris");
    expect(s).toBe("NOAA GFS 0,25° · run 06:00 UTC · valide 14:00 UTC (16:00 locale) · il y a 12 min");
  });
  it("sans fuseau : la partie locale est omise si identique à UTC", () => {
    const s = formatBanner(META, NOW, "fr-FR", "UTC");
    expect(s).toBe("NOAA GFS 0,25° · run 06:00 UTC · valide 14:00 UTC · il y a 12 min");
  });
});

describe("legendTicks", () => {
  it("tous les 10 °C de -40 à +40 en pourcentage de [-90, 60]", () => {
    const ticks = legendTicks(-90, 60);
    expect(ticks.map((t) => t.c)).toEqual([-40, -30, -20, -10, 0, 10, 20, 30, 40]);
    expect(ticks[0]?.pct).toBeCloseTo(((-40 + 90) / 150) * 100, 6);
    expect(ticks[4]?.pct).toBeCloseTo(60, 6);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npm --prefix web run test -- format`
Expected: échec, module introuvable.

- [ ] **Step 3 : Implémenter `format.ts`**

`web/src/ui/format.ts` :

```ts
import type { LatestMetadata } from "../data/metadata";

function hhmm(isoUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(
    new Date(isoUtc),
  );
}

export function formatAgo(isoUtc: string, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(isoUtc)) / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `il y a ${h} h ${String(m).padStart(2, "0")}`;
}

/** Bandeau (spec §5). `locale`/`timeZone` injectables pour les tests. */
export function formatBanner(
  meta: LatestMetadata,
  nowMs: number,
  _locale: string = navigator.language,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const run = hhmm(meta.run, "UTC");
  const validUtc = hhmm(meta.valid_time_utc, "UTC");
  const validLocal = hhmm(meta.valid_time_utc, timeZone);
  const local = validLocal === validUtc ? "" : ` (${validLocal} locale)`;
  return `NOAA GFS 0,25° · run ${run} UTC · valide ${validUtc} UTC${local} · ${formatAgo(meta.generated_at, nowMs)}`;
}

/** Graduations de la légende : tous les `step` °C dans [-40, 40], en % de [minC, maxC]. */
export function legendTicks(minC: number, maxC: number, step = 10): { c: number; pct: number }[] {
  const out: { c: number; pct: number }[] = [];
  for (let c = -40; c <= 40; c += step) {
    out.push({ c, pct: ((c - minC) / (maxC - minC)) * 100 });
  }
  return out;
}
```

- [ ] **Step 4 : Vérifier le succès**

Run: `npm --prefix web run test`
Expected: `58 passed`. Si `Intl` produit `06:00` avec un caractère invisible (certains Node insèrent un espace insécable avant « h »), le format `hour: "2-digit", minute: "2-digit"` en `fr-FR` donne `06:00` : vérifier avec `node -e` avant de modifier le test.

- [ ] **Step 5 : `overlay.ts`**

`web/src/ui/overlay.ts` :

```ts
import { STOPS, legendGradientCss } from "../render/colormap";
import { legendTicks } from "./format";

export interface Overlay {
  setBanner(text: string): void;
  /** `null` masque le statut. */
  setStatus(text: string | null): void;
  setLegend(minC: number, maxC: number, stats: { min_c: number; max_c: number }): void;
  onOpacity(cb: (opacity: number) => void): void;
  initialOpacity(): number;
  showFatal(text: string): void;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`élément #${id} introuvable`);
  return el as T;
}

export function createOverlay(): Overlay {
  const banner = byId<HTMLElement>("banner");
  const status = byId<HTMLElement>("status");
  const legend = byId<HTMLElement>("legend");
  const opacity = byId<HTMLInputElement>("opacity");
  const fatal = byId<HTMLElement>("fatal");
  const overlay = byId<HTMLElement>("overlay");

  return {
    setBanner(text) {
      banner.textContent = text;
    },
    setStatus(text) {
      status.hidden = text === null;
      status.textContent = text ?? "";
    },
    setLegend(minC, maxC, stats) {
      const ticks = legendTicks(minC, maxC)
        .map((t) => `<span class="tick" style="left:${t.pct.toFixed(2)}%">${t.c}</span>`)
        .join("");
      legend.innerHTML =
        `<div class="bar" style="background:${legendGradientCss(STOPS, minC, maxC)}"></div>` +
        `<div class="ticks">${ticks}</div>` +
        `<div class="extremes"><span>min ${stats.min_c.toFixed(1)} °C</span><span>max ${stats.max_c.toFixed(1)} °C</span></div>`;
    },
    onOpacity(cb) {
      opacity.addEventListener("input", () => cb(Number(opacity.value)));
    },
    initialOpacity() {
      return Number(opacity.value);
    },
    showFatal(text) {
      fatal.textContent = text;
      fatal.hidden = false;
      overlay.hidden = true;
    },
  };
}
```

- [ ] **Step 6 : Réécrire `main.ts` avec l'overlay et la gestion d'erreurs (spec §7)**

`web/src/main.ts`, version complète :

```ts
import * as THREE from "three";
import { DATA_BASE_URL, REFRESH_MS, STALE_AFTER_MS } from "./config";
import { DataLoader, isStale } from "./data/loader";
import { PIXEL_RATIO_CAP, detectTier } from "./gpu/tier";
import { STOPS, buildLut, createLutTexture } from "./render/colormap";
import { createGlobe } from "./render/globe";
import { createScene } from "./render/scene";
import { formatBanner } from "./ui/format";
import { createOverlay } from "./ui/overlay";

async function boot(): Promise<void> {
  const ui = createOverlay();
  const canvas = document.getElementById("globe") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("canvas #globe introuvable");

  let sceneHandle: ReturnType<typeof createScene>;
  try {
    sceneHandle = createScene(canvas);
  } catch (e) {
    console.error(e);
    ui.showFatal("Ce navigateur ne prend pas en charge WebGL, nécessaire au globe 3D.");
    return;
  }

  const decision = detectTier(sceneHandle.renderer.getContext());
  console.info(`[worldtemp] tier ${decision.tier} — ${decision.reason}`);
  sceneHandle.setPixelRatioCap(PIXEL_RATIO_CAP[decision.tier]);

  canvas.addEventListener("webglcontextlost", (ev) => {
    ev.preventDefault();
    ui.showFatal("Le rendu 3D a été interrompu par le navigateur. Rechargez la page.");
  });

  const baseMap = await new THREE.TextureLoader().loadAsync("/textures/blue-marble-4k.jpg");
  baseMap.colorSpace = THREE.SRGBColorSpace;
  baseMap.anisotropy = sceneHandle.renderer.capabilities.getMaxAnisotropy();

  const globe = createGlobe(decision.tier, baseMap);
  globe.setOpacity(ui.initialOpacity());
  ui.onOpacity((o) => {
    globe.setOpacity(o);
    sceneHandle.requestRender();
  });
  sceneHandle.scene.add(globe.mesh);
  sceneHandle.start();

  const loader = new DataLoader(DATA_BASE_URL);
  let lutKey = "";

  const refreshBanner = () => {
    const d = loader.data;
    if (!d) return;
    ui.setBanner(formatBanner(d.meta, Date.now()));
    ui.setStatus(isStale(d.meta, Date.now(), STALE_AFTER_MS) ? "Données anciennes" : null);
  };

  const applyData = async () => {
    try {
      const fresh = await loader.refresh();
      if (fresh) {
        const { encoding, grid, stats } = fresh.meta;
        const key = `${encoding.min_c}/${encoding.max_c}`;
        if (key !== lutKey) {
          globe.setLut(createLutTexture(buildLut(STOPS, encoding.min_c, encoding.max_c)));
          ui.setLegend(encoding.min_c, encoding.max_c, stats);
          lutKey = key;
        } else {
          ui.setLegend(encoding.min_c, encoding.max_c, stats);
        }
        globe.setHeatmap(fresh.texture, grid.width, grid.height);
        sceneHandle.requestRender();
        console.info(`[worldtemp] données ${fresh.meta.run} f${fresh.meta.forecast_hour}, valides ${fresh.meta.valid_time_utc}`);
      }
      refreshBanner();
    } catch (e) {
      console.warn("[worldtemp] données indisponibles :", e);
      if (loader.data) {
        refreshBanner();
      } else {
        ui.setBanner("NOAA GFS 0,25°");
        ui.setStatus("Données indisponibles, nouvel essai dans 15 min");
      }
    }
  };

  await applyData();
  setInterval(applyData, REFRESH_MS);
  setInterval(refreshBanner, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void applyData();
  });
}

boot().catch((e: unknown) => {
  console.error(e);
  const fatal = document.getElementById("fatal");
  if (fatal) {
    fatal.textContent = "Le globe n'a pas pu démarrer. Rechargez la page.";
    fatal.hidden = false;
  }
});
```

- [ ] **Step 7 : Validation visuelle (critère 3 et §7)**

Run: `npm --prefix web run typecheck && npm --prefix web run dev`.
Vérifier :
- bandeau : `run` et `valide` identiques aux champs de `https://pub-97483d42990244b3b19ae530da791d26.r2.dev/gfs/latest.json` ; « il y a … » cohérent avec `generated_at` ;
- légende : gradient identique aux couleurs du globe (comparer le vert de 0 °C, le jaune de 10 °C), graduations −40 → 40, min/max réels ;
- simulation d'erreur : relancer le serveur avec une base fausse, PowerShell `$env:VITE_DATA_BASE_URL="https://pub-97483d42990244b3b19ae530da791d26.r2.dev/nope"; npm --prefix web run dev` (puis `Remove-Item Env:VITE_DATA_BASE_URL`) → globe Blue Marble seul, statut « Données indisponibles, nouvel essai dans 15 min », aucune exception non attrapée dans la console ;
- mobile (DevTools mode appareil, iPhone SE) : overlay lisible, légende pleine largeur, slider accessible.

- [ ] **Step 8 : Commit**

```bash
git add web/src/ui web/tests/format.test.ts web/src/main.ts
git commit -m "feat(web): overlay (légende, bandeau, statut) et dégradation sans données"
```

---

### Task 9 : Wrangler, en-têtes, CI, secrets

**Files:**
- Create: `web/wrangler.jsonc`, `web/public/_headers`
- Modify: `.github/workflows/test.yml`

**Interfaces:**
- Consumes: `npm run build` (Task 6), secrets GitHub `CLOUDFLARE_API_TOKEN` (utilisateur) et `CLOUDFLARE_ACCOUNT_ID` (agent).
- Produces: job `deploy` prêt (il ne tourne que sur push `master`, donc en T10).

- [ ] **Step 1 : `wrangler.jsonc` et `_headers`**

`web/wrangler.jsonc` :

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  // Worker sans script : uniquement des assets statiques (spec §6).
  "name": "worldtemp",
  "compatibility_date": "2026-09-02",
  "assets": {
    "directory": "./dist"
  }
}
```

`web/public/_headers` :

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/textures/*
  Cache-Control: public, max-age=86400

/
  Cache-Control: public, max-age=0, must-revalidate

/index.html
  Cache-Control: public, max-age=0, must-revalidate
```

Vérifier localement que le build copie le fichier : `npm --prefix web run build && ls web/dist/_headers`.

- [ ] **Step 2 : Étendre `test.yml`**

Remplacer `.github/workflows/test.yml` par :

```yaml
name: test

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
          cache-dependency-path: |
            pipeline/requirements.txt
            pipeline/requirements-grib.txt
      - name: Dépendances (avec cfgrib/eccodes)
        run: pip install -r pipeline/requirements.txt -r pipeline/requirements-grib.txt pytest
      - name: Tests (niveaux 1 et 2)
        run: python -m pytest -v
      - name: Contrôle HISTORY.md
        run: python tools/history_check.py
      - name: Dry-run contre NOMADS réel
        if: ${{ !cancelled() }}
        run: python -m pipeline.main --dry-run
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: dry-run
          path: out/
          retention-days: 3

  web:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: web-dist
          path: web/dist/
          retention-days: 3

  deploy:
    needs: [test, web]
    if: github.event_name == 'push' && github.ref == 'refs/heads/master'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
      - run: npm run build
      - name: Déploiement Workers Static Assets
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

- [ ] **Step 3 : Secrets (utilisateur + agent)**

Agent : `gh secret set CLOUDFLARE_ACCOUNT_ID --body f45e3b056c96dfecc718fe4504c851d2`.

Utilisateur, au dashboard Cloudflare → My Profile → API Tokens → Create Token → modèle **« Edit Cloudflare Workers »**, restreint au compte, TTL sans fin, nom `worldtemp-github-deploy`. Puis dans un PowerShell séparé, à la racine du dépôt, après avoir copié le token :

```powershell
Get-Clipboard | gh secret set CLOUDFLARE_API_TOKEN
```

Vérifier : `gh secret list` montre `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`.

- [ ] **Step 4 : Commit, push, CI de branche**

```bash
git add web/wrangler.jsonc web/public/_headers .github/workflows/test.yml
git commit -m "ci(web): jobs web et deploy (Workers Static Assets), en-têtes de cache"
git push -u origin feat/globe-heatmap
gh run watch
```

Expected : job `web` vert (typecheck, vitest, build, artefact) ; `deploy` ignoré (pas `master`) ; `test` rouge uniquement sur l'étape `history_check` (attendu jusqu'en T10).

---

### Task 10 : HISTORY, merge, déploiement et validation finale — critères 4, 5, 6

**Files:**
- Modify: `HISTORY.md`

- [ ] **Step 1 : HISTORY.md** (skill `updating-history`, depuis le diff `git log master..HEAD`)

- §2 : ligne Frontend (Vite 8, TypeScript 5, Three.js 0.185, Vitest 4, Wrangler 4, Node 24) ; hébergement : **Workers Static Assets** remplace Pages.
- §3 : arbre `web/` (fichiers de la table « Fichiers » ci-dessus) et `tools/prepare_bluemarble.py`.
- §5 : décisions du 2026-09-02 (Workers plutôt que Pages, ShaderMaterial unique, LUT sRGB, ImageBitmap `imageOrientation`, Blue Marble dans `/textures/` hors cache immutable, pas de micro-benchmark, deploy après tests).
- §6 : tout défaut non trivial rencontré pendant l'exécution.
- §8 : dette n° 3 → « honorée côté front » ; nouvelles dettes éventuelles.
- §9 : entrée datée, tests, build, prochaine action = brainstorming spec 3 (relief, dette n° 4). URL du site : « à compléter après merge ».
- Pied de page : nouvelle entrée en tête, l'ancienne rétrogradée.

Run: `.venv/Scripts/python tools/history_check.py && npm --prefix web run test && .venv/Scripts/python -m pytest -q`
Expected: `✓ HISTORY.md est à jour …`, `58 passed` (vitest), `85 passed, 1 skipped` (pytest, inchangé).

```bash
git add HISTORY.md
git commit -m "docs(history): globe + heatmap (spec 2), Workers Static Assets"
git push
gh run watch --exit-status
```

Expected : `test` et `web` verts sur la branche.

- [ ] **Step 2 : Merge dans `master`** via `superpowers:finishing-a-development-branch` (merge local, push `master`). Puis :

```bash
gh run watch --exit-status
```

Expected : `test`, `web` puis `deploy` verts. Le journal de `deploy` se termine par `Deployed worldtemp triggers` et une URL `https://worldtemp.<sous-domaine>.workers.dev`. Noter l'URL.

- [ ] **Step 3 : CORS R2 pour l'origine du site (agent, MCP Cloudflare)**

Via `mcp__plugin_cloudflare_cloudflare-api__execute`, `PUT /accounts/{accountId}/r2/buckets/worldtemp/cors` avec :

```json
{ "rules": [ { "id": "local-dev", "allowed": { "origins": ["http://localhost:5173"], "methods": ["GET", "HEAD"], "headers": ["*"] }, "maxAgeSeconds": 3600 },
             { "id": "site", "allowed": { "origins": ["https://worldtemp.<sous-domaine>.workers.dev"], "methods": ["GET", "HEAD"], "headers": ["*"] }, "maxAgeSeconds": 3600 } ] }
```

Puis `GET …/cors` pour relire les deux règles.

- [ ] **Step 4 : Vérifier le site en ligne (critère 6)**

```bash
curl -sI https://worldtemp.<sous-domaine>.workers.dev/ | grep -i "HTTP/\|cache-control\|content-type"
curl -sI https://worldtemp.<sous-domaine>.workers.dev/textures/blue-marble-4k.jpg | grep -i "cache-control"
```

Expected : `200`, `text/html`, `max-age=0, must-revalidate` ; `max-age=86400` sur la texture. Puis dans le navigateur : globe + heatmap, aucune erreur CORS, onglet Réseau « transferred » < 3 Mo au premier chargement, et l'URL d'un fichier `/assets/index-*.js` répond `immutable`.

- [ ] **Step 5 : Critère 4 sur téléphone (utilisateur)**

Ouvrir l'URL `workers.dev` sur le téléphone : navigation fluide (≥ 30 fps perçus), overlay lisible ; puis `?tier=low` et `?tier=high` pour comparer. Noter le tier choisi automatiquement (console distante ou simplement l'aspect). Si le tier automatique est mauvais sur cet appareil, ajouter son nom GPU aux motifs de `gpu/tier.ts` avec un test, dans un commit séparé.

- [ ] **Step 6 : Critère 5**

Laisser la page ouverte sur desktop, attendre le run horaire du cron (minute 12) ou forcer `gh workflow run pipeline.yml` à l'heure suivante ; dans les 15 min qui suivent la publication, la console affiche une nouvelle ligne `[worldtemp] données … valides …` et le bandeau change sans rechargement.

- [ ] **Step 7 : Commit de suivi sur `master`**

Compléter §9 de `HISTORY.md` avec l'URL `workers.dev`, le tier choisi par le téléphone et le résultat des critères 4 à 6 ; pied de page bumpé.

```bash
.venv/Scripts/python tools/history_check.py
git add HISTORY.md
git commit -m "docs(history): site en ligne sur workers.dev, critères 4 à 6 validés"
git push
gh run watch --exit-status
```

---

## Auto-revue du plan

**Couverture spec :** §2 arbre → T1, T5, T6, T7, T8 ; §3 chargement (parse, texture stricte, cache-busting, refresh 15 min + `visibilitychange`, CORS) → T1, T7, T9 ; §4 tier, profils, scène à la demande, shader, colormap → T4, T6, T3 ; §5 UI (légende, slider, bandeau, statut, `#ad-slot`, mobile) → T6 (HTML/CSS), T8 ; §6 build, wrangler, `_headers`, CI, token → T9, CORS → T10 ; §7 erreurs (WebGL absent, JSON, PNG, stale, contexte perdu, `encoding` change) → T6, T8 ; §8 tests (metadata, sampling, colormap, tier, loader, + format) → T1, T2, T3, T4, T7, T8 ; §9 critères 1 → T6, 2 → T7, 3 → T8, 4, 5 et 6 → T10 (déploiement effectif après merge, car `deploy` ne tourne que sur `master`).

**Écarts assumés vs spec :** Blue Marble dans `public/textures/` (et non `public/assets/`) pour la tenir hors du cache `immutable` des fichiers hachés de Vite ; l'éclairage « DirectionalLight liée à la caméra + AmbientLight » est réalisé dans le shader (`uLightDir` en espace vue, terme ambiant 0,25), un `ShaderMaterial` ignorant les lumières de scène ; `ui/format.ts` ajouté pour rendre le bandeau et les graduations testables.

**Cohérence des signatures :** `parseMetadata`/`LatestMetadata` (T1) consommés en T7, T8 ; `heatmapUv` (T2) autonome, miroir documenté du GLSL (T6) ; `STOPS`/`buildLut`/`createLutTexture`/`legendGradientCss` (T3) en T7, T8 ; `decideTier`/`detectTier`/`PIXEL_RATIO_CAP` (T4) en T6 ; `createScene().setPixelRatioCap/requestRender/start` et `createGlobe().setHeatmap/setLut/setOpacity` (T6) en T7, T8 ; `DataLoader.refresh/data`, `isStale` (T7) en T8 ; `SAMPLE` de `tests/fixtures.ts` réutilisé en T1, T7, T8 ; `createOverlay()` (T8) consommé par `main.ts` (T8). Comptes de tests cumulés : 10, 14, 23, 39, 52, 58.
