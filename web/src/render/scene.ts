import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { attachZoom } from "../controls/zoom";
import { type ViewState, viewStateFrom } from "../tiles/lod";
import { lonLatToVec3 } from "../tiles/patch";

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Plafond du pixel ratio (tier), appliqué avec `min(devicePixelRatio, cap)`. */
  setPixelRatioCap(cap: number): void;
  /** Demande un rendu au prochain frame (texture ou uniform changé). */
  requestRender(): void;
  /** Appelé avant chaque rendu avec la vue courante (sélection des tuiles). */
  onViewChange(cb: (view: ViewState) => void): void;
  /** Callback appelé à chaque frame rAF avec l'horodatage ; renvoyer `true` demande un rendu. Renvoie la désinscription. */
  onFrame(cb: (nowMs: number) => boolean): () => void;
  /**
   * Place la caméra au-dessus d'un point (paramètres d'URL `lon`, `lat`, `d`), sans vol. `minDistance`
   * (défaut MIN_DISTANCE) devient la limite basse et borne `distance` (lot R5c : plus bas sous Forest).
   */
  setInitialView(lon: number, lat: number, distance: number, minDistance?: number): void;
  /**
   * Limite basse de la caméra (OrbitControls et zoom maison). OrbitControls y ramène la distance au
   * prochain `update()` : pour remonter sans saut, voler d'abord, poser la limite ensuite.
   */
  setMinDistance(d: number): void;
  /** Remonte l'image de `px` px CSS (négatif = descend) : globe centré dans l'espace libre sur mobile. */
  setViewShift(px: number): void;
  start(): void;
}

export const MIN_DISTANCE = 1.042; // ≈ 2° de large à l'écran (spec tuiles §5 « Caméra »)
export const MAX_DISTANCE = 4;
/** Sous Forest (lot R5c) : altitude minimale divisée par 4 (≈ 1,0105), sur-zoom au-delà du niveau 9. */
export const FOREST_MIN_DISTANCE = 1 + (MIN_DISTANCE - 1) / 4;

/**
 * Vitesse de rotation d'OrbitControls à la distance `d` : 0,25·(d−1), plafonnée à 0,5 et planchée à
 * l'altitude minimale Forest, pour garder la même vitesse à l'écran jusqu'en bas de Forest (lot R5c).
 */
export function rotateSpeedFor(d: number): number {
  return Math.min(0.5, Math.max(0.25 * (FOREST_MIN_DISTANCE - 1), 0.25 * (d - 1)));
}

/** Limite basse à poser au démarrage selon la couche initiale (`?layer=` complété par la page). */
export function initialMinDistance(layerId: string | null): number {
  return layerId === "forest" ? FOREST_MIN_DISTANCE : MIN_DISTANCE;
}

/**
 * Rendu à la demande (spec 2 §4) : la boucle rAF ne dessine que si les contrôles bougent
 * (damping compris) ou si `requestRender()` a été appelé. Lève si WebGL est indisponible.
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
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  // Zoom maison sur l'altitude, ancré sous le curseur (spec navigation §4) ; la cible reste à l'origine.
  controls.enableZoom = false;

  let dirty = true;
  let cap = 2;
  const viewListeners: Array<(view: ViewState) => void> = [];
  const frameListeners = new Set<(nowMs: number) => boolean>();

  const applyPixelRatio = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));

  const zoom = attachZoom(canvas, camera, {
    requestRender: () => {
      dirty = true;
    },
    aMin: MIN_DISTANCE - 1,
    aMax: MAX_DISTANCE - 1,
    // Pendant un pincement, `attachZoom` ancre déjà la rotation depuis le milieu des deux doigts :
    // laisser OrbitControls tourner aussi ferait un saut au premier mouvement puis une double rotation.
    onPinch: (active) => {
      controls.enableRotate = !active;
    },
  });

  /** near/far et vitesse de rotation suivent l'altitude (spec tuiles §5). */
  const applyDistance = () => {
    const d = camera.position.length();
    camera.near = Math.max(0.002, (d - 1) * 0.3);
    camera.far = d + 2;
    camera.updateProjectionMatrix();
    controls.rotateSpeed = rotateSpeedFor(d);
  };

  let shift = 0;
  const resize = () => {
    const w = canvas.clientWidth;
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Fenêtre de vue décalée vers le bas = image remontée ; toute la chaîne (pick, étiquettes,
    // tuiles, zoom ancré) lit la matrice de projection et suit sans autre changement.
    if (shift !== 0 && w > 0) camera.setViewOffset(w, h, 0, shift, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    dirty = true;
  };

  const loop = (now: number) => {
    try {
      let animated = false;
      // isolation par callback : un tick de vent qui lève ne doit pas priver la frame du rendu
      for (const cb of frameListeners) {
        try {
          if (cb(now)) animated = true;
        } catch (e) {
          console.error(e);
        }
      }
      const zoomed = zoom.beforeUpdate();
      const moved = controls.update() || zoomed;
      if (moved || dirty || animated) {
        dirty = false;
        applyDistance();
        camera.updateMatrixWorld(true);
        // hauteur CSS, pas framebuffer : sur écran 2× on reste un niveau plus grossier, choix de budget (spec §5).
        const view = viewStateFrom(camera, canvas.clientHeight);
        // isolation par callback, comme frameListeners : un écouteur de vue qui lève (ex. les
        // étiquettes) ne doit pas priver cette frame de son renderer.render (M2).
        for (const cb of viewListeners) {
          try {
            cb(view);
          } catch (e) {
            console.error(e);
          }
        }
        renderer.render(scene, camera);
      }
    } catch (e) {
      // Filet de sécurité : les écouteurs de vue et de frame sont déjà isolés un par un ; reste
      // ce qui lève autour d'eux (contrôles, rendu), qui ne doit jamais arrêter la boucle.
      console.error(e);
    } finally {
      requestAnimationFrame(loop);
    }
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
    onViewChange(cb) {
      viewListeners.push(cb);
    },
    onFrame(cb) {
      frameListeners.add(cb);
      return () => {
        frameListeners.delete(cb);
      };
    },
    setViewShift(px) {
      if (px === shift) return;
      shift = px;
      resize();
    },
    setMinDistance(d) {
      controls.minDistance = d;
      zoom.setRange(d - 1, MAX_DISTANCE - 1);
    },
    setInitialView(lon, lat, distance, minDistance = MIN_DISTANCE) {
      controls.minDistance = minDistance;
      zoom.setRange(minDistance - 1, MAX_DISTANCE - 1);
      const d = Math.min(MAX_DISTANCE, Math.max(minDistance, distance));
      camera.position.copy(lonLatToVec3(lon, lat).multiplyScalar(d));
      camera.lookAt(0, 0, 0);
      controls.update();
      dirty = true;
    },
    start() {
      applyPixelRatio();
      resize();
      applyDistance();
      requestAnimationFrame(loop);
    },
  };
}
