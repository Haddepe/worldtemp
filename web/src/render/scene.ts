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
  /** Place la caméra au-dessus d'un point (paramètres d'URL `lon`, `lat`, `d`). */
  setInitialView(lon: number, lat: number, distance: number): void;
  start(): void;
}

export const MIN_DISTANCE = 1.042; // ≈ 2° de large à l'écran (spec tuiles §5 « Caméra »)
export const MAX_DISTANCE = 4;

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
    controls.rotateSpeed = Math.min(0.5, Math.max(0.01, 0.25 * (d - 1)));
  };

  const resize = () => {
    const w = canvas.clientWidth;
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  };

  const loop = () => {
    try {
      const zoomed = zoom.beforeUpdate();
      const moved = controls.update() || zoomed;
      if (moved || dirty) {
        dirty = false;
        applyDistance();
        camera.updateMatrixWorld(true);
        // hauteur CSS, pas framebuffer : sur écran 2× on reste un niveau plus grossier, choix de budget (spec §5).
        const view = viewStateFrom(camera, canvas.clientHeight);
        for (const cb of viewListeners) cb(view);
        renderer.render(scene, camera);
      }
    } catch (e) {
      // Un listener de vue qui lève (ex. sélection de tuiles) ne doit jamais arrêter la boucle de rendu.
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
    setInitialView(lon, lat, distance) {
      const d = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, distance));
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
