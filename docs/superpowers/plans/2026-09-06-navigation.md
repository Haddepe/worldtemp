# Navigation : zoom vers le curseur, pincement, tooltip, fondu — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un zoom ancré sous le curseur (molette) ou entre les doigts (pincement), à sensation uniforme du globe entier au « zoom Normandie » ; un tooltip de température au survol (souris) ou au tap (tactile) ; un fondu satellite → carte plus franc. Ferme la dette n° 23 de HISTORY §8.

**Architecture:** Dolly maison sur l'**altitude** `a = d − 1` dans `web/src/controls/zoom.ts` (`controls.enableZoom = false`, OrbitControls garde la rotation et relit `camera.position`), avec une ancre ramenée sous le curseur par rotation de la caméra autour de l'origine (`anchorRotate`, 4 itérations max). Picking analytique sur la sphère unité dans `web/src/render/pick.ts`, partagé avec le tooltip. Lecture des valeurs dans les pixels du PNG heatmap (`data/pixels.ts` → `Uint8ClampedArray` nord en haut, `sampling.ts::sampleTemperature` bilinéaire). Tooltip = une « lecture » `{lon, lat}` projetée à chaque rendu (`ui/tooltip.ts`), entrée souris ou `TapDetector`. Tout le calcul est dans des fonctions pures testées en Vitest ; le DOM et les événements ne sont que du branchement.

**Tech Stack:** Node 24, Vite 8, TypeScript 5.9 (`strict`, `noUncheckedIndexedAccess`), Three.js 0.185 (`OrbitControls` des addons), Vitest 4, Wrangler 4 (déploiement par CI, inchangé).

**Spec:** `docs/superpowers/specs/2026-09-06-navigation-design.md` — le plan argumente à partir de la spec ; l'exécutant lit les deux. Contexte : caméra et LOD de la spec 3 (`docs/superpowers/specs/2026-09-05-tiles-design.md` §5), contrat heatmap de la spec pipeline §4 (`docs/superpowers/specs/2026-08-30-pipeline-gfs-design.md`).

## Global Constraints

