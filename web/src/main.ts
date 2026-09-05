import * as THREE from "three";
import { DATA_BASE_URL, REFRESH_MS, STALE_AFTER_MS, TILES_BASE_URL } from "./config";
import { DataLoader, isStale } from "./data/loader";
import { PIXEL_RATIO_CAP, detectTier } from "./gpu/tier";
import { STOPS, buildLut, createLutTexture } from "./render/colormap";
import { TIER_PROFILE, createTiledGlobe } from "./render/globe";
import { createScene } from "./render/scene";
import { TileIndex } from "./tiles/index";
import { TileLoader } from "./tiles/loader";
import { type TilesManifest, parseManifest } from "./tiles/manifest";
import { formatBanner } from "./ui/format";
import { createOverlay } from "./ui/overlay";

/** Manifeste vide : aucune tuile demandée (mode repli, spec tuiles §8). */
const NO_TILES: TilesManifest = { schemaVersion: 1, tileSize: 512, sat: { ext: "jpg", maxLevel: -1 }, map: { ext: "png", maxLevel: -1, index: "" } };

async function fetchTiles(): Promise<{ manifest: TilesManifest; index: TileIndex }> {
  const m = await fetch(`${TILES_BASE_URL}/manifest.json`, { cache: "no-cache" });
  if (!m.ok) throw new Error(`HTTP ${m.status} sur manifest.json`);
  const manifest = parseManifest(await m.json());
  const i = await fetch(`${TILES_BASE_URL}/${manifest.map.index}`);
  if (!i.ok) throw new Error(`HTTP ${i.status} sur ${manifest.map.index}`);
  return { manifest, index: TileIndex.parse(await i.arrayBuffer()) };
}

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
  const profile = TIER_PROFILE[decision.tier];

  canvas.addEventListener("webglcontextlost", (ev) => {
    ev.preventDefault();
    ui.showFatal("Le rendu 3D a été interrompu par le navigateur. Rechargez la page.", { reload: true });
  });

  const params = new URLSearchParams(location.search);
  const lon = Number(params.get("lon"));
  const lat = Number(params.get("lat"));
  const d = Number(params.get("d"));
  if (Number.isFinite(lon) && Number.isFinite(lat) && params.has("lon") && params.has("lat")) {
    sceneHandle.setInitialView(lon, lat, Number.isFinite(d) && params.has("d") ? d : 1.3);
  }

  const loader = new TileLoader({
    baseUrl: TILES_BASE_URL,
    manifest: NO_TILES,
    index: null,
    budgetBytes: profile.budgetBytes,
    concurrency: profile.concurrency,
    anisotropy: sceneHandle.renderer.capabilities.getMaxAnisotropy(),
    onLoad: () => sceneHandle.requestRender(),
  });
  const globe = createTiledGlobe(decision.tier, loader, 0);
  globe.setFilter(ui.initialFilter());
  ui.setLegendVisible(ui.initialFilter());
  ui.onFilter((on) => {
    globe.setFilter(on);
    ui.setLegendVisible(on);
    sceneHandle.requestRender();
  });
  sceneHandle.scene.add(globe.group);
  sceneHandle.onViewChange((view) => {
    globe.update(view);
  });

  let tilesReady = false;
  let fallback: THREE.Texture | null = null;
  const loadTiles = async () => {
    try {
      const { manifest, index } = await fetchTiles();
      loader.configure(manifest, index);
      globe.setMaxLevel(Math.min(profile.maxLevel, manifest.map.maxLevel));
      globe.setFallbackSat(null);
      fallback?.dispose();
      fallback = null;
      tilesReady = true;
      console.info(`[worldtemp] tuiles : map ≤ ${manifest.map.maxLevel}, sat ≤ ${manifest.sat.maxLevel}`);
    } catch (e) {
      console.warn("[worldtemp] tuiles indisponibles, repli Blue Marble 4K :", e);
      if (!fallback) {
        fallback = await new THREE.TextureLoader().loadAsync("/textures/blue-marble-4k.jpg").catch(() => null);
        if (fallback) {
          fallback.colorSpace = THREE.SRGBColorSpace;
          fallback.anisotropy = sceneHandle.renderer.capabilities.getMaxAnisotropy();
          globe.setFallbackSat(fallback);
        }
      }
    }
    sceneHandle.requestRender();
  };

  sceneHandle.start();
  await loadTiles();

  const data = new DataLoader(DATA_BASE_URL);
  let lutKey = "";
  let lut: THREE.DataTexture | null = null;
  let updateFailed = false;

  const refreshBanner = () => {
    const dd = data.data;
    if (!dd) return;
    ui.setBanner(formatBanner(dd.meta, Date.now()));
    ui.setStatus(
      updateFailed
        ? "Mise à jour impossible, nouvel essai dans 15 min"
        : isStale(dd.meta, Date.now(), STALE_AFTER_MS)
          ? "Données anciennes"
          : tilesReady
            ? null
            : "Détail de la carte indisponible",
    );
  };

  const applyData = async () => {
    if (!tilesReady) await loadTiles();
    try {
      const fresh = await data.refresh();
      updateFailed = false;
      if (fresh) {
        const { encoding, grid, stats } = fresh.meta;
        const key = `${encoding.min_c}/${encoding.max_c}`;
        if (key !== lutKey) {
          lut?.dispose();
          lut = createLutTexture(buildLut(STOPS, encoding.min_c, encoding.max_c));
          globe.setLut(lut);
          lutKey = key;
        }
        ui.setLegend(encoding.min_c, encoding.max_c, stats);
        globe.setHeatmap(fresh.texture, grid.width, grid.height);
        sceneHandle.requestRender();
        console.info(`[worldtemp] données ${fresh.meta.run} f${fresh.meta.forecast_hour}, valides ${fresh.meta.valid_time_utc}`);
      }
      refreshBanner();
    } catch (e) {
      console.warn("[worldtemp] données indisponibles :", e);
      if (data.data) {
        updateFailed = true;
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
