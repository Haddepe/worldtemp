/**
 * Câblage des repères géographiques (spec repères §6, §7) : deux interrupteurs (« Étiquettes »,
 * « Fleuves »), leurs paramètres d'URL, le chargement paresseux des fichiers `geo/` et la pose
 * des fleuves dans la scène. `wireGeo` ne connaît ni le DOM réel ni WebGL : tout est injecté,
 * ce qui le rend testable en Node (dette n° 42). `setupGeo` est l'assemblage de production.
 */
import type * as THREE from "three";
import type { Tier } from "../gpu/tier";
import { STRINGS } from "../i18n";
import { LabelsController } from "../labels/controller";
import type { LabelSet } from "../labels/data";
import { createLabelsLayer } from "../labels/layer";
import { createRiversLayer, type RiversLayer } from "../render/rivers";
import type { SceneHandle } from "../render/scene";
import type { RiverSegments } from "../rivers/data";
import { mapStyleFor, type ViewState } from "../tiles/lod";
import type { Overlay } from "../ui/overlay";
import { createToggle } from "../ui/toggle";
import type { TooltipData } from "../ui/tooltip";
import { loadLabelSet, loadRivers, once } from "./loader";
import { parseFlag, withFlag } from "./params";

export interface GeoWiringDeps {
  labelsButton: HTMLButtonElement;
  riversButton: HTMLButtonElement;
  labels: Pick<LabelsController, "setData" | "setEnabled">;
  loadLabels(): Promise<LabelSet>;
  loadRivers(): Promise<RiverSegments>;
  createRivers(segments: RiverSegments): RiversLayer;
  scene: {
    add(object: THREE.Object3D): void;
    onViewChange(cb: (view: ViewState) => void): void;
    requestRender(): void;
    /** Distance caméra–centre courante. */
    distance(): number;
  };
  /** Query string courante (`location.search`). */
  search(): string;
  /** Remplace la query string sans recharger (`history.replaceState`). */
  replaceSearch(search: string): void;
}

export interface GeoWiring {
  /** Applique l'état initial lu dans l'URL ; à appeler une fois, hors du chemin de démarrage. */
  start(): void;
  /** Maillage des fleuves, `null` tant qu'il n'a pas été créé. */
  rivers(): RiversLayer | null;
}

export function wireGeo(deps: GeoWiringDeps): GeoWiring {
  const labelSet = once(deps.loadLabels);
  let labelsOn = parseFlag(deps.search(), "labels");
  let labelsLoaded = false;
  const applyLabels = async (): Promise<void> => {
    if (labelsOn && !labelsLoaded) {
      try {
        deps.labels.setData(await labelSet());
        labelsLoaded = true;
      } catch (e) {
        console.warn("[worldtemp] labels unavailable:", e);
        labelsToggle.setDisabled(true);
        return;
      }
    }
    deps.labels.setEnabled(labelsOn); // `labelsOn` relu après l'attente : il a pu basculer pendant le chargement
  };
  const labelsToggle = createToggle(deps.labelsButton, (on) => {
    labelsOn = on;
    deps.replaceSearch(withFlag(deps.search(), "labels", on));
    void applyLabels();
  }, STRINGS.toggles.labelsUnavailable);
  labelsToggle.setOn(labelsOn);

  let rivers: RiversLayer | null = null;
  let riversOn = parseFlag(deps.search(), "rivers");
  // Création non réentrante (I1) : un clic on/off/on pendant le téléchargement lançait deux
  // créations (deux maillages, deux écouteurs onViewChange). `once` garantit un seul appel du
  // corps, échec compris (l'interrupteur reste grisé tant qu'aucun `generated_at` neuf n'arrive —
  // il n'y en a pas ici, ces fichiers sont statiques, donc un échec est définitif pour la session).
  const buildRivers = once(async (): Promise<RiversLayer> => {
    const layer = deps.createRivers(await deps.loadRivers());
    deps.scene.add(layer.object);
    deps.scene.onViewChange((view) => {
      if (!riversOn) return; // éteint : rien à caler, `applyRivers` recale au rallumage
      const d = view.cameraPosition.length();
      layer.setView(d, mapStyleFor(d));
    });
    return layer;
  });
  const applyRivers = async (): Promise<void> => {
    if (riversOn && !rivers) {
      try {
        rivers = await buildRivers();
      } catch (e) {
        console.warn("[worldtemp] rivers unavailable:", e);
        riversToggle.setDisabled(true);
        return;
      }
    }
    if (rivers) {
      const d = deps.scene.distance();
      rivers.setView(d, mapStyleFor(d));
      rivers.object.visible = riversOn;
      deps.scene.requestRender();
    }
  };
  const riversToggle = createToggle(deps.riversButton, (on) => {
    riversOn = on;
    deps.replaceSearch(withFlag(deps.search(), "rivers", on));
    void applyRivers();
  }, STRINGS.toggles.riversUnavailable);
  riversToggle.setOn(riversOn);

  return {
    start() {
      void applyLabels();
      void applyRivers();
    },
    rivers: () => rivers,
  };
}

export interface GeoHandle {
  start(): void;
  /** Couche dont les étiquettes de ville affichent la valeur (`null` = nom seul) ; `layerShown` :
   * une couche colore le globe même si ses valeurs sont illisibles (pas de variante sombre). */
  setValueSource(data: TooltipData | null, layerShown?: boolean): void;
}

async function fetchGeo(url: string): Promise<Response> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r;
}

/** Assemblage de production : fichiers statiques servis avec le site, DOM et scène réels. */
export function setupGeo(opts: { ui: Overlay; scene: SceneHandle; canvas: HTMLCanvasElement; tier: Tier }): GeoHandle {
  const { ui, scene, canvas, tier } = opts;
  const base = `${import.meta.env.BASE_URL}geo`;
  const labels = new LabelsController({
    layer: createLabelsLayer(ui.labels),
    camera: scene.camera,
    size: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
    tier,
    // Le canvas couvre le viewport : les rectangles des panneaux sont déjà dans son repère.
    obstacles: () => ui.panelRects(),
  });
  ui.onLayoutChange(() => labels.relayout());
  scene.onViewChange(() => labels.onView());
  const wiring = wireGeo({
    labelsButton: ui.labelsToggle,
    riversButton: ui.riversToggle,
    labels,
    loadLabels: () => loadLabelSet(base, (url) => fetchGeo(url).then((r) => r.json() as Promise<unknown>)),
    loadRivers: () => loadRivers(base, (url) => fetchGeo(url).then((r) => r.arrayBuffer())),
    createRivers: createRiversLayer,
    scene: {
      add: (object) => void scene.scene.add(object),
      onViewChange: (cb) => scene.onViewChange(cb),
      requestRender: () => scene.requestRender(),
      distance: () => scene.camera.position.length(),
    },
    search: () => location.search,
    replaceSearch: (search) => history.replaceState(null, "", search),
  });
  // Crochet de validation : dev seulement, comme `__worldtemp`.
  if (import.meta.env.DEV) {
    (window as unknown as { __worldtempGeo: unknown }).__worldtempGeo = { labels, rivers: wiring.rivers };
  }
  return { start: wiring.start, setValueSource: (data, layerShown) => labels.setValueSource(data, layerShown) };
}