- **Altitude** : `a = d − 1`, `d` = distance caméra–origine. Bornes `aMin = MIN_DISTANCE − 1 = 0,042`, `aMax = MAX_DISTANCE − 1 = 3` (constantes de `web/src/render/scene.ts`, à importer, jamais recopier).
- **Molette** : `a' = a · WHEEL_BASE^(−deltaPx / 100)`, `WHEEL_BASE = 0,885` ; `deltaY < 0` = rapprochement (convention OrbitControls). `deltaMode` : `DOM_DELTA_LINE` (1) × 16, `DOM_DELTA_PAGE` (2) × 400 ; résultat borné à ±300 px par événement. Lissage `a += (aTarget − a) · 0,25` par frame, convergence quand `|aTarget − a| < 1e-4 · a`.
- **Pincement** : `a = clamp(a₀ · dist₀ / dist, aMin, aMax)`, sans lissage ; ancre prise au début du geste sous le milieu des doigts, `screen` suit le milieu courant.
- **Ancre** : `{ point: Vector3 unitaire, screen: {x, y} px CSS depuis le coin haut-gauche du canvas }`. Application : altitude d'abord (direction inchangée), puis jusqu'à 4 fois : `p₂ = pickSphere(screen)` ; si `null` arrêter ; `q = setFromUnitVectors(p₂, point)` ; `position.applyQuaternion(q)` ; `lookAt(0,0,0)` ; `updateMatrixWorld(true)` ; arrêt anticipé si l'erreur de reprojection < 0,1 px. Cible d'OrbitControls toujours à l'origine.
- **Orientation** : `lonLatToVec3(lon, lat) = (−cos φ · sin θ, cos θ, sin φ · sin θ)`, `φ = (lon + 180)°`, `θ = (90 − lat)°` (`web/src/tiles/patch.ts`). `vec3ToLonLat` en est l'inverse exact, `lon ∈ [−180 ; 180[`.
- **Pixels heatmap** : `bitmapPixels` livre des lignes **nord en haut** (ligne 0 = lat 90, comme le PNG du pipeline ; l'`ImageBitmap` est créé `flipY`, le dessin re-retourne). RGBA, canal R = valeur 8 bits. `°C = min_c + (t / 255) · (max_c − min_c)`, `grid` et `encoding` viennent de `latest.json` (aucune constante recopiée).
- **Échantillonnage** : colonne fractionnaire `x = ((lon + 180) / 360) · W` (centre de cellule à l'entier, lon −180 = centre de la colonne 0), bouclage modulo `W` ; ligne `y = ((90 − lat) / 180) · (H − 1)`, bornée `[0 ; H − 1]`. Bilinéaire.
- **Tap** : un seul pointeur, déplacement < 8 px, durée < 300 ms, aucun second doigt pendant le geste. Retrait du marqueur : tap à < 24 px du marqueur.
- **Tooltip** : `#tooltip` (`.panel`, `pointer-events: none`, `role="status"`, `aria-live="polite"`), centré au-dessus du point avec 14 px de décalage, en dessous si le point est à < 48 px du haut ; `#marker` 12 px, visible en mode `pin` seulement. Texte « 23,4 °C » (une décimale, virgule, signe « − » U+2212). Affiché filtre actif ou non ; jamais sans données.
- **Fondu** : `mapStyleFor` linéaire borné entre `MAP_FADE_START = 1,20` (0) et `MAP_FADE_END = 1,14` (1), dénominateur `MAP_FADE_START − MAP_FADE_END`.
- **Rendu à la demande préservé** : tout changement de caméra ou de tooltip passe par `requestRender()` ; jamais de rendu en boucle sans mouvement.
- Aucune dépendance d'exécution ajoutée. Aucun `readPixels` WebGL. Aucun nouveau fetch réseau.
- Commandes depuis la racine du dépôt : `npm --prefix web run test`, `npm --prefix web run typecheck`, `npm --prefix web run build`. Un seul fichier de test : `npm --prefix web run test -- tests/pick.test.ts`. Vitest tourne en environnement Node (pas de DOM) : ne tester que la logique pure.
- Travail sur la branche **`feat/navigation`** créée depuis `master`, **en place** (pas de worktree). Merge en T10 via `superpowers:finishing-a-development-branch`.
- Dépôt en LF, commits en français, Conventional Commits, un commit par tâche au minimum, trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` et `Claude-Session: https://claude.ai/code/session_01124wJUST8XWLzxtzEkthgZ`.
- Ne jamais écrire de secret dans le chat ni dans un fichier versionné.

## Fichiers

| Fichier | Rôle |
|---|---|
| `web/src/render/pick.ts` | `pickSphere`, `vec3ToLonLat`, `projectToScreen` (purs) |
| `web/src/controls/zoom.ts` | `WHEEL_BASE`, `normalizeWheel`, `nextAltitude`, `pinchAltitude`, `PinchTracker`, `Anchor`, `anchorRotate`, `attachZoom` |
| `web/src/render/scene.ts` | `enableZoom = false`, branchement de `attachZoom` dans la boucle |
| `web/src/data/pixels.ts` | `bitmapPixels` (canvas 2D, re-retournement) |
| `web/src/data/loader.ts` | `LoaderDeps.bitmapPixels`, `LoadedData.pixels` |
| `web/src/data/sampling.ts` | `sampleTemperature` |
| `web/src/ui/format.ts` | `formatTemperature` |
| `web/src/ui/tooltip.ts` | `TapDetector`, `placeTooltip`, `createTooltip` |
| `web/src/ui/overlay.ts` | `byId` exporté |
| `web/src/main.ts` | branchement souris / tap / données / rendu |
| `web/index.html`, `web/src/style.css` | `#tooltip`, `#marker` |
| `web/src/tiles/lod.ts` | `MAP_FADE_START`, `MAP_FADE_END` |
| `web/tests/pick.test.ts`, `zoom.test.ts`, `pixels.test.ts`, `tooltip.test.ts` | nouveaux tests |
| `web/tests/sampling.test.ts`, `format.test.ts`, `loader.test.ts`, `tiles-lod.test.ts` | tests étendus |
| `HISTORY.md` | §3, §5, §6, §7, §8 (dette 23), §9 |

---

### Task 0 : Branche

**Files:** aucun.

- [ ] **Step 1 : Créer la branche**

```bash
git checkout master && git pull --ff-only && git checkout -b feat/navigation
```

- [ ] **Step 2 : Vérifier l'état de départ**

Run : `npm --prefix web run test` · Expected : `91 passed`.
Run : `npm --prefix web run typecheck` · Expected : aucune erreur.

---

### Task 1 : Picking (`render/pick.ts`)

**Files:**
- Create: `web/src/render/pick.ts`
- Test: `web/tests/pick.test.ts`

**Interfaces:**
- Consumes: `lonLatToVec3` de `web/src/tiles/patch.ts`.
- Produces:
  - `pickSphere(ndcX: number, ndcY: number, camera: THREE.PerspectiveCamera, target?: THREE.Vector3): THREE.Vector3 | null` — point de la sphère unité sous le point NDC, ou `null`.
  - `vec3ToLonLat(p: THREE.Vector3): { lon: number; lat: number }`.
  - `projectToScreen(p: THREE.Vector3, camera: THREE.PerspectiveCamera, width: number, height: number): { x: number; y: number; visible: boolean }`.
  - `ndcFromCanvas(x: number, y: number, width: number, height: number): { x: number; y: number }` — px CSS canvas → NDC.

- [ ] **Step 1 : Écrire les tests**

```ts
// web/tests/pick.test.ts
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ndcFromCanvas, pickSphere, projectToScreen, vec3ToLonLat } from "../src/render/pick";
import { lonLatToVec3 } from "../src/tiles/patch";

function camera(position: THREE.Vector3, aspect = 1000 / 800): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, aspect, 0.01, 10);
  cam.position.copy(position);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

describe("pickSphere", () => {
  it("rayon central depuis (0,0,3) touche (0,0,1)", () => {
    const p = pickSphere(0, 0, camera(new THREE.Vector3(0, 0, 3)));
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(0, 9);
    expect(p!.y).toBeCloseTo(0, 9);
    expect(p!.z).toBeCloseTo(1, 9);
  });

  it("renvoie le point le plus proche de la caméra (face visible)", () => {
    const p = pickSphere(0, 0, camera(new THREE.Vector3(3, 0, 0)))!;
    expect(p.x).toBeCloseTo(1, 9);
  });

  it("rayon hors du globe → null", () => {
    // en (0,0,3), FOV 45°, le globe couvre ≈ ±19,5° : le coin NDC (1, 1) est dans le vide
    expect(pickSphere(1, 1, camera(new THREE.Vector3(0, 0, 3)))).toBeNull();
  });

  it("le point rendu est sur la sphère unité", () => {
    const p = pickSphere(0.3, -0.2, camera(new THREE.Vector3(1, 2, 2)))!;
    expect(p.length()).toBeCloseTo(1, 9);
  });

  it("réutilise `target` s'il est fourni", () => {
    const t = new THREE.Vector3();
    expect(pickSphere(0, 0, camera(new THREE.Vector3(0, 0, 3)), t)).toBe(t);
  });
});

describe("vec3ToLonLat", () => {
  it("inverse de lonLatToVec3 sur une grille (hors pôles)", () => {
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = -80; lat <= 80; lat += 40) {
        const r = vec3ToLonLat(lonLatToVec3(lon, lat));
        expect(r.lon).toBeCloseTo(lon, 9);
        expect(r.lat).toBeCloseTo(lat, 9);
      }
    }
  });
  it("lon 180 est ramené à -180", () => {
    expect(vec3ToLonLat(lonLatToVec3(180, 10)).lon).toBeCloseTo(-180, 9);
  });
  it("pôles : lat ±90, lon fini", () => {
    expect(vec3ToLonLat(new THREE.Vector3(0, 1, 0)).lat).toBeCloseTo(90, 9);
    expect(vec3ToLonLat(new THREE.Vector3(0, -1, 0)).lat).toBeCloseTo(-90, 9);
    expect(Number.isFinite(vec3ToLonLat(new THREE.Vector3(0, 1, 0)).lon)).toBe(true);
  });
  it("tolère un vecteur légèrement hors sphère (y = 1,0000001)", () => {
    expect(vec3ToLonLat(new THREE.Vector3(0, 1.0000001, 0)).lat).toBeCloseTo(90, 6);
  });
});

describe("projectToScreen", () => {
  it("point face caméra → centre du viewport, visible", () => {
    const s = projectToScreen(new THREE.Vector3(0, 0, 1), camera(new THREE.Vector3(0, 0, 3)), 1000, 800);
    expect(s.x).toBeCloseTo(500, 6);
    expect(s.y).toBeCloseTo(400, 6);
    expect(s.visible).toBe(true);
  });
  it("point derrière l'horizon → visible = false", () => {
    // (0,0,-1) est la face cachée depuis (0,0,3)
    expect(projectToScreen(new THREE.Vector3(0, 0, -1), camera(new THREE.Vector3(0, 0, 3)), 1000, 800).visible).toBe(false);
  });
  it("point sur le limbe mais hors viewport → visible = false", () => {
    // caméra très près : (0,0,1) visible, un point à 60° de longitude est devant l'horizon mais hors champ
    const p = lonLatToVec3(60, 0);
    const cam = camera(lonLatToVec3(0, 0).multiplyScalar(1.05));
    expect(projectToScreen(p, cam, 1000, 800).visible).toBe(false);
  });
  it("y croît vers le bas (point au nord → y < centre)", () => {
    const s = projectToScreen(lonLatToVec3(-90, 10), camera(lonLatToVec3(-90, 0).multiplyScalar(3)), 1000, 800);
    expect(s.y).toBeLessThan(400);
    expect(s.x).toBeCloseTo(500, 6);
  });
});

describe("ndcFromCanvas", () => {
  it("coin haut-gauche → (-1, 1), centre → (0, 0)", () => {
    expect(ndcFromCanvas(0, 0, 1000, 800)).toEqual({ x: -1, y: 1 });
    expect(ndcFromCanvas(500, 400, 1000, 800)).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm --prefix web run test -- tests/pick.test.ts` · Expected : FAIL, module `../src/render/pick` introuvable.

- [ ] **Step 3 : Implémenter**

```ts
// web/src/render/pick.ts
/**
 * Picking analytique sur la sphère unité (spec navigation §3). Indépendant des patches
 * chargés : pas de raycast sur les meshes. La caméra doit avoir `matrixWorld` et
 * `projectionMatrixInverse` à jour (`updateMatrixWorld(true)`, `updateProjectionMatrix()`).
 */
import * as THREE from "three";

const RAD_TO_DEG = 180 / Math.PI;
const origin = new THREE.Vector3();
const dir = new THREE.Vector3();
const camDir = new THREE.Vector3();
const ndc = new THREE.Vector3();

/** Intersection la plus proche du rayon caméra passant par le point NDC avec la sphère unité. */
export function pickSphere(ndcX: number, ndcY: number, camera: THREE.PerspectiveCamera, target = new THREE.Vector3()): THREE.Vector3 | null {
  origin.setFromMatrixPosition(camera.matrixWorld);
  dir.set(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  const b = origin.dot(dir);
  const c = origin.dot(origin) - 1;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null; // caméra sous la surface : impossible avec minDistance > 1
  return target.copy(origin).addScaledVector(dir, t);
}

/** Inverse exact de `tiles/patch.ts::lonLatToVec3`. lon ∈ [−180 ; 180[, lat ∈ [−90 ; 90]. */
export function vec3ToLonLat(p: THREE.Vector3): { lon: number; lat: number } {
  const len = p.length() || 1;
  const y = Math.max(-1, Math.min(1, p.y / len));
  const lat = 90 - Math.acos(y) * RAD_TO_DEG;
  let lon = Math.atan2(p.z, -p.x) * RAD_TO_DEG - 180;
  if (lon < -180) lon += 360;
  if (lon >= 180) lon -= 360;
  return { lon, lat };
}

/** Coordonnées CSS px depuis le coin haut-gauche ; `visible` = devant l'horizon et dans le viewport. */
export function projectToScreen(
  p: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): { x: number; y: number; visible: boolean } {
  camDir.setFromMatrixPosition(camera.matrixWorld);
  const d = camDir.length();
  camDir.divideScalar(d);
  const frontOfHorizon = p.dot(camDir) / (p.length() || 1) > 1 / d;
  ndc.copy(p).project(camera);
  const inView = ndc.x >= -1 && ndc.x <= 1 && ndc.y >= -1 && ndc.y <= 1 && ndc.z <= 1;
  return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height, visible: frontOfHorizon && inView };
}

/** px CSS du canvas → NDC (x droite, y haut). */
export function ndcFromCanvas(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return { x: (x / width) * 2 - 1, y: 1 - (y / height) * 2 };
}
```

- [ ] **Step 4 : Vérifier le succès**

Run : `npm --prefix web run test -- tests/pick.test.ts` · Expected : tous verts.
Run : `npm --prefix web run typecheck` · Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add web/src/render/pick.ts web/tests/pick.test.ts
git commit -m "feat(web): picking analytique sur la sphère unité (pick.ts)"
```

---

### Task 2 : Courbe de zoom et suivi du pincement (`controls/zoom.ts`, partie pure)

**Files:**
- Create: `web/src/controls/zoom.ts`
- Test: `web/tests/zoom.test.ts`

**Interfaces:**
- Produces:
  - `WHEEL_BASE = 0.885`.
  - `normalizeWheel(deltaY: number, deltaMode: number): number` — px, borné ±300.
  - `nextAltitude(a: number, deltaPx: number, aMin: number, aMax: number): number`.
  - `pinchAltitude(a0: number, dist0: number, dist: number, aMin: number, aMax: number): number`.
  - `class PinchTracker { down(id, x, y); move(id, x, y); up(id); reset(); pair(): string | null; pinch(): { dist: number; mid: { x: number; y: number } } | null }` — `pair()` = clé `"idA:idB"` des deux premiers pointeurs, `null` si moins de deux.

- [ ] **Step 1 : Écrire les tests**

```ts
// web/tests/zoom.test.ts
import { describe, expect, it } from "vitest";
import { PinchTracker, WHEEL_BASE, nextAltitude, normalizeWheel, pinchAltitude } from "../src/controls/zoom";

const A_MIN = 0.042;
const A_MAX = 3;

describe("normalizeWheel", () => {
  it("pixels tels quels, lignes × 16, pages × 400", () => {
    expect(normalizeWheel(100, 0)).toBe(100);
    expect(normalizeWheel(3, 1)).toBe(48);
    expect(normalizeWheel(0.5, 2)).toBe(200);
    expect(normalizeWheel(1, 2)).toBe(300); // 400 px, borné
  });
  it("borne à ±300", () => {
    expect(normalizeWheel(5000, 0)).toBe(300);
    expect(normalizeWheel(-5000, 0)).toBe(-300);
  });
});

describe("nextAltitude", () => {
  it("deltaY < 0 rapproche d'un facteur WHEEL_BASE par cran de 100", () => {
    expect(nextAltitude(1, -100, A_MIN, A_MAX)).toBeCloseTo(WHEEL_BASE, 12);
    expect(nextAltitude(1, 100, A_MIN, A_MAX)).toBeCloseTo(1 / WHEEL_BASE, 12);
  });
  it("35 ± 1 crans de A_MAX à A_MIN", () => {
    let a = A_MAX;
    let n = 0;
    while (a > A_MIN) {
      a = nextAltitude(a, -100, A_MIN, A_MAX);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(34);
    expect(n).toBeLessThanOrEqual(36);
  });
  it("respecte les bornes", () => {
    expect(nextAltitude(A_MIN, -100, A_MIN, A_MAX)).toBe(A_MIN);
    expect(nextAltitude(A_MAX, 100, A_MIN, A_MAX)).toBe(A_MAX);
  });
});

describe("pinchAltitude", () => {
  it("écart doublé → altitude divisée par deux", () => {
    expect(pinchAltitude(1, 100, 200, A_MIN, A_MAX)).toBeCloseTo(0.5, 12);
    expect(pinchAltitude(1, 200, 100, A_MIN, A_MAX)).toBeCloseTo(2, 12);
  });
  it("bornes et écart nul", () => {
    expect(pinchAltitude(0.05, 100, 10000, A_MIN, A_MAX)).toBe(A_MIN);
    expect(pinchAltitude(2, 100, 1, A_MIN, A_MAX)).toBe(A_MAX);
    expect(pinchAltitude(1, 100, 0, A_MIN, A_MAX)).toBe(1);
  });
});

describe("PinchTracker", () => {
  it("pas de pincement à un doigt, pincement au second, clé stable", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    expect(t.pair()).toBeNull();
    expect(t.pinch()).toBeNull();
    t.down(2, 30, 40);
    expect(t.pair()).toBe("1:2");
    expect(t.pinch()).toEqual({ dist: 50, mid: { x: 15, y: 20 } });
  });
  it("move met à jour distance et milieu", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 30, 40);
    t.move(2, 60, 80);
    expect(t.pinch()).toEqual({ dist: 100, mid: { x: 30, y: 40 } });
  });
  it("troisième doigt ignoré ; retrait de l'un des deux premiers → nouvelle paire", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 30, 40);
    t.down(3, 500, 500);
    expect(t.pair()).toBe("1:2");
    t.up(2);
    expect(t.pair()).toBe("1:3");
    t.up(1);
    expect(t.pair()).toBeNull();
  });
  it("reset vide tout", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 1, 1);
    t.reset();
    expect(t.pair()).toBeNull();
  });
  it("move d'un pointeur inconnu est ignoré", () => {
    const t = new PinchTracker();
    t.move(9, 1, 1);
    expect(t.pair()).toBeNull();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm --prefix web run test -- tests/zoom.test.ts` · Expected : FAIL, module introuvable.

- [ ] **Step 3 : Implémenter la partie pure**

```ts
// web/src/controls/zoom.ts
/**
 * Zoom maison sur l'altitude a = d − 1 (spec navigation §4). OrbitControls garde la rotation
 * (`enableZoom = false`) et relit `camera.position` à chaque `update()`.
 */
import * as THREE from "three";

export const WHEEL_BASE = 0.885;
const WHEEL_MAX_PX = 300;

/** `deltaY` d'un WheelEvent en pixels, borné à ±300 (trackpads inertiels). */
export function normalizeWheel(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.max(-WHEEL_MAX_PX, Math.min(WHEEL_MAX_PX, px));
}

function clamp(a: number, aMin: number, aMax: number): number {
  return Math.min(aMax, Math.max(aMin, a));
}

/** Altitude après un cran de molette : deltaPx < 0 rapproche (convention OrbitControls). */
export function nextAltitude(a: number, deltaPx: number, aMin: number, aMax: number): number {
  return clamp(a * Math.pow(WHEEL_BASE, -deltaPx / 100), aMin, aMax);
}

/** Altitude pendant un pincement : doubler l'écart des doigts divise l'altitude par deux. */
export function pinchAltitude(a0: number, dist0: number, dist: number, aMin: number, aMax: number): number {
  if (dist <= 0 || dist0 <= 0) return a0;
  return clamp((a0 * dist0) / dist, aMin, aMax);
}

interface PointerPos {
  x: number;
  y: number;
}

/** Suivi des pointeurs tactiles : le pincement porte sur les deux premiers arrivés. */
export class PinchTracker {
  private readonly pointers = new Map<number, PointerPos>();

  down(id: number, x: number, y: number): void {
    this.pointers.set(id, { x, y });
  }

  move(id: number, x: number, y: number): void {
    const p = this.pointers.get(id);
    if (p) {
      p.x = x;
      p.y = y;
    }
  }

  up(id: number): void {
    this.pointers.delete(id);
  }

  reset(): void {
    this.pointers.clear();
  }

  /** Clé des deux premiers pointeurs (ordre d'insertion), `null` si moins de deux. */
  pair(): string | null {
    if (this.pointers.size < 2) return null;
    const [a, b] = this.pointers.keys();
    return `${a}:${b}`;
  }

  pinch(): { dist: number; mid: PointerPos } | null {
    if (this.pointers.size < 2) return null;
    const [a, b] = this.pointers.values();
    if (!a || !b) return null;
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
}

// `THREE` est utilisé par Anchor/anchorRotate/attachZoom (Task 3).
export type { THREE };
```

Note : la dernière ligne évite une erreur « import inutilisé » avant la Task 3 ; elle sera retirée en Task 3.

- [ ] **Step 4 : Vérifier le succès**

Run : `npm --prefix web run test -- tests/zoom.test.ts` · Expected : tous verts.
Run : `npm --prefix web run typecheck` · Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add web/src/controls/zoom.ts web/tests/zoom.test.ts
git commit -m "feat(web): courbe de zoom sur l'altitude et suivi du pincement"
```

---

### Task 3 : Ancre, `attachZoom` et branchement dans `scene.ts`

**Files:**
- Modify: `web/src/controls/zoom.ts`
- Modify: `web/src/render/scene.ts:36-45` (contrôles), `:66-84` (boucle)
- Test: `web/tests/zoom.test.ts`

**Interfaces:**
- Consumes: `pickSphere`, `projectToScreen`, `ndcFromCanvas` (Task 1) ; `normalizeWheel`, `nextAltitude`, `pinchAltitude`, `PinchTracker` (Task 2) ; `MIN_DISTANCE`, `MAX_DISTANCE` de `scene.ts`.
- Produces:
  - `interface Anchor { point: THREE.Vector3; screen: { x: number; y: number } }`.
  - `anchorRotate(camera, anchor, width, height, maxIterations = 4): number` — renvoie l'erreur résiduelle en px (`Infinity` si l'ancre est sortie du globe).
  - `interface ZoomControl { beforeUpdate(): boolean; dispose(): void }`.
  - `attachZoom(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, opts: { requestRender(): void; aMin: number; aMax: number }): ZoomControl`.

- [ ] **Step 1 : Ajouter les tests d'ancre**

Ajouter à `web/tests/zoom.test.ts` :

```ts
import * as THREE from "three";
import { anchorRotate, type Anchor } from "../src/controls/zoom";
import { pickSphere, projectToScreen } from "../src/render/pick";

const W = 1000;
const H = 800;

function cameraAt(position: THREE.Vector3): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, W / H, 0.01, 10);
  cam.position.copy(position);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** Point de la sphère à `angleDeg` du centre de l'écran, en diagonale (exerce le roulis). */
function anchorAt(angleDeg: number, cam: THREE.PerspectiveCamera): Anchor {
  const s = Math.sin((angleDeg * Math.PI) / 180);
  const point = new THREE.Vector3(s * Math.SQRT1_2, s * Math.SQRT1_2, Math.cos((angleDeg * Math.PI) / 180)).normalize();
  const { x, y } = projectToScreen(point, cam, W, H);
  return { point, screen: { x, y } };
}

function zoomTo(cam: THREE.PerspectiveCamera, a: number): void {
  cam.position.setLength(1 + a);
  cam.updateMatrixWorld(true);
}

describe("anchorRotate", () => {
  it("point à 30° du centre, zoom de a = 2 à 0,3 : reprojeté à < 0,5 px", () => {
    const cam = cameraAt(new THREE.Vector3(0, 0, 3));
    const anchor = anchorAt(30, cam);
    zoomTo(cam, 0.3);
    const err = anchorRotate(cam, anchor, W, H);
    const s = projectToScreen(anchor.point, cam, W, H);
    expect(Math.hypot(s.x - anchor.screen.x, s.y - anchor.screen.y)).toBeLessThan(0.5);
    expect(err).toBeLessThan(0.5);
  });
  it("limbe (80°) : < 0,5 px en 4 itérations", () => {
    const cam = cameraAt(new THREE.Vector3(0, 0, 3));
    const anchor = anchorAt(80, cam);
    zoomTo(cam, 0.3);
    anchorRotate(cam, anchor, W, H);
    const s = projectToScreen(anchor.point, cam, W, H);
    expect(Math.hypot(s.x - anchor.screen.x, s.y - anchor.screen.y)).toBeLessThan(0.5);
  });
  it("la caméra reste à la même distance et regarde l'origine", () => {
    const cam = cameraAt(new THREE.Vector3(0, 0, 3));
    const anchor = anchorAt(30, cam);
    zoomTo(cam, 0.3);
    anchorRotate(cam, anchor, W, H);
    expect(cam.position.length()).toBeCloseTo(1.3, 9);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    expect(forward.dot(cam.position.clone().normalize())).toBeCloseTo(-1, 9);
  });
  it("ancre sortie du globe (zoom arrière) : rotation sautée, erreur Infinity", () => {
    const cam = cameraAt(new THREE.Vector3(0, 0, 3));
    const anchor = anchorAt(45, cam);
    zoomTo(cam, 2.5); // le point visé n'est plus sous le curseur : le rayon manque la sphère
    const before = cam.position.clone();
    expect(pickSphere((anchor.screen.x / W) * 2 - 1, 1 - (anchor.screen.y / H) * 2, cam)).toBeNull();
    expect(anchorRotate(cam, anchor, W, H)).toBe(Number.POSITIVE_INFINITY);
    expect(cam.position.distanceTo(before)).toBe(0);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm --prefix web run test -- tests/zoom.test.ts` · Expected : FAIL, `anchorRotate` non exporté.

- [ ] **Step 3 : Implémenter `Anchor`, `anchorRotate`, `attachZoom`**

Retirer la ligne `export type { THREE };` et ajouter à la fin de `web/src/controls/zoom.ts` :

```ts
import { ndcFromCanvas, pickSphere, projectToScreen } from "../render/pick";

export interface Anchor {
  /** Point de la sphère unité (unitaire) saisi sous le curseur ou entre les doigts. */
  point: THREE.Vector3;
  /** Position visée, px CSS depuis le coin haut-gauche du canvas. */
  screen: { x: number; y: number };
}

const ANCHOR_EPS_PX = 0.1;
const p2 = new THREE.Vector3();
const q = new THREE.Quaternion();

/**
 * Tourne la caméra autour de l'origine pour ramener `anchor.point` sous `anchor.screen`.
 * Convergence linéaire (`lookAt` annule le roulis) : jusqu'à `maxIterations`, arrêt sous 0,1 px.
 * Renvoie l'erreur résiduelle en px, `Infinity` si l'ancre est sortie du globe.
 */
export function anchorRotate(
  camera: THREE.PerspectiveCamera,
  anchor: Anchor,
  width: number,
  height: number,
  maxIterations = 4,
): number {
  const ndc = ndcFromCanvas(anchor.screen.x, anchor.screen.y, width, height);
  let err = Number.POSITIVE_INFINITY;
  for (let i = 0; i < maxIterations; i++) {
    if (!pickSphere(ndc.x, ndc.y, camera, p2)) return Number.POSITIVE_INFINITY;
    q.setFromUnitVectors(p2.normalize(), anchor.point);
    camera.position.applyQuaternion(q);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const s = projectToScreen(anchor.point, camera, width, height);
    err = Math.hypot(s.x - anchor.screen.x, s.y - anchor.screen.y);
    if (err < ANCHOR_EPS_PX) break;
  }
  return err;
}

export interface ZoomControl {
  /** À appeler par la boucle de rendu avant `controls.update()`. Renvoie true si la caméra a bougé. */
  beforeUpdate(): boolean;
  dispose(): void;
}

export interface ZoomOptions {
  requestRender(): void;
  aMin: number;
  aMax: number;
}

const SMOOTHING = 0.25;
const CONVERGENCE = 1e-4;

export function attachZoom(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, opts: ZoomOptions): ZoomControl {
  let wheelActive = false;
  let aTarget = 0;
  let pinchA: number | null = null;
  let anchor: Anchor | null = null;
  let anchorMoved = false;
  const pinch = new PinchTracker();
  let pinchBase: { a0: number; dist0: number; key: string } | null = null;

  const altitude = () => camera.position.length() - 1;

  const canvasPoint = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top, w: r.width, h: r.height };
  };

  const anchorAt = (x: number, y: number, w: number, h: number): Anchor | null => {
    const ndc = ndcFromCanvas(x, y, w, h);
    const p = pickSphere(ndc.x, ndc.y, camera);
    return p ? { point: p.normalize(), screen: { x, y } } : null;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const base = wheelActive ? aTarget : altitude();
    aTarget = nextAltitude(base, normalizeWheel(e.deltaY, e.deltaMode), opts.aMin, opts.aMax);
    wheelActive = true;
    const c = canvasPoint(e.clientX, e.clientY);
    anchor = anchorAt(c.x, c.y, c.w, c.h);
    opts.requestRender();
  };

  /** Début ou fin de geste quand la paire de doigts change. */
  const syncPinch = () => {
    const key = pinch.pair();
    if (key === (pinchBase?.key ?? null)) return;
    if (key) {
      const g = pinch.pinch()!;
      const r = canvas.getBoundingClientRect();
      pinchBase = { a0: altitude(), dist0: g.dist, key };
      anchor = anchorAt(g.mid.x - r.left, g.mid.y - r.top, r.width, r.height);
      wheelActive = false;
    } else {
      pinchBase = null;
      anchor = null;
      pinchA = null;
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    pinch.down(e.pointerId, e.clientX, e.clientY);
    syncPinch();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    pinch.move(e.pointerId, e.clientX, e.clientY);
    const g = pinch.pinch();
    if (!pinchBase || !g || pinch.pair() !== pinchBase.key) return;
    pinchA = pinchAltitude(pinchBase.a0, pinchBase.dist0, g.dist, opts.aMin, opts.aMax);
    if (anchor) {
      const r = canvas.getBoundingClientRect();
      anchor.screen = { x: g.mid.x - r.left, y: g.mid.y - r.top };
      anchorMoved = true;
    }
    opts.requestRender();
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    pinch.up(e.pointerId);
    syncPinch();
  };
  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    pinch.reset();
    syncPinch();
  };

  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);

  return {
    beforeUpdate() {
      const a = altitude();
      let aNew = a;
      if (pinchA !== null) {
        aNew = pinchA;
        pinchA = null;
      } else if (wheelActive) {
        aNew = a + (aTarget - a) * SMOOTHING;
        if (Math.abs(aTarget - aNew) < CONVERGENCE * aNew) {
          aNew = aTarget;
          wheelActive = false;
        } else {
          opts.requestRender();
        }
      }
      let moved = false;
      if (aNew !== a) {
        camera.position.setLength(1 + aNew);
        camera.updateMatrixWorld(true);
        moved = true;
      }
      if (anchor && (moved || anchorMoved)) {
        const r = canvas.getBoundingClientRect();
        anchorRotate(camera, anchor, r.width, r.height);
        anchorMoved = false;
        moved = true;
      }
      if (!wheelActive && !pinchBase) anchor = null;
      return moved;
    },
    dispose() {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
    },
  };
}
```

- [ ] **Step 4 : Brancher dans `scene.ts`**

Dans `web/src/render/scene.ts` :

1. Import : `import { attachZoom } from "../controls/zoom";`
2. Remplacer les deux lignes
   ```ts
     controls.zoomSpeed = 0.8;
     // zoomToCursor déplace la cible d'OrbitControls (spec 4 : zoom vers le curseur à réimplémenter en gardant la cible au centre).
   ```
   par
   ```ts
     // Zoom maison sur l'altitude, ancré sous le curseur (spec navigation §4) ; la cible reste à l'origine.
     controls.enableZoom = false;
   ```
3. Après `const applyPixelRatio = …`, ajouter :
   ```ts
     const zoom = attachZoom(canvas, camera, {
       requestRender: () => {
         dirty = true;
       },
       aMin: MIN_DISTANCE - 1,
       aMax: MAX_DISTANCE - 1,
     });
   ```
4. Dans `loop`, remplacer `const moved = controls.update();` par
   ```ts
         const zoomed = zoom.beforeUpdate();
         const moved = controls.update() || zoomed;
   ```
   (`controls.update()` doit toujours être appelé : il relit la position posée par le zoom et applique l'inertie de rotation.)

- [ ] **Step 5 : Vérifier**

Run : `npm --prefix web run test` · Expected : tous verts (91 + nouveaux).
Run : `npm --prefix web run typecheck` · Expected : aucune erreur.
Run : `npm --prefix web run build` · Expected : build OK.

Vérification rapide à l'œil (obligatoire ici, le reste en T9) : `npm --prefix web run dev`, ouvrir `http://localhost:5173`, molette sur la Bretagne → la Bretagne reste sous le curseur ; le zoom s'arrête net à `d = 1,042` et `d = 4` ; rotation à la souris intacte.

- [ ] **Step 6 : Commit**

```bash
git add web/src/controls/zoom.ts web/src/render/scene.ts web/tests/zoom.test.ts
git commit -m "feat(web): zoom ancré sous le curseur et pincement sur l'altitude (dette n° 23)"
```

---

### Task 4 : Pixels de la heatmap (`data/pixels.ts`, `data/loader.ts`)

**Files:**
- Create: `web/src/data/pixels.ts`
- Modify: `web/src/data/loader.ts:11-19` (`LoaderDeps`, `LoadedData`), `:63-79` (`browserDeps`), `:108-118` (`refresh`)
- Test: `web/tests/pixels.test.ts`, `web/tests/loader.test.ts:24-32` (helper `deps`)

**Interfaces:**
- Produces:
  - `bitmapPixels(bitmap: ImageBitmap): Uint8ClampedArray | null` — RGBA nord en haut, `null` si impossible.
  - `LoaderDeps.bitmapPixels: (bitmap: ImageBitmap) => Uint8ClampedArray | null`.
  - `LoadedData.pixels: Uint8ClampedArray | null`.

- [ ] **Step 1 : Écrire les tests**

```ts
// web/tests/pixels.test.ts
import { describe, expect, it } from "vitest";
import { bitmapPixels } from "../src/data/pixels";

describe("bitmapPixels", () => {
  it("sans canvas (environnement Node) renvoie null sans lever", () => {
    const fake = { width: 4, height: 3, close() {} } as unknown as ImageBitmap;
    expect(bitmapPixels(fake)).toBeNull();
  });
});
```

Dans `web/tests/loader.test.ts`, étendre le helper `deps` et ajouter deux tests :

```ts
function deps(json: unknown, bitmap: ImageBitmap = fakeBitmap(), pixels: (b: ImageBitmap) => Uint8ClampedArray | null = () => new Uint8ClampedArray(4)): LoaderDeps & {
  fetchJson: ReturnType<typeof vi.fn>;
  fetchBitmap: ReturnType<typeof vi.fn>;
} {
  return {
    fetchJson: vi.fn(async () => JSON.parse(JSON.stringify(json))),
    fetchBitmap: vi.fn(async () => bitmap),
    bitmapPixels: pixels,
  };
}

describe("DataLoader.refresh — pixels", () => {
  it("expose les pixels lus par bitmapPixels", async () => {
    const px = new Uint8ClampedArray([1, 2, 3, 4]);
    const loader = new DataLoader(BASE, deps(SAMPLE, fakeBitmap(), () => px));
    const d = await loader.refresh();
    expect(d?.pixels).toBe(px);
  });
  it("bitmapPixels qui lève → pixels null, texture valide", async () => {
    const loader = new DataLoader(BASE, deps(SAMPLE, fakeBitmap(), () => { throw new Error("boom"); }));
    const d = await loader.refresh();
    expect(d?.pixels).toBeNull();
    expect(d?.texture).toBeInstanceOf(THREE.Texture);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm --prefix web run test -- tests/pixels.test.ts tests/loader.test.ts` · Expected : FAIL (module `pixels` introuvable ; `bitmapPixels` inconnu dans `LoaderDeps` au typecheck).

- [ ] **Step 3 : Implémenter**

```ts
// web/src/data/pixels.ts
/**
 * Lecture CPU de la heatmap (spec navigation §5) : l'ImageBitmap est créé `flipY` (sud en
 * ligne 0) ; le dessin re-retourne pour livrer des lignes nord en haut, comme le PNG du
 * pipeline. Un seul canvas réutilisé ; ≈ 4 Mo par rafraîchissement.
 */
type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

let canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let ctx: Ctx2D | null = null;

function context(width: number, height: number): Ctx2D | null {
  if (canvas && canvas.width === width && canvas.height === height) return ctx;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(width, height);
  } else {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
  }
  ctx = (canvas.getContext("2d", { willReadFrequently: true }) as Ctx2D | null) ?? null;
  return ctx;
}

/** RGBA, `width × height × 4`, nord en haut. `null` si aucun contexte 2D ou lecture impossible. */
export function bitmapPixels(bitmap: ImageBitmap): Uint8ClampedArray | null {
  try {
    const { width, height } = bitmap;
    const c = context(width, height);
    if (!c) return null;
    c.save();
    c.scale(1, -1);
    c.drawImage(bitmap, 0, -height);
    c.restore();
    return c.getImageData(0, 0, width, height).data;
  } catch (e) {
    console.warn("[worldtemp] lecture des pixels de la heatmap impossible :", e);
    return null;
  }
}
```

Dans `web/src/data/loader.ts` :

```ts
import { bitmapPixels } from "./pixels";

export interface LoaderDeps {
  fetchJson(url: string): Promise<unknown>;
  fetchBitmap(url: string): Promise<ImageBitmap>;
  /** Lecture CPU des pixels (tooltip). `null` = tooltip indisponible, rendu inchangé. */
  bitmapPixels(bitmap: ImageBitmap): Uint8ClampedArray | null;
}

export interface LoadedData {
  meta: LatestMetadata;
  texture: THREE.Texture;
  pixels: Uint8ClampedArray | null;
}
```

`browserDeps` gagne `bitmapPixels,` (référence directe à la fonction importée). Dans `refresh()`, remplacer

```ts
      const texture = bitmapToTexture(bitmap, meta);
      const previous = this.current;
      this.current = { meta, texture };
```

par

```ts
      const texture = bitmapToTexture(bitmap, meta);
      let pixels: Uint8ClampedArray | null = null;
      try {
        pixels = this.deps.bitmapPixels(bitmap);
      } catch (e) {
        console.warn("[worldtemp] lecture des pixels de la heatmap impossible :", e);
      }
      const previous = this.current;
      this.current = { meta, texture, pixels };
```

(les pixels sont lus **avant** que le bitmap précédent soit fermé et avant tout `dispose`, sur le bitmap courant qui reste ouvert pour le GPU).

- [ ] **Step 4 : Vérifier**

Run : `npm --prefix web run test` · Expected : tous verts.
Run : `npm --prefix web run typecheck` · Expected : aucune erreur (`tests/loader.test.ts` compile avec le nouveau champ).

- [ ] **Step 5 : Commit**

```bash
git add web/src/data/pixels.ts web/src/data/loader.ts web/tests/pixels.test.ts web/tests/loader.test.ts
git commit -m "feat(web): lecture CPU des pixels de la heatmap (bitmapPixels, LoadedData.pixels)"
```

---

### Task 5 : `sampleTemperature` et `formatTemperature`

**Files:**
- Modify: `web/src/data/sampling.ts`, `web/src/ui/format.ts`
- Test: `web/tests/sampling.test.ts`, `web/tests/format.test.ts`

**Interfaces:**
- Consumes: `Grid`, `Encoding` de `web/src/data/metadata.ts`.
- Produces:
  - `sampleTemperature(pixels: Uint8ClampedArray, grid: Pick<Grid, "width" | "height">, encoding: Pick<Encoding, "min_c" | "max_c">, lon: number, lat: number): number` (°C).
  - `formatTemperature(celsius: number): string` — « 23,4 °C », « −3,0 °C », jamais « −0,0 ».

- [ ] **Step 1 : Écrire les tests**

Ajouter à `web/tests/sampling.test.ts` :

```ts
import { sampleTemperature } from "../src/data/sampling";

/** Grille 4×3 (lon −180, −90, 0, 90 ; lat 90, 0, −90), canal R = valeur, nord en haut. */
function pixels4x3(values: number[][]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(4 * 3 * 4);
  values.forEach((row, y) => row.forEach((v, x) => { px[(y * 4 + x) * 4] = v; px[(y * 4 + x) * 4 + 3] = 255; }));
  return px;
}
const G = { width: 4, height: 3 };
const E = { min_c: -90, max_c: 60 }; // pas de 150 °C sur 255 niveaux
const px = pixels4x3([
  [0, 51, 102, 153],
  [204, 255, 0, 51],
  [102, 153, 204, 255],
]);
const toC = (v: number) => E.min_c + (v / 255) * (E.max_c - E.min_c);

describe("sampleTemperature — spec navigation §5", () => {
  it("centre de cellule exact : lon -180, lat 90 → pixel (0,0) ; lon -90, lat 0 → (1,1)", () => {
    expect(sampleTemperature(px, G, E, -180, 90)).toBeCloseTo(toC(0), 9);
    expect(sampleTemperature(px, G, E, -90, 0)).toBeCloseTo(toC(255), 9);
  });
  it("ligne 0 = nord (lat 90), dernière ligne = sud", () => {
    expect(sampleTemperature(px, G, E, 0, 90)).toBeCloseTo(toC(102), 9);
    expect(sampleTemperature(px, G, E, 0, -90)).toBeCloseTo(toC(204), 9);
  });
  it("milieu de deux cellules = moyenne", () => {
    expect(sampleTemperature(px, G, E, -135, 90)).toBeCloseTo(toC(25.5), 9);
    expect(sampleTemperature(px, G, E, -180, 45)).toBeCloseTo(toC(102), 9);
  });
  it("bouclage : lon 135 interpole la dernière colonne avec la première", () => {
    expect(sampleTemperature(px, G, E, 135, 90)).toBeCloseTo(toC((153 + 0) / 2), 9);
    expect(sampleTemperature(px, G, E, 180, 90)).toBeCloseTo(toC(0), 9);
    expect(sampleTemperature(px, G, E, -270, 90)).toBeCloseTo(toC(153), 9); // −270 ≡ 90 → colonne 3
  });
  it("latitudes hors bornes sont bornées aux pôles", () => {
    expect(sampleTemperature(px, G, E, -180, 95)).toBeCloseTo(toC(0), 9);
    expect(sampleTemperature(px, G, E, -180, -95)).toBeCloseTo(toC(102), 9);
  });
  it("encodage : 0 → min_c, 255 → max_c", () => {
    expect(sampleTemperature(px, G, E, -180, 90)).toBeCloseTo(-90, 9);
    expect(sampleTemperature(px, G, E, -90, 0)).toBeCloseTo(60, 9);
  });
});
```

Ajouter à `web/tests/format.test.ts` :

```ts
import { formatTemperature } from "../src/ui/format";

describe("formatTemperature", () => {
  it("une décimale, virgule, signe moins typographique", () => {
    expect(formatTemperature(23.44)).toBe("23,4 °C");
    expect(formatTemperature(-3)).toBe("−3,0 °C");
    expect(formatTemperature(0)).toBe("0,0 °C");
  });
  it("jamais « −0,0 »", () => {
    expect(formatTemperature(-0.04)).toBe("0,0 °C");
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm --prefix web run test -- tests/sampling.test.ts tests/format.test.ts` · Expected : FAIL, fonctions non exportées.

- [ ] **Step 3 : Implémenter**

Ajouter à `web/src/data/sampling.ts` (l'import devient `import type { Encoding, Grid } from "./metadata";`) :

```ts
/**
 * Température (°C) au point (lon, lat), bilinéaire sur le canal R de `pixels` (RGBA, nord en
 * haut, `data/pixels.ts`). Mêmes coordonnées cellulaires que `heatmapUv` : lon −180 est le
 * centre de la colonne 0, lat 90 le centre de la ligne 0 ; bouclage en longitude, latitude bornée.
 */
export function sampleTemperature(
  pixels: Uint8ClampedArray,
  grid: Pick<Grid, "width" | "height">,
  encoding: Pick<Encoding, "min_c" | "max_c">,
  lon: number,
  lat: number,
): number {
  const W = grid.width;
  const H = grid.height;
  const toC = (t: number) => encoding.min_c + (t / 255) * (encoding.max_c - encoding.min_c);
  const at = (col: number, row: number) => pixels[(row * W + col) * 4] ?? 0;
  let x = ((lon + 180) / 360) * W;
  x = ((x % W) + W) % W;
  const x0 = Math.floor(x);
  const x1 = (x0 + 1) % W;
  const fx = x - x0;
  if (H < 2) return toC(at(x0, 0) * (1 - fx) + at(x1, 0) * fx); // hors contrat (721 lignes), garde d'index
  const y = Math.min(H - 1, Math.max(0, ((90 - lat) / 180) * (H - 1)));
  const y0 = Math.min(H - 2, Math.floor(y));
  const y1 = y0 + 1;
  const fy = y - y0;
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return toC(top * (1 - fy) + bottom * fy);
}
```

Ajouter à `web/src/ui/format.ts` :

```ts
/** « 23,4 °C » (spec navigation §6) : une décimale, virgule, signe « − » U+2212, jamais « −0,0 ». */
export function formatTemperature(celsius: number): string {
  let s = celsius.toFixed(1);
  if (s === "-0.0") s = "0.0";
  return `${s.replace("-", "−").replace(".", ",")} °C`;
}
```

- [ ] **Step 4 : Vérifier**

Run : `npm --prefix web run test` · Expected : tous verts.
Run : `npm --prefix web run typecheck` · Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add web/src/data/sampling.ts web/src/ui/format.ts web/tests/sampling.test.ts web/tests/format.test.ts
git commit -m "feat(web): sampleTemperature bilinéaire et formatTemperature"
```

---

### Task 6 : Tooltip (`ui/tooltip.ts`, DOM, CSS)

**Files:**
- Create: `web/src/ui/tooltip.ts`
- Modify: `web/src/ui/overlay.ts:14-18` (exporter `byId`), `web/index.html` (après `#overlay`), `web/src/style.css` (fin)
- Test: `web/tests/tooltip.test.ts`

**Interfaces:**
- Consumes: `projectToScreen` (Task 1), `sampleTemperature` (Task 5), `formatTemperature` (Task 5), `lonLatToVec3` (`tiles/patch.ts`), `byId` (`ui/overlay.ts`).
- Produces:
  - `interface Reading { lon: number; lat: number }`.
  - `interface TooltipData { pixels: Uint8ClampedArray; grid: Pick<Grid, "width" | "height">; encoding: Pick<Encoding, "min_c" | "max_c"> }`.
  - `class TapDetector { constructor(maxMovePx = 8, maxMs = 300); feed(e: { type: "down" | "move" | "up" | "cancel"; id: number; x: number; y: number; t: number }): { x: number; y: number } | null; reset(): void }`.
  - `placeTooltip(point: { x: number; y: number }, tip: { w: number; h: number }, viewport: { w: number; h: number }, offset = 14, topGuard = 48): { left: number; top: number }`.
  - `interface Tooltip { setReading(r: Reading | null, mode: "hover" | "pin"): void; setData(d: TooltipData | null): void; update(camera: THREE.PerspectiveCamera, width: number, height: number): void; hitMarker(x: number, y: number, radiusPx?: number): boolean }`.
  - `createTooltip(): Tooltip`.

- [ ] **Step 1 : Écrire les tests (logique pure seulement)**

```ts
// web/tests/tooltip.test.ts
import { describe, expect, it } from "vitest";
import { TapDetector, placeTooltip } from "../src/ui/tooltip";

describe("TapDetector — spec navigation §6", () => {
  it("tap valide : down puis up < 300 ms, < 8 px → position du down", () => {
    const d = new TapDetector();
    expect(d.feed({ type: "down", id: 1, x: 100, y: 100, t: 0 })).toBeNull();
    expect(d.feed({ type: "move", id: 1, x: 103, y: 102, t: 50 })).toBeNull();
    expect(d.feed({ type: "up", id: 1, x: 103, y: 102, t: 120 })).toEqual({ x: 100, y: 100 });
  });
  it("glisser > 8 px → pas de tap", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    d.feed({ type: "move", id: 1, x: 10, y: 0, t: 50 });
    expect(d.feed({ type: "up", id: 1, x: 10, y: 0, t: 100 })).toBeNull();
  });
  it("durée ≥ 300 ms → pas de tap", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    expect(d.feed({ type: "up", id: 1, x: 0, y: 0, t: 300 })).toBeNull();
  });
  it("second doigt pendant le geste → pas de tap, même après son retrait", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    d.feed({ type: "down", id: 2, x: 50, y: 50, t: 10 });
    d.feed({ type: "up", id: 2, x: 50, y: 50, t: 20 });
    expect(d.feed({ type: "up", id: 1, x: 0, y: 0, t: 30 })).toBeNull();
  });
  it("cancel réinitialise", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    d.feed({ type: "cancel", id: 1, x: 0, y: 0, t: 10 });
    expect(d.feed({ type: "up", id: 1, x: 0, y: 0, t: 20 })).toBeNull();
    d.feed({ type: "down", id: 1, x: 5, y: 5, t: 100 });
    expect(d.feed({ type: "up", id: 1, x: 5, y: 5, t: 150 })).toEqual({ x: 5, y: 5 });
  });
  it("le geste suivant repart de zéro après un tap", () => {
    const d = new TapDetector();
    d.feed({ type: "down", id: 1, x: 0, y: 0, t: 0 });
    d.feed({ type: "up", id: 1, x: 0, y: 0, t: 10 });
    d.feed({ type: "down", id: 2, x: 9, y: 9, t: 500 });
    expect(d.feed({ type: "up", id: 2, x: 9, y: 9, t: 510 })).toEqual({ x: 9, y: 9 });
  });
});

describe("placeTooltip", () => {
  const tip = { w: 80, h: 30 };
  const vp = { w: 1000, h: 800 };
  it("au-dessus du point, centré, décalage 14 px", () => {
    expect(placeTooltip({ x: 500, y: 400 }, tip, vp)).toEqual({ left: 460, top: 356 });
  });
  it("en dessous si le point est à moins de 48 px du haut", () => {
    expect(placeTooltip({ x: 500, y: 40 }, tip, vp)).toEqual({ left: 460, top: 54 });
  });
  it("borné horizontalement dans le viewport (marge 4 px)", () => {
    expect(placeTooltip({ x: 10, y: 400 }, tip, vp).left).toBe(4);
    expect(placeTooltip({ x: 995, y: 400 }, tip, vp).left).toBe(1000 - 80 - 4);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm --prefix web run test -- tests/tooltip.test.ts` · Expected : FAIL, module introuvable.

- [ ] **Step 3 : Exporter `byId`**

Dans `web/src/ui/overlay.ts`, remplacer `function byId<T extends HTMLElement>(id: string): T {` par `export function byId<T extends HTMLElement>(id: string): T {`.

- [ ] **Step 4 : Implémenter `tooltip.ts`**

```ts
// web/src/ui/tooltip.ts
/**
 * Tooltip de température (spec navigation §6) : une « lecture » = un point ancré sur le globe,
 * projetée à chaque rendu. Entrée souris (hover) ou tap (pin) ; même code de rendu.
 */
import * as THREE from "three";
import type { Encoding, Grid } from "../data/metadata";
import { sampleTemperature } from "../data/sampling";
import { projectToScreen } from "../render/pick";
import { lonLatToVec3 } from "../tiles/patch";
import { formatTemperature } from "./format";
import { byId } from "./overlay";

export interface Reading {
  lon: number;
  lat: number;
}

export interface TooltipData {
  pixels: Uint8ClampedArray;
  grid: Pick<Grid, "width" | "height">;
  encoding: Pick<Encoding, "min_c" | "max_c">;
}

export type TapInput = { type: "down" | "move" | "up" | "cancel"; id: number; x: number; y: number; t: number };

/** Tap = un seul pointeur, < 8 px de déplacement, < 300 ms, aucun second doigt pendant le geste. */
export class TapDetector {
  private start: { id: number; x: number; y: number; t: number } | null = null;
  private spoiled = false;
  private down = 0;

  constructor(
    private readonly maxMovePx = 8,
    private readonly maxMs = 300,
  ) {}

  /** Renvoie la position du `down` quand un `up` conclut un tap valide, sinon `null`. */
  feed(e: TapInput): { x: number; y: number } | null {
    switch (e.type) {
      case "down":
        this.down++;
        if (this.down === 1) {
          this.start = { id: e.id, x: e.x, y: e.y, t: e.t };
          this.spoiled = false;
        } else {
          this.spoiled = true;
        }
        return null;
      case "move":
        if (this.start && e.id === this.start.id && Math.hypot(e.x - this.start.x, e.y - this.start.y) > this.maxMovePx) {
          this.spoiled = true;
        }
        return null;
      case "up": {
        this.down = Math.max(0, this.down - 1);
        const s = this.start;
        if (!s || e.id !== s.id) return null;
        const ok = !this.spoiled && e.t - s.t < this.maxMs;
        this.start = null;
        if (this.down === 0) this.spoiled = false;
        return ok ? { x: s.x, y: s.y } : null;
      }
      case "cancel":
        this.reset();
        return null;
    }
  }

  reset(): void {
    this.start = null;
    this.spoiled = false;
    this.down = 0;
  }
}

/** Position du coin haut-gauche du tooltip : centré, au-dessus du point (en dessous près du bord haut). */
export function placeTooltip(
  point: { x: number; y: number },
  tip: { w: number; h: number },
  viewport: { w: number; h: number },
  offset = 14,
  topGuard = 48,
): { left: number; top: number } {
  const margin = 4;
  const left = Math.max(margin, Math.min(viewport.w - tip.w - margin, point.x - tip.w / 2));
  const top = point.y < topGuard ? point.y + offset : point.y - offset - tip.h;
  return { left, top };
}

export interface Tooltip {
  setReading(r: Reading | null, mode: "hover" | "pin"): void;
  setData(d: TooltipData | null): void;
  /** Reprojection après un rendu ou un déplacement de la souris. */
  update(camera: THREE.PerspectiveCamera, width: number, height: number): void;
  /** Vrai si (x, y) est à moins de `radiusPx` du marqueur affiché (mode pin). */
  hitMarker(x: number, y: number, radiusPx?: number): boolean;
}

const MARKER_HALF = 6;

export function createTooltip(): Tooltip {
  const tip = byId<HTMLElement>("tooltip");
  const marker = byId<HTMLElement>("marker");
  let reading: Reading | null = null;
  let mode: "hover" | "pin" = "hover";
  let data: TooltipData | null = null;
  const point = new THREE.Vector3();
  let markerScreen: { x: number; y: number } | null = null;

  const hide = () => {
    tip.hidden = true;
    marker.hidden = true;
    markerScreen = null;
  };

  const refreshText = () => {
    if (!reading || !data) return;
    tip.textContent = formatTemperature(sampleTemperature(data.pixels, data.grid, data.encoding, reading.lon, reading.lat));
  };

  return {
    setReading(r, m) {
      reading = r;
      mode = m;
      if (r) lonLatToVec3(r.lon, r.lat, point);
      else hide();
      refreshText();
    },
    setData(d) {
      data = d;
      refreshText();
    },
    update(camera, width, height) {
      if (!reading || !data) {
        hide();
        return;
      }
      const s = projectToScreen(point, camera, width, height);
      if (!s.visible) {
        hide();
        return;
      }
      tip.hidden = false;
      const { left, top } = placeTooltip({ x: s.x, y: s.y }, { w: tip.offsetWidth, h: tip.offsetHeight }, { w: width, h: height });
      tip.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
      if (mode === "pin") {
        marker.hidden = false;
        marker.style.transform = `translate(${(s.x - MARKER_HALF).toFixed(1)}px, ${(s.y - MARKER_HALF).toFixed(1)}px)`;
        markerScreen = { x: s.x, y: s.y };
      } else {
        marker.hidden = true;
        markerScreen = null;
      }
    },
    hitMarker(x, y, radiusPx = 24) {
      return markerScreen !== null && Math.hypot(x - markerScreen.x, y - markerScreen.y) < radiusPx;
    },
  };
}
```

- [ ] **Step 5 : DOM et CSS**

Dans `web/index.html`, entre `</div>` fermant `#overlay` et `<div id="fatal" …>` :

```html
    <div id="tooltip" class="panel" role="status" aria-live="polite" hidden></div>
    <div id="marker" aria-hidden="true" hidden></div>
```

À la fin de `web/src/style.css` (avant le bloc `@media`) :

```css
#tooltip {
  position: fixed;
  left: 0;
  top: 0;
  pointer-events: none;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  padding: 0.25rem 0.6rem;
  will-change: transform;
}
#marker {
  position: fixed;
  left: 0;
  top: 0;
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border-radius: 50%;
  background: #ffd166;
  border: 2px solid #fff;
  pointer-events: none;
  will-change: transform;
}
#tooltip[hidden], #marker[hidden] { display: none; }
```

- [ ] **Step 6 : Vérifier**

Run : `npm --prefix web run test` · Expected : tous verts.
Run : `npm --prefix web run typecheck` · Expected : aucune erreur.
Run : `npm --prefix web run build` · Expected : OK (`tooltip.ts` pas encore importé par `main.ts` : normal).

- [ ] **Step 7 : Commit**

```bash
git add web/src/ui/tooltip.ts web/src/ui/overlay.ts web/index.html web/src/style.css web/tests/tooltip.test.ts
git commit -m "feat(web): composant tooltip (TapDetector, placement, marqueur)"
```

---

### Task 7 : Branchement du tooltip dans `main.ts`

**Files:**
- Modify: `web/src/main.ts` (imports, après la création du globe, `onViewChange`, `applyData`, `webglcontextlost`)

**Interfaces:**
- Consumes: `createTooltip`, `TapDetector`, `Reading` (Task 6) ; `pickSphere`, `vec3ToLonLat`, `ndcFromCanvas` (Task 1) ; `LoadedData.pixels` (Task 4).

- [ ] **Step 1 : Imports**

```ts
import { ndcFromCanvas, pickSphere, vec3ToLonLat } from "./render/pick";
import { TapDetector, createTooltip, type Reading } from "./ui/tooltip";
```

- [ ] **Step 2 : Créer le tooltip et brancher les entrées**

Juste après `sceneHandle.scene.add(globe.group);` :

```ts
  const tooltip = createTooltip();
  const tap = new TapDetector();

  const canvasPoint = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };
  const readingAt = (x: number, y: number, w: number, h: number): Reading | null => {
    const ndc = ndcFromCanvas(x, y, w, h);
    const p = pickSphere(ndc.x, ndc.y, sceneHandle.camera);
    return p ? vec3ToLonLat(p) : null;
  };
  const tapInput = (type: "down" | "move" | "up" | "cancel", e: PointerEvent) => {
    const c = canvasPoint(e);
    const hit = tap.feed({ type, id: e.pointerId, x: c.x, y: c.y, t: e.timeStamp });
    if (!hit) return;
    tooltip.setReading(tooltip.hitMarker(hit.x, hit.y) ? null : readingAt(hit.x, hit.y, c.w, c.h), "pin");
    tooltip.update(sceneHandle.camera, c.w, c.h);
  };

  // Crochet de validation (T9, critère 1) : lecture lon/lat sous un pixel depuis la console, dev seulement.
  if (import.meta.env.DEV) {
    (window as unknown as { __worldtemp: unknown }).__worldtemp = { readingAt, camera: sceneHandle.camera };
  }

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") {
      tapInput("move", e);
      return;
    }
    const c = canvasPoint(e);
    tooltip.setReading(readingAt(c.x, c.y, c.w, c.h), "hover");
    tooltip.update(sceneHandle.camera, c.w, c.h);
  });
  canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "touch") tooltip.setReading(null, "hover");
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") tapInput("down", e);
  });
  canvas.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch") tapInput("up", e);
  });
  canvas.addEventListener("pointercancel", (e) => {
    if (e.pointerType === "touch") tapInput("cancel", e);
  });
```

Remplacer

```ts
  sceneHandle.onViewChange((view) => {
    globe.update(view);
  });
```

par

```ts
  sceneHandle.onViewChange((view) => {
    globe.update(view);
    tooltip.update(sceneHandle.camera, canvas.clientWidth, canvas.clientHeight);
  });
```

- [ ] **Step 3 : Données**

Dans `applyData`, après `globe.setHeatmap(fresh.texture, grid.width, grid.height);` :

```ts
        tooltip.setData(fresh.pixels ? { pixels: fresh.pixels, grid, encoding } : null);
```

Dans le gestionnaire `webglcontextlost`, avant `ui.showFatal(...)` : `tooltip.setReading(null, "hover");`. Comme `tooltip` est déclaré après ce gestionnaire, déplacer la création `const tooltip = createTooltip();` **avant** `canvas.addEventListener("webglcontextlost", …)` (juste après `const profile = TIER_PROFILE[decision.tier];`) ; le reste du branchement (Step 2) reste après `scene.add`.

- [ ] **Step 4 : Vérifier**

Run : `npm --prefix web run typecheck` · Expected : aucune erreur.
Run : `npm --prefix web run test` · Expected : tous verts.
Run : `npm --prefix web run build` · Expected : OK.

À l'œil (`npm --prefix web run dev`, `http://localhost:5173`) : survol → « xx,x °C » au-dessus du curseur, suit la souris, disparaît hors globe et sur les panneaux ; tourner le globe avec le tooltip affiché → il suit le point puis disparaît derrière l'horizon. Chrome DevTools → mode appareil (touch) : tap pose le marqueur + valeur, tap sur le marqueur le retire, glisser ne pose rien.

- [ ] **Step 5 : Commit**

```bash
git add web/src/main.ts
git commit -m "feat(web): tooltip de température au survol et au tap"
```

---

### Task 8 : Fondu satellite → carte resserré (`tiles/lod.ts`)

**Files:**
- Modify: `web/src/tiles/lod.ts:66-71`
- Test: `web/tests/tiles-lod.test.ts:63-71`

**Interfaces:**
- Produces: `MAP_FADE_START = 1.2`, `MAP_FADE_END = 1.14` exportés ; `mapStyleFor` inchangé en signature.

- [ ] **Step 1 : Mettre à jour le test**

Remplacer le bloc `describe("mapStyleFor", …)` par :

```ts
import { MAP_FADE_END, MAP_FADE_START } from "../src/tiles/lod";

describe("mapStyleFor", () => {
  it("0 loin, 1 près, linéaire entre MAP_FADE_START (1,20) et MAP_FADE_END (1,14)", () => {
    expect(MAP_FADE_START).toBe(1.2);
    expect(MAP_FADE_END).toBe(1.14);
    expect(mapStyleFor(3)).toBe(0);
    expect(mapStyleFor(MAP_FADE_START)).toBe(0);
    expect(mapStyleFor(MAP_FADE_END)).toBe(1);
    expect(mapStyleFor(1.042)).toBe(1);
    expect(mapStyleFor(1.17)).toBeCloseTo(0.5, 6);
  });
});
```

(fusionner l'import avec la ligne 4 existante plutôt que d'ajouter un second `import` du même module.)

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm --prefix web run test -- tests/tiles-lod.test.ts` · Expected : FAIL (`MAP_FADE_START` non exporté).

- [ ] **Step 3 : Implémenter**

Remplacer la fonction `mapStyleFor` dans `web/src/tiles/lod.ts` par :

```ts
/** Fondu satellite → carte (spec navigation §7) : 0 au-delà de MAP_FADE_START, 1 sous MAP_FADE_END. */
export const MAP_FADE_START = 1.2;
export const MAP_FADE_END = 1.14;

export function mapStyleFor(distance: number): number {
  // Dénominateur dérivé des deux bornes (pas un littéral) pour que la borne basse retombe
  // exactement sur 1 en double précision IEEE-754.
  return Math.min(1, Math.max(0, (MAP_FADE_START - distance) / (MAP_FADE_START - MAP_FADE_END)));
}
```

- [ ] **Step 4 : Vérifier**

Run : `npm --prefix web run test` · Expected : tous verts.

- [ ] **Step 5 : Commit**

```bash
git add web/src/tiles/lod.ts web/tests/tiles-lod.test.ts
git commit -m "feat(web): fondu satellite → carte resserré (1,20 → 1,14)"
```

---

### Task 9 : Validation manuelle et réglage (DevTools MCP + téléphone)

**Files:**
- Create: `.superpowers/sdd/2026-09-06-navigation/validation-report.md` (dossier git-ignoré, comme pour la spec 3)
- Modify éventuellement : `web/src/tiles/lod.ts` (bornes du fondu), `web/src/controls/zoom.ts` (`WHEEL_BASE`, `SMOOTHING`), la spec §4/§7 si une valeur change.

- [ ] **Step 1 : Lancer le serveur de dev**

Run : `npm --prefix web run dev` (port 5173 imposé, seul autorisé par le CORS du bucket). Ouvrir `http://localhost:5173` via le MCP Chrome DevTools (`new_page`).

- [ ] **Step 2 : Critère 1 — zoom ancré**

Ouvrir `http://localhost:5173/?lon=-1.62&lat=49.64&d=3` (Cherbourg au centre). Via `evaluate_script` : choisir le pixel `P = (cx + 150, cy − 100)` (`cx`, `cy` = centre du canvas), lire `before = __worldtemp.readingAt(P.x, P.y, w, h)`, puis dispatcher 40 événements `new WheelEvent("wheel", { deltaY: -100, clientX: P.x, clientY: P.y, bubbles: true, cancelable: true })` sur `#globe` espacés de 60 ms (`setTimeout` en chaîne). Attendre 1 s (lissage convergé), lire `after = __worldtemp.readingAt(P.x, P.y, w, h)`. Convertir l'écart en px à l'échelle finale : `d = 1,042` ⇒ 2° de large sur la hauteur du canvas ⇒ `px = |Δlat| / 2 · h` et `px = |Δlon| · cos(lat) / 2 · h`. Critère : < **2 px**. Noter les valeurs.

- [ ] **Step 3 : Critère 2 — sensation uniforme**

Compter les crans du zoom max au zoom min : 35 ± 3. À `d` ≈ 3, 1,5, 1,1, mesurer la largeur apparente d'un même repère (ex. la Corse) avant/après 3 crans : les trois rapports doivent tenir dans un facteur 1,5.

- [ ] **Step 4 : Critères 4, 6, 8**

- Tooltip : 3 points (Sahara, Groenland, Amazonie) : valeur affichée vs `sampleTemperature` calculé en console sur `latest.png` (charger le PNG dans un canvas, lire le pixel) — ±0,5 °C.
- Fondu : capture à `d = 1,20` (satellite pur) et `d = 1,14` (carte pure) via `?lon=2&lat=47&d=…`. Si le style carte paraît encore mou, resserrer (`MAP_FADE_END = 1.16`) et reporter dans la spec §7 + test.
- Rendu à la demande : DevTools → Rendering → « Frame Rendering Stats » : globe et souris immobiles → 0 fps.

- [ ] **Step 5 : Critères 3 et 5 — téléphone (utilisateur)**

Déployer sur une URL de test n'est pas prévu : l'utilisateur teste **après merge et déploiement** (T10) sur https://globelayers.com. Consigner dans le rapport que ces deux critères sont « à valider par l'utilisateur après déploiement », puis mettre HISTORY à jour avec le verdict quand il arrive (comme pour le critère 6 de la spec 3).

- [ ] **Step 6 : Rapport et commit d'éventuels réglages**

Écrire `validation-report.md` (critères, valeurs mesurées, captures nommées). Si une constante a changé : mettre à jour spec + test, `npm --prefix web run test`, puis :

```bash
git add web/src docs/superpowers/specs/2026-09-06-navigation-design.md web/tests
git commit -m "feat(web): réglage du fondu/zoom après validation à l'œil"
```

---

### Task 10 : HISTORY, merge, déploiement

**Files:**
- Modify: `HISTORY.md` (§3 structure : `controls/`, `pick.ts`, `pixels.ts`, `tooltip.ts` ; §5 décisions : dolly sur l'altitude, picking analytique, lecture CPU des pixels ; §6 problème : OrbitControls multiplie `d` ; §7 chronologie : plan 4 ; §8 dette 23 ✅ résolue, nouvelles dettes éventuelles ; §9 nouvelle entrée en tête)

- [ ] **Step 1 : Mettre HISTORY à jour**

Invoquer le skill `updating-history` (il dérive les sections du diff `master..feat/navigation`). Vérifier : `python tools/history_check.py` · Expected : ✓.

- [ ] **Step 2 : Vérification complète**

Run : `npm --prefix web run test` · Expected : tous verts.
Run : `npm --prefix web run typecheck` · Expected : aucune erreur.
Run : `npm --prefix web run build` · Expected : OK ; noter la taille de `dist/assets/index-*.js` dans HISTORY §9.
Run : `.venv/Scripts/python -m pytest -q` · Expected : 127 passed, 5 skipped (inchangé).

- [ ] **Step 3 : Commit HISTORY**

```bash
git add HISTORY.md
git commit -m "docs(history): spec 4 lot A — zoom ancré, pincement, tooltip, fondu"
```

- [ ] **Step 4 : Merge et déploiement**

Invoquer `superpowers:finishing-a-development-branch` : merge local `feat/navigation` → `master` (pas de PR, repo solo), `git push origin master`, suivre le run `test.yml` (jobs `test`, `web`, `deploy`) via `gh run watch` ; vérifier https://globelayers.com (molette ancrée, tooltip). Demander à l'utilisateur la validation téléphone (critères 3 et 5), puis consigner le verdict dans HISTORY §9 et fermer la dette 23 définitivement.
