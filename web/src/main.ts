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
