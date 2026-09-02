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
