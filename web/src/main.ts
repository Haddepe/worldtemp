import * as THREE from "three";
import { DATA_BASE_URL, LABELS_REFRESH_MS, REFRESH_MS, STALE_RUN_AFTER_MS, TILES_BASE_URL } from "./config";
import { CACHED_LAYERS, FRAME_CONCURRENCY, FrameSet, Limiter, RETRY_AFTER_MS, loadScalarFrame, loadWindFrame, type ScalarFrame } from "./data/frames";
import { ManifestLoader, browserDeps, isRunStale } from "./data/loader";
import type { Forecast, ForecastEntry, Grid } from "./data/manifest";
import { captureImage } from "./capture/capture";
import { captureFileName, captureWhen } from "./capture/naming";
import { ViewGuard } from "./capture/privacy";
import { shareOrSave } from "./capture/share";
import { attachViewUrl } from "./capture/view-url";
import { withView, withoutView } from "./geo/params";
import { setupGeo } from "./geo/wiring";
import { PIXEL_RATIO_CAP, detectTier } from "./gpu/tier";
import { STRINGS } from "./i18n";
import { LayerCache } from "./layers/cache";
import { LAYERS, layerDef, type LayerDef } from "./layers/registry";
import { orderedLayers, parseLayerParam, withLayerParam } from "./layers/select";
import { buildLut, createLutTexture } from "./render/colormap";
import { FLY_DISTANCE, Flight } from "./render/fly";
import { FrameTextures } from "./render/frame-textures";
import { TIER_PROFILE, createTiledGlobe } from "./render/globe";
import { createHaloLayer } from "./render/halo";
import { ndcFromCanvas, pickSphere, vec3ToLonLat } from "./render/pick";
import { createScene } from "./render/scene";
import { createStarsLayer } from "./render/stars";
import { createWindLayer } from "./render/wind";
import { CitySearch } from "./search/index";
import { createSearchUi } from "./search/ui";
import { TileIndex } from "./tiles/index";
import { TileLoader } from "./tiles/loader";
import { type TilesManifest, parseManifest } from "./tiles/manifest";
import { TimeCursor } from "./time/cursor";
import { fallbackFrames, framePair, loadOrder, nearestFrame, resolvePair, timelineRange } from "./time/timeline";
import { createAbout } from "./ui/about";
import { formatBanner, formatWhen } from "./ui/format";
import { createLayersMenu } from "./ui/layers-menu";
import { locate } from "./ui/locate";
import { byId, createOverlay } from "./ui/overlay";
import { createTimeline } from "./ui/timeline";
import { TapDetector, createTooltip, mouseInput, type Reading, type TooltipData } from "./ui/tooltip";
import { createToggle } from "./ui/toggle";
import { WindController } from "./wind/controller";
import { parseWindParam, withWindParam } from "./wind/select";
import { WIND_PROFILE, WindSim, type WindField } from "./wind/sim";

/** Manifeste vide : aucune tuile demandée (mode repli, spec tuiles §8). */
const NO_TILES: TilesManifest = { schemaVersion: 1, tileSize: 512, sat: { ext: "jpg", maxLevel: -1 }, map: { ext: "png", maxLevel: -1, index: "" } };

async function fetchTiles(): Promise<{ manifest: TilesManifest; index: TileIndex }> {
  const m = await fetch(`${TILES_BASE_URL}/manifest.json`, { cache: "no-cache", signal: AbortSignal.timeout(10_000) });
  if (!m.ok) throw new Error(`HTTP ${m.status} for manifest.json`);
  const manifest = parseManifest(await m.json());
  const i = await fetch(`${TILES_BASE_URL}/${manifest.map.index}`, { signal: AbortSignal.timeout(10_000) });
  if (!i.ok) throw new Error(`HTTP ${i.status} for ${manifest.map.index}`);
  return { manifest, index: TileIndex.parse(await i.arrayBuffer()) };
}

