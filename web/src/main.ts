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
