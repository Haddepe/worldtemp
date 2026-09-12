import * as THREE from "three";
import { DATA_BASE_URL, REFRESH_MS, STALE_AFTER_MS, TILES_BASE_URL } from "./config";
import { LayerLoader, ManifestLoader, isStale, type LoadedLayer } from "./data/loader";
import type { Manifest } from "./data/manifest";
import { PIXEL_RATIO_CAP, detectTier } from "./gpu/tier";
import { LayerCache } from "./layers/cache";
import { LAYERS, layerDef, type LayerDef } from "./layers/registry";
import { orderedLayers, parseLayerParam, withLayerParam } from "./layers/select";
import { buildLut, createLutTexture } from "./render/colormap";
import { TIER_PROFILE, createTiledGlobe } from "./render/globe";
import { ndcFromCanvas, pickSphere, vec3ToLonLat } from "./render/pick";
import { createScene } from "./render/scene";
import { TileIndex } from "./tiles/index";
import { TileLoader } from "./tiles/loader";
import { type TilesManifest, parseManifest } from "./tiles/manifest";
import { formatBanner } from "./ui/format";
import { createLayersMenu } from "./ui/layers-menu";
import { createOverlay } from "./ui/overlay";
import { TapDetector, createTooltip, type Reading } from "./ui/tooltip";

/** Manifeste vide : aucune tuile demandée (mode repli, spec tuiles §8). */
const NO_TILES: TilesManifest = { schemaVersion: 1, tileSize: 512, sat: { ext: "jpg", maxLevel: -1 }, map: { ext: "png", maxLevel: -1, index: "" } };

async function fetchTiles(): Promise<{ manifest: TilesManifest; index: TileIndex }> {
  const m = await fetch(`${TILES_BASE_URL}/manifest.json`, { cache: "no-cache", signal: AbortSignal.timeout(10_000) });
  if (!m.ok) throw new Error(`HTTP ${m.status} sur manifest.json`);
  const manifest = parseManifest(await m.json());
  const i = await fetch(`${TILES_BASE_URL}/${manifest.map.index}`, { signal: AbortSignal.timeout(10_000) });
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
  const tooltip = createTooltip();

  canvas.addEventListener("webglcontextlost", (ev) => {
    ev.preventDefault();
    tooltip.setReading(null, "hover");
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
  ui.setLegendVisible(false); // aucune couche au démarrage : la légende n'a rien à montrer
  sceneHandle.scene.add(globe.group);

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

  sceneHandle.onViewChange((view) => {
    globe.update(view);
    tooltip.update(sceneHandle.camera, canvas.clientWidth, canvas.clientHeight);
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

  const manifests = new ManifestLoader(DATA_BASE_URL);
  const cache = new LayerCache<LayerLoader>(2, (id) => new LayerLoader(id, DATA_BASE_URL));
  const menu = createLayersMenu(ui.controls, (id) => void activate(id, true));
  const luts = new Map<string, { key: string; lut: THREE.DataTexture }>();
  let activeId: string | null = null;
  let hadManifest = false;
  let active: LoadedLayer | null = null;
  let updateFailed = false;
  const failed = new Set<string>();

  const lutFor = (def: LayerDef, manifest: Manifest): THREE.DataTexture => {
    const enc = manifest.layers[def.id]!.encoding;
    const key = `${enc.min}/${enc.max}/${enc.scale}`;
    const cached = luts.get(def.id);
    if (cached && cached.key === key) return cached.lut;
    cached?.lut.dispose();
    const lut = createLutTexture(buildLut(def, enc));
    luts.set(def.id, { key, lut });
    return lut;
  };

  const refreshBanner = () => {
    const def = activeId ? layerDef(activeId) : undefined;
    if (!def || !active) {
      ui.setBanner("GlobeLayers");
      ui.setStatus(updateFailed ? "Mise à jour impossible, nouvel essai dans 15 min" : tilesReady ? null : "Détail de la carte indisponible");
      return;
    }
    ui.setBanner(formatBanner(active.entry, Date.now()));
    ui.setStatus(
      updateFailed
        ? "Mise à jour impossible, nouvel essai dans 15 min"
        : isStale(active.entry, Date.now(), STALE_AFTER_MS)
          ? "Données anciennes"
          : tilesReady
            ? null
            : "Détail de la carte indisponible",
    );
  };

  /** Applique la couche `id` (null = Aucune) : charge si besoin, pose texture, LUT, isolignes, légende, tooltip, URL. */
  const activate = async (id: string | null, fromUser: boolean): Promise<void> => {
    const manifest = manifests.manifest;
    const previous = activeId;
    activeId = id;
    menu.setActive(id);
    if (fromUser) history.replaceState(null, "", withLayerParam(location.search, id));
    const def = id ? layerDef(id) : undefined;
    const entry = id && manifest ? manifest.layers[id] : undefined;
    if (!def || !entry || !manifest) {
      active = null;
      globe.setLayer(null, 1440, 721);
      globe.setIsoStep(0);
      ui.setLegendVisible(false);
      tooltip.setData(null);
      sceneHandle.requestRender();
      refreshBanner();
      return;
    }
    const layerLoader = cache.get(id!);
    try {
      await layerLoader.load(entry, manifest.grid);
    } catch (e) {
      console.warn(`[worldtemp] couche ${id} indisponible :`, e);
      failed.add(id!);
      menu.setDisabled(id!, true);
      if (activeId === id) {
        ui.setStatus("Couche indisponible");
        const fallback = previous !== id && previous !== null && !failed.has(previous) ? previous : null;
        await activate(fallback, fromUser);
        refreshBanner();
      }
      return;
    }
    if (activeId !== id) return; // l'utilisateur a changé d'avis pendant le chargement
    active = layerLoader.data;
    if (!active) return;
    const enc = entry.encoding;
    globe.setLut(lutFor(def, manifest));
    globe.setLayer(active.texture, manifest.grid.width, manifest.grid.height);
    globe.setIsoStep(def.isoStep !== null ? def.isoStep / (enc.max - enc.min) : 0);
    ui.setLegend(def, enc, entry.stats);
    ui.setLegendVisible(true);
    tooltip.setData(active.pixels ? { def, pixels: active.pixels, grid: manifest.grid, encoding: enc } : null);
    sceneHandle.requestRender();
    refreshBanner();
    console.info(`[worldtemp] couche ${id} ${entry.run} f${entry.forecast_hour}, valide ${entry.valid_time_utc}`);
  };

  const applyData = async () => {
    if (!tilesReady) await loadTiles();
    try {
      const fresh = await manifests.refresh();
      updateFailed = false;
      if (fresh) {
        const defs = orderedLayers(LAYERS, fresh).filter((d) => !failed.has(d.id));
        menu.setLayers(defs);
        for (const id of failed) menu.setDisabled(id, true);
        const available = defs.map((d) => d.id);
        const firstLoad = !hadManifest;
        hadManifest = true;
        const target = firstLoad
          ? parseLayerParam(location.search, available)
          : activeId !== null && !available.includes(activeId)
            ? parseLayerParam("", available)
            : activeId;
        await activate(target, false);
      } else if (activeId && manifests.manifest) {
        await activate(activeId, false); // même manifeste : recharge seulement si generated_at a changé (LayerLoader)
      }
      refreshBanner();
    } catch (e) {
      console.warn("[worldtemp] manifeste indisponible :", e);
      updateFailed = manifests.manifest !== null;
      if (!manifests.manifest) {
        ui.setBanner("GlobeLayers");
        ui.setStatus("Données indisponibles, nouvel essai dans 15 min");
      } else {
        refreshBanner();
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