async function boot(): Promise<void> {
  const ui = createOverlay();
  createAbout(byId<HTMLDialogElement>("about"), byId<HTMLButtonElement>("about-open"), byId<HTMLButtonElement>("about-close"));
  const canvas = document.getElementById("globe") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("canvas #globe not found");

  let sceneHandle: ReturnType<typeof createScene>;
  try {
    sceneHandle = createScene(canvas);
  } catch (e) {
    console.error(e);
    ui.showFatal(STRINGS.fatal.noWebgl);
    return;
  }

  const decision = detectTier(sceneHandle.renderer.getContext());
  console.info(`[worldtemp] tier ${decision.tier} — ${decision.reason}`);
  sceneHandle.setPixelRatioCap(PIXEL_RATIO_CAP[decision.tier]);
  const profile = TIER_PROFILE[decision.tier];
  const tooltip = createTooltip();
  /** Assigné plus bas, une fois le vent construit : le gestionnaire `webglcontextlost` ci-dessous
   * peut se déclencher pendant le chargement des tuiles, bien avant (sinon : TDZ, écran fatal perdu). */
  let stopWind: () => void = () => {};

  canvas.addEventListener("webglcontextlost", (ev) => {
    ev.preventDefault();
    tooltip.setReading(null, "hover");
    stopWind();
    ui.showFatal(STRINGS.fatal.contextLost, { reload: true });
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
  sceneHandle.scene.add(createStarsLayer(decision.tier).object); // ciel étoilé, dessiné avant tout le reste
  const halo = createHaloLayer(); // halo d'atmosphère sur le pourtour, éteint de près
  sceneHandle.scene.add(halo.object);

  const windProfile = WIND_PROFILE[decision.tier];
  const windSim = new WindSim(windProfile.particles, windProfile.trail, windProfile.stride);
  const windLayer = createWindLayer(windSim.positions, windProfile.particles, windProfile.trail);
  sceneHandle.scene.add(windLayer.object);
  const windCtl = new WindController({
    sim: windSim,
    layer: windLayer,
    camera: sceneHandle.camera,
    viewportHeight: () => canvas.clientHeight,
    pick: (x, y, target) => pickSphere(x, y, sceneHandle.camera, target),
  });

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
    const r = tooltip.hitMarker(hit.x, hit.y) ? null : readingAt(hit.x, hit.y, c.w, c.h);
    tooltip.setReading(r && { ...r, origin: "user" }, "pin");
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
    // Souris : tant qu'une lecture est épinglée (arrivée d'un vol), le survol ne la remplace pas.
    const c = canvasPoint(e);
    if (mouseInput(tooltip, "move", () => readingAt(c.x, c.y, c.w, c.h))) tooltip.update(sceneHandle.camera, c.w, c.h);
  });
  canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "touch") mouseInput(tooltip, "leave", () => null);
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") tapInput("down", e);
    else mouseInput(tooltip, "down", () => null); // un clic souris lève l'épingle, le survol reprend
  });
  canvas.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch") tapInput("up", e);
  });
  canvas.addEventListener("pointercancel", (e) => {
    if (e.pointerType === "touch") tapInput("cancel", e);
  });

  sceneHandle.onViewChange((view) => {
    globe.update(view);
    halo.setView(view.cameraPosition.length());
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
      console.info(`[worldtemp] tiles: map ≤ ${manifest.map.maxLevel}, sat ≤ ${manifest.sat.maxLevel}`);
    } catch (e) {
      console.warn("[worldtemp] tiles unavailable, falling back to Blue Marble 4K:", e);
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
  const limiter = new Limiter(FRAME_CONCURRENCY);
  /** Clé d'un `FrameSet` pour une entrée du manifeste (revue T12 round 1, finding 2) : sert à
   * détecter une frise pas encore réamorcée sur le manifeste courant (concurrence avec `applyData`). */
  const framesKey = (e: ForecastEntry): string => `${e.run}|${e.generated_at}`;
  const gridOf = (): Grid => manifests.manifest!.grid; // les échéances ne se chargent qu'avec un manifeste
  /** Une échéance vient d'arriver : la paire voulue est peut-être devenue affichable (spec lot E §5.4). */
  const onFrameReady = (): void => applyTime();
  const layerSets = new LayerCache<FrameSet<ScalarFrame>>(CACHED_LAYERS[decision.tier], (id) =>
    new FrameSet<ScalarFrame>((frame) => loadScalarFrame(browserDeps, DATA_BASE_URL, frame, gridOf(), layerDef(id)?.soften ?? 0), limiter, onFrameReady),
  );
  const windSet = new FrameSet<Uint8Array>(
    (frame, i) => {
      const v = manifests.manifest?.layers["wind_v"]?.frames[i];
      return v ? loadWindFrame(browserDeps, DATA_BASE_URL, frame, v, gridOf()) : Promise.reject(new Error("wind_v frame missing"));
    },
    limiter,
    onFrameReady,
    Date.now,
    1, // priorité : après la couche affichée
  );
  let textures: FrameTextures | null = null;
  const texturesFor = (grid: Grid): FrameTextures => {
    if (!textures || textures.width !== grid.width || textures.height !== grid.height) {
      textures?.dispose();
      textures = new FrameTextures(grid.width, grid.height);
    }
    return textures;
  };
  const menu = createLayersMenu(ui.layersMenu, (id) => void activate(id, true));
  const luts = new Map<string, { key: string; lut: THREE.DataTexture }>();
  let activeId: string | null = null;
  let hadManifest = false;
  /** Couche liée au globe (spec lot E §5.3) — distincte de `activeId` pendant un chargement :
   * protège son jeu d'échéances contre l'éviction du cache. */
  let shownId: string | null = null;
  let shownSet: FrameSet<ScalarFrame> | null = null;
  /** Échéance dont la légende affiche les min/max ; −1 = à recalculer. */
  let legendIndex = -1;
  let lastLabelsPush = 0;
  let updateFailed = false;
  /** Statut d'échec de couche (spec §13), prioritaire sur les autres statuts tant que non nul. */
  let layerNotice: string | null = null;
  /** Statuts posés par `applyTime` : fin de frise de la couche, échéances en échec. */
  let clampNotice: string | null = null;
  let framesNotice: string | null = null;
  /** id → generated_at de l'entrée qui a échoué et instant de l'échec ; un generated_at différent
   * (M1) ou un échec plus vieux que RETRY_AFTER_MS (revue finale F1) rend la couche retentable. */
  const failed = new Map<string, { generatedAt: string; at: number }>();

  let windOn = parseWindParam(location.search, decision.tier, matchMedia("(prefers-reduced-motion: reduce)").matches);
  /** Vent demandé et disponible : ses échéances sont voulues et son champ suit le curseur. */
  let windActive = false;
  let windUnsub: (() => void) | null = null;
  let windField: WindField | null = null;
  /** Statut « Vent indisponible », après layerNotice dans l'ordre de priorité. */
  let windNotice: string | null = null;
  /** Retour d'une action de l'utilisateur (« Location unavailable »), prioritaire, effacé après 5 s. */
  let userNotice: string | null = null;
  let userNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  const windToggle = createToggle(ui.windToggle, (on) => {
    windOn = on;
    history.replaceState(null, "", withWindParam(location.search, on));
    void applyWind();
  }, STRINGS.toggles.windUnavailable);
  windToggle.setOn(windOn);

  // Repères géographiques (spec repères §6) : étiquettes et fleuves, câblés dans `geo/wiring.ts`.
  const geo = setupGeo({ ui, scene: sceneHandle, canvas, tier: decision.tier });

  const lutFor = (def: LayerDef, entry: ForecastEntry): THREE.DataTexture => {
    const enc = entry.encoding;
    const key = `${enc.min}/${enc.max}/${enc.scale}`;
    const cached = luts.get(def.id);
    if (cached && cached.key === key) return cached.lut;
    cached?.lut.dispose();
    const lut = createLutTexture(buildLut(def, enc));
    luts.set(def.id, { key, lut });
    return lut;
  };

  // Frise temporelle (spec lot E §5, §7).
  const cursor = new TimeCursor(timelineRange([], Date.now()), Date.now());
  /** Premier contact avec la frise : on précharge toutes les échéances utiles (spec lot E §5.4). */
  let prefetchAll = false;
  let playUnsub: (() => void) | null = null;
  let timelineVisible = false;
  const timeline = createTimeline(
    {
      root: byId<HTMLElement>("timeline"),
      play: byId<HTMLButtonElement>("timeline-play"),
      range: byId<HTMLInputElement>("timeline-range"),
      label: byId<HTMLElement>("timeline-label"),
      now: byId<HTMLButtonElement>("timeline-now"),
    },
    {
      seek: (t) => {
        cursor.seek(t);
        prefetch();
        applyTime();
      },
      toggle: () => {
        if (cursor.state.playing) {
          cursor.pause();
        } else {
          prefetch();
          cursor.play();
          startPlayback();
        }
        applyTime();
      },
      goLive: () => {
        cursor.goLive(Date.now());
        applyTime();
      },
      interact: () => prefetch(),
    },
  );
  // Crochets de validation (T13) : dev seulement, comme `__worldtemp`.
  if (import.meta.env.DEV) {
    (window as unknown as { __worldtempWind: unknown }).__worldtempWind = { sim: windSim, controller: windCtl, frames: windSet, layer: windLayer };
    (window as unknown as { __worldtempTime: unknown }).__worldtempTime = { cursor, layerSets, windSet, limiter };
  }

  const renderTimeline = (): void => {
    const s = cursor.state;
    timeline.render({ t: s.t, start: s.range.start, end: s.range.end, playing: s.playing, live: s.mode === "live", nowMs: Date.now() });
  };

  /** Nouvelle plage du curseur : manifeste neuf, ou minute qui passe (le mode live suit l'heure). */
  const updateRange = (): void => {
    const m = manifests.manifest;
    if (!m) return;
    const lasts = Object.values(m.layers).map((e) => e.frames[e.frames.length - 1]!.valid_ms);
    const now = Date.now();
    cursor.setRange(timelineRange(lasts, now), now);
    const { range } = cursor.state;
    const visible = range.end > range.start;
    if (visible !== timelineVisible) {
      timelineVisible = visible;
      timeline.setVisible(visible);
      ui.notifyLayout(); // les étiquettes évitent la frise
    }
  };

  /** Échéances voulues : la paire autour de t, ou toute la frise utile après le premier contact (spec lot E §5.4). */
  const wantFrames = (): void => {
    const m = manifests.manifest;
    if (!m) return;
    const { t, range } = cursor.state;
    const order = (e: ForecastEntry): number[] => {
      if (prefetchAll) return loadOrder(e.frames, t, range.start, range.end);
      const p = framePair(e.frames, t);
      return p.f > 0 ? [p.a, p.b] : [p.a];
    };
    const entry = shownId ? m.layers[shownId] : undefined;
    // Clé pas encore à jour (concurrence avec `applyData`, finding 2) : rien à demander tant que le
    // jeu n'est pas réamorcé sur ce manifeste — ses index ne correspondraient pas à `entry.frames`.
    if (shownSet && entry && shownSet.key === framesKey(entry)) shownSet.want(order(entry));
    const wu = m.layers["wind_u"];
    if (!windActive || !wu) windSet.want([]);
    else if (windSet.key === framesKey(wu)) windSet.want(order(wu));
  };

  const prefetch = (): void => {
    if (prefetchAll) return;
    prefetchAll = true;
    wantFrames();
  };

  /** Échéances nécessaires à `t` prêtes ou en échec (repli) : la lecture peut avancer. */
  const settledAt = (t: number): boolean => {
    const m = manifests.manifest;
    if (!m) return true;
    const ok = (set: { isSettled(i: number): boolean; key: string | null }, e: ForecastEntry | undefined): boolean => {
      // Clé pas encore à jour (finding 2) : cette frise ne doit pas bloquer la lecture, elle va être réamorcée.
      if (!e || set.key !== framesKey(e)) return true;
      const p = framePair(e.frames, t);
      return set.isSettled(p.a) && (p.f === 0 || set.isSettled(p.b));
    };
    return (!shownSet || !shownId || ok(shownSet, m.layers[shownId])) && (!windActive || ok(windSet, m.layers["wind_u"]));
  };

  const startPlayback = (): void => {
    if (playUnsub) return;
    playUnsub = sceneHandle.onFrame((now) => {
      if (cursor.tick(now, settledAt)) {
        applyTime();
      } else {
        renderTimeline();
        refreshBanner(); // statut « Loading forecast… » pendant l'attente
      }
      if (!cursor.state.playing) {
        playUnsub?.();
        playUnsub = null;
      }
      return false; // applyTime demande lui-même le rendu
    });
  };

  const refreshBanner = (): void => {
    const m = manifests.manifest;
    if (m === null) {
      ui.setBanner("GlobeLayers");
      ui.setStatus(userNotice ?? STRINGS.status.noData);
      return;
    }
    const entry = shownId ? m.layers[shownId] : undefined;
    ui.setBanner(entry ? formatBanner(entry, Date.now()) : "GlobeLayers");
    // Fraîcheur jugée sur le run GFS, quelle que soit la couche affichée (spec lot E §6.4)
    const gfs = Object.values(m.layers).find((e) => e.model === "gfs_0p25");
    ui.setStatus(
      userNotice ??
        layerNotice ??
        windNotice ??
        (updateFailed
          ? STRINGS.status.updateFailed
          : gfs && isRunStale(gfs, Date.now(), STALE_RUN_AFTER_MS)
            ? STRINGS.status.outdated
            : (clampNotice ?? framesNotice ?? (cursor.state.buffering ? STRINGS.status.buffering : tilesReady ? null : STRINGS.status.noMapDetail))),
    );
  };

  const flashNotice = (text: string): void => {
    userNotice = text;
    refreshBanner();
    clearTimeout(userNoticeTimer);
    userNoticeTimer = setTimeout(() => {
      userNotice = null;
      refreshBanner();
    }, 5_000);
  };

  // Recherche de ville et « ma position » (spec lot F §5) : vol, puis marqueur et tooltip au point.
  const flight = new Flight({
    camera: sceneHandle.camera,
    controls: sceneHandle.controls,
    onFrame: (cb) => sceneHandle.onFrame(cb),
    requestRender: () => sceneHandle.requestRender(),
    reducedMotion: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  // Toute interaction avec le globe reprend la main : le vol est annulé dès le pointerdown ou la molette.
  canvas.addEventListener("pointerdown", () => flight.cancel());
  canvas.addEventListener("wheel", () => flight.cancel(), { passive: true });
  /** `shareView` : réécrire l'URL à l'arrivée — oui pour une ville choisie, non pour « ma position »
   * (la position n'est ni stockée ni partagée, promesse du panneau About ; relecture finale F4). */
  // Vue toujours à jour dans l'URL, jamais « ma position » (spec capture §4.3).
  const viewGuard = new ViewGuard();
  attachViewUrl({
    camera: sceneHandle.camera,
    onViewChange: (cb) => sceneHandle.onViewChange(cb),
    onInteraction: (cb) => {
      canvas.addEventListener("pointerdown", cb);
      canvas.addEventListener("wheel", cb, { passive: true });
    },
    busy: () => flight.active,
    guard: viewGuard,
    search: () => location.search,
    replace: (s) => history.replaceState(null, "", s),
  });
  const goTo = (lon: number, lat: number, name: string | undefined, shareView: boolean): void => {
    // Ville : garde levée à l'arrivée seulement — un vol annulé (geste) laisse la caméra près de
    // « ma position », qui doit rester protégée (revue finale).
    if (!shareView) {
      viewGuard.located(lon, lat);
      history.replaceState(null, "", withoutView(location.search));
    }
    tooltip.setReading(null, "pin");
    flight.start(lon, lat, FLY_DISTANCE, () => {
      tooltip.setReading({ lon, lat, name, origin: shareView ? "city" : "locate" }, "pin");
      tooltip.update(sceneHandle.camera, canvas.clientWidth, canvas.clientHeight);
      if (shareView) {
        viewGuard.cityChosen();
        history.replaceState(null, "", withView(location.search, lon, lat, FLY_DISTANCE));
      }
      sceneHandle.requestRender();
    });
  };
  // Capture (spec capture §4.1) : l'image fige l'instant du clic, la lecture continue.
  const captureButton = byId<HTMLButtonElement>("capture");
  const runCapture = async (): Promise<void> => {
    captureButton.disabled = true;
    captureButton.setAttribute("aria-busy", "true");
    try {
      const m = manifests.manifest;
      const entry = shownId && m ? m.layers[shownId] : undefined;
      const def = shownId ? layerDef(shownId) : undefined;
      const layer = def && entry ? { def, enc: entry.encoding, model: entry.model, run: entry.run } : null;
      const tMs = layer ? cursor.state.t : Date.now();
      const blob = await captureImage(sceneHandle, { layer, tMs, labels: geo.labelSnapshot(), pin: tooltip.pinned() });
      const text = layer
        ? `${layer.def.label} · ${captureWhen(tMs)} — ${STRINGS.capture.site}`
        : `${STRINGS.capture.shareTitle} — ${STRINGS.capture.site}`;
      const outcome = await shareOrSave(blob, captureFileName(layer ? layer.def.id : null, tMs), text, location.href);
      if (outcome === "saved") flashNotice(STRINGS.capture.saved);
    } catch (e) {
      console.error(e);
      flashNotice(STRINGS.capture.failed);
    } finally {
      captureButton.disabled = false;
      captureButton.removeAttribute("aria-busy");
    }
  };
  captureButton.addEventListener("click", () => void runCapture());
  const geoBase = `${import.meta.env.BASE_URL}geo`;
  createSearchUi({
    openButton: byId<HTMLButtonElement>("search-open"),
    panel: byId<HTMLElement>("search"),
    input: byId<HTMLInputElement>("search-input"),
    list: byId<HTMLElement>("search-results"),
    message: byId<HTMLElement>("search-message"),
    search: new CitySearch(geoBase, async (url) => {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return r.json() as Promise<unknown>;
    }),
    onChoose: (r) => goTo(r.lon, r.lat, r.name, true),
    onLayoutChange: () => ui.notifyLayout(),
  });
  byId<HTMLButtonElement>("locate").addEventListener("click", () => {
    locate("geolocation" in navigator ? navigator.geolocation : undefined).then(
      ({ lon, lat }) => goTo(lon, lat, undefined, false),
      (e: unknown) => {
        console.warn("[worldtemp] location unavailable:", e);
        flashNotice(STRINGS.status.locationUnavailable);
      },
    );
  });

  /** Champ de vent à l'instant t (spec lot E §6.3) : même paire, seul le mélange avance, sans réamorcer la simulation. */
  const applyWindTime = (m: Forecast, t: number): void => {
    const wu = m.layers["wind_u"];
    const wv = m.layers["wind_v"];
    // Clé pas encore à jour (finding 2) : rien de prêt tant que `windSet` n'est pas réamorcé sur ce
    // manifeste — l'ancien champ continue (assigné ci-dessous, sans le toucher ici).
    if (!windActive || !wu || !wv || windSet.key !== framesKey(wu)) return;
    const p = resolvePair(framePair(wu.frames, t), (i) => windSet.isReady(i), wu.frames.length);
    if (!p) return; // rien de prêt : l'ancien champ continue (ou rien, au premier chargement)
    const uv = windSet.get(p.a)!;
    const uvB = p.f > 0 ? windSet.get(p.b) : null;
    const f = uvB ? p.f : 0;
    if (windField && windField.uv === uv && (windField.uvB ?? null) === uvB) {
      windField.f = f;
    } else {
      windField = { uv, uvB, f, grid: { width: m.grid.width, height: m.grid.height }, encU: wu.encoding, encV: wv.encoding };
      windCtl.setField(windField);
    }
    windNotice = null; // un champ est affiché : « Wind unavailable » ne survit pas à un réessai réussi (revue finale F2)
    tooltip.setWind(windField);
    windLayer.object.visible = true;
  };

  /** Applique l'instant du curseur (spec lot E §6) : paire d'échéances, fondu, valeurs, légende, vent. */
  const applyTime = (): void => {
    renderTimeline();
    const m = manifests.manifest;
    if (!m) return;
    wantFrames();
    const s = cursor.state;
    const def = shownId ? layerDef(shownId) : undefined;
    const entry = shownId ? m.layers[shownId] : undefined;
    const set = shownSet;
    clampNotice = null;
    framesNotice = null;
    // Clé pas encore à jour (finding 2) : rien de prêt tant que `set` n'est pas réamorcé sur ce
    // manifeste — ses états ne correspondraient pas à `entry.frames`. L'affichage précédent reste.
    if (def && entry && set && set.key === framesKey(entry)) {
      const want = framePair(entry.frames, s.t);
      const p = resolvePair(want, (i) => set.isReady(i), entry.frames.length);
      if (p) {
        const fa = set.get(p.a)!;
        const fb = p.f > 0 ? set.get(p.b) : null;
        const f = fb ? p.f : 0;
        const key = (i: number): string => `${def.id}|${entry.run}|${entry.frames[i]!.forecast_hour}`;
        const tex = texturesFor(m.grid).show({ key: key(p.a), data: fa.render }, fb ? { key: key(p.b), data: fb.render } : null);
        globe.setLayer(tex.a, m.grid.width, m.grid.height, tex.b, f);
        const data: TooltipData = { def, a: fa.values, b: fb?.values ?? null, f, grid: m.grid, encoding: entry.encoding };
        tooltip.setData(data);
        const now = performance.now();
        if (!s.playing || now - lastLabelsPush >= LABELS_REFRESH_MS) {
          geo.setValueSource(data, true);
          lastLabelsPush = now;
        }
        const n = nearestFrame(p);
        if (n !== legendIndex) {
          ui.setLegend(def, entry.encoding, entry.frames[n]!.stats);
          legendIndex = n;
        }
      } // rien de prêt : l'affichage précédent reste (nouveau run en cours de chargement)
      const last = entry.frames[entry.frames.length - 1]!;
      if (want.clamped && s.t > last.valid_ms) clampNotice = STRINGS.status.forecastEnds(formatWhen(last.valid_ms));
      if (set.stateOf(want.a) === "failed" || (want.f > 0 && set.stateOf(want.b) === "failed")) framesNotice = STRINGS.status.framesFailed;
    }
    applyWindTime(m, s.t);
    refreshBanner();
    sceneHandle.requestRender();
  };

  /** Applique la couche `id` (null = Aucune) : charge la paire autour de t, pose LUT, isolignes, légende ; `applyTime` fait le reste. */
  const activate = async (id: string | null, fromUser: boolean): Promise<void> => {
    const manifest = manifests.manifest;
    const previous = activeId;
    activeId = id;
    menu.setActive(id);
    if (fromUser) history.replaceState(null, "", withLayerParam(location.search, id));
    const def = id ? layerDef(id) : undefined;
    const entry = id && manifest ? manifest.layers[id] : undefined;
    if (!def || !entry || !manifest) {
      shownSet?.want([]);
      shownSet = null;
      shownId = null;
      legendIndex = -1;
      globe.setLayer(null, 1440, 721);
      globe.setIsoStep(0);
      ui.setLegendVisible(false);
      tooltip.setData(null);
      geo.setValueSource(null);
      applyTime();
      return;
    }
    const set = layerSets.get(id!, shownId);
    set.setFrames(framesKey(entry), entry.frames);
    const p = framePair(entry.frames, cursor.state.t);
    // Frise remplacée pendant le chargement (l'appel suivant reprend), ou l'utilisateur a changé
    // d'avis (couche suivante cliquée avant que celle-ci arrive — son éviction du cache LRU rejette
    // alors `ensure`, revue T12 round 1 finding 1) : ne pas pénaliser une couche qui n'est plus visée.
    const superseded = (): boolean => manifests.manifest !== manifest || activeId !== id;
    let lastError: unknown = null;
    const load = (indices: number[]): Promise<boolean> =>
      set.ensure(indices).then(() => true, (e: unknown) => {
        lastError = e;
        return false;
      });
    let ok = await load(p.f > 0 ? [p.a, p.b] : [p.a]);
    // Repli (spec lot E §5.4, revue finale F1) : une échéance en échec ne grise pas la couche. On
    // tente, une à une, au plus 2 autres échéances, les plus proches du curseur d'abord ; la première
    // chargée est affichée par `applyTime` (repli de `resolvePair`, « Some forecast hours failed to load »).
    if (!ok && !superseded()) {
      for (const i of fallbackFrames(p, entry.frames.length, (j) => set.stateOf(j) !== "failed", 2)) {
        ok = await load([i]);
        if (ok || superseded()) break;
      }
    }
    if (!ok) {
      if (superseded()) return;
      console.warn(`[worldtemp] layer ${id} unavailable:`, lastError);
      failed.set(id!, { generatedAt: entry.generated_at, at: Date.now() });
      menu.setDisabled(id!, true);
      const fallback = previous !== id && previous !== null && !failed.has(previous) ? previous : null;
      await activate(fallback, fromUser);
      layerNotice = STRINGS.status.layerUnavailable;
      refreshBanner();
      return;
    }
    if (activeId !== id) return; // l'utilisateur a changé d'avis pendant le chargement
    if (shownSet && shownSet !== set) shownSet.want([]);
    shownSet = set;
    shownId = id;
    legendIndex = -1;
    layerNotice = null;
    const enc = entry.encoding;
    globe.setLut(lutFor(def, entry));
    globe.setIsoStep(def.isoStep !== null ? def.isoStep / (enc.max - enc.min) : 0);
    ui.setLegendVisible(true);
    applyTime();
    console.info(`[worldtemp] layer ${id} run ${entry.run}, ${entry.frames.length} frames`);
  };

  stopWind = () => {
    windActive = false;
    windUnsub?.();
    windUnsub = null;
    windField = null;
    windCtl.setField(null);
    tooltip.setWind(null);
    windLayer.object.visible = false;
    windSet.clear(); // vent éteint : ses échéances sont rendues à la mémoire (revue finale F7)
    sceneHandle.requestRender();
  };

  /** Active/désactive le vent selon `windOn` et le manifeste (spec vent §8, lot E §6.3). */
  const applyWind = async (): Promise<void> => {
    const m = manifests.manifest;
    const wu = m?.layers["wind_u"];
    const wv = m?.layers["wind_v"];
    // `sampleUV` décode en ligne, en linéaire ; U et V doivent partager la même frise
    const usable = !!wu && !!wv && wu.encoding.scale === "linear" && wv.encoding.scale === "linear" &&
      wu.run === wv.run && wu.frames.length === wv.frames.length;
    windToggle.setDisabled(!usable);
    if (!usable || !windOn) {
      windNotice = null;
      stopWind();
      refreshBanner();
      return;
    }
    windSet.setFrames(framesKey(wu!), wu!.frames);
    windActive = true;
    if (!windUnsub) windUnsub = sceneHandle.onFrame((now) => windCtl.frame(now));
    const p = framePair(wu!.frames, cursor.state.t);
    try {
      await windSet.ensure(p.f > 0 ? [p.a, p.b] : [p.a]);
      windNotice = null;
    } catch (e) {
      if (!windOn || manifests.manifest !== m) return; // éteint ou frise remplacée pendant l'attente
      console.warn("[worldtemp] wind unavailable:", e);
      windNotice = STRINGS.status.windUnavailable;
    }
    if (windOn) applyTime();
  };

  /** Couches en échec redevenues retentables : entrée changée (M1) ou échec plus vieux que
   * RETRY_AFTER_MS (revue finale F1) — leur bouton est réactivé. */
  const expireFailed = (): void => {
    const m = manifests.manifest;
    const now = Date.now();
    for (const [id, f] of failed) {
      const entry = m?.layers[id];
      if (now - f.at < RETRY_AFTER_MS && (!entry || entry.generated_at === f.generatedAt)) continue;
      failed.delete(id);
      menu.setDisabled(id, false);
    }
  };

  const applyData = async () => {
    if (!tilesReady) await loadTiles();
    try {
      const fresh = await manifests.refresh();
      updateFailed = false;
      expireFailed();
      if (fresh) {
        // Nouveau run de la couche affichée ou du vent (revue finale F3) : le préchargement complet
        // n'est réarmé qu'au prochain contact avec la frise — un onglet oublié ne retélécharge pas
        // toute la frise à chaque run. En lecture, on le garde : elle a besoin des échéances à venir.
        const shownEntry = shownId ? fresh.layers[shownId] : undefined;
        const freshWind = fresh.layers["wind_u"];
        const runChanged = (shownSet !== null && shownEntry !== undefined && shownSet.key !== framesKey(shownEntry)) ||
          (windActive && freshWind !== undefined && windSet.key !== framesKey(freshWind));
        if (runChanged && !cursor.state.playing) prefetchAll = false;
        // Réamorçage synchrone (revue T12 round 1, finding 2), avant tout `await` : une échéance en
        // vol de l'ancien run peut arriver (`onFrameReady`) pendant que `manifests.manifest` pointe déjà
        // ici sur le manifeste neuf ; sans ceci, `wantFrames`/`applyTime` liraient ses index contre les
        // échéances de l'ancien run. `activate`/`applyWind` ci-dessous réamorceront à nouveau (no-op si
        // la clé n'a pas changé) une fois la couche/le vent effectivement résolus.
        if (shownSet && shownId && fresh.layers[shownId]) shownSet.setFrames(framesKey(fresh.layers[shownId]!), fresh.layers[shownId]!.frames);
        if (windActive && fresh.layers["wind_u"] && fresh.layers["wind_v"]) {
          windSet.setFrames(framesKey(fresh.layers["wind_u"]!), fresh.layers["wind_u"]!.frames);
        }
        const defs = orderedLayers(LAYERS, fresh); // tous les boutons : désactivés, pas absents (spec §13)
        menu.setLayers(defs);
        for (const id of failed.keys()) menu.setDisabled(id, true);
        const available = defs.map((d) => d.id).filter((id) => !failed.has(id));
        const firstLoad = !hadManifest;
        hadManifest = true;
        const target = firstLoad
          ? parseLayerParam(location.search, available)
          : activeId !== null && !available.includes(activeId)
            ? parseLayerParam("", available)
            : activeId;
        updateRange();
        await activate(target, false);
      }
      await applyWind();
      refreshBanner();
    } catch (e) {
      console.warn("[worldtemp] manifest unavailable:", e);
      updateFailed = manifests.manifest !== null;
      expireFailed();
      await applyWind(); // manifeste absent → switch désactivé
      refreshBanner(); // manifeste jamais chargé : refreshBanner pose « Données indisponibles » (I2)
    }
  };

  await applyData();
  geo.start();
  setInterval(applyData, REFRESH_MS);
  // Chaque minute : le mode live suit l'heure, le bandeau vieillit (« updated … ago »).
  setInterval(() => {
    updateRange();
    applyTime();
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void applyData();
  });
}

boot().catch((e: unknown) => {
  console.error(e);
  const fatal = document.getElementById("fatal");
  if (fatal) {
    fatal.textContent = STRINGS.fatal.bootFailed;
    fatal.hidden = false;
  }
});
