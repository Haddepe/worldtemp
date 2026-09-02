import * as THREE from "three";
import { DATA_BASE_URL, REFRESH_MS } from "./config";
import { DataLoader } from "./data/loader";
import { PIXEL_RATIO_CAP, detectTier } from "./gpu/tier";
import { STOPS, buildLut, createLutTexture } from "./render/colormap";
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

  const opacity = document.getElementById("opacity") as HTMLInputElement | null;
  opacity?.addEventListener("input", () => {
    globe.setOpacity(Number(opacity.value));
    sceneHandle.requestRender();
  });
}

boot().catch((e: unknown) => {
  console.error(e);
  fatal("Le globe n'a pas pu démarrer. Rechargez la page.");
});
