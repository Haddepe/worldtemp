/**
 * Cadence des étiquettes (spec repères §4) : la sélection est recalculée au plus toutes les
 * SELECT_INTERVAL_MS quand la caméra a bougé ; entre deux sélections les étiquettes placées
 * sont seulement reprojetées. Ne demande jamais de rendu WebGL : le DOM vit à côté du canvas.
 */
import * as THREE from "three";
import type { Tier } from "../gpu/tier";
import { projectToScreen } from "../render/pick";
import { mapStyleFor } from "../tiles/lod";
import type { TooltipData } from "../ui/tooltip";
import type { LabelSet } from "./data";
import type { LabelView, LabelsLayer } from "./layer";
import { labelCap, selectLabels, tierIndex, type Box, type Placed } from "./select";
import { labelValue } from "./text";

export const SELECT_INTERVAL_MS = 100;

export interface LabelsControllerDeps {
  layer: Pick<LabelsLayer, "render" | "clear" | "setDark">;
  camera: THREE.PerspectiveCamera;
  /** Taille CSS du canvas. */
  size(): { width: number; height: number };
  tier: Tier;
  /** Panneaux de l'interface posés au-dessus des étiquettes (px CSS, repère du canvas) ; relus à chaque sélection. */
  obstacles?: () => readonly Box[];
  now?: () => number;
  defer?: (cb: () => void, ms: number) => unknown;
}

interface Size { width: number; height: number }

const p = new THREE.Vector3();

export class LabelsController {
  private set: LabelSet | null = null;
  private source: TooltipData | null = null;
  /** Une couche colore le globe, que ses pixels soient lisibles (`source`) ou non. */
  private layerShown = false;
  private enabled = false;
  private placed: Placed[] = [];
  private readonly values = new Map<number, string | null>();
  private lastSelect = Number.NEGATIVE_INFINITY;
  private lastTier = -1;
  private pending = false;
  private readonly lastPos = new THREE.Vector3(Number.NaN, 0, 0);
  /** Taille CSS de la dernière sélection (F2) : une rotation d'écran ne bouge pas la caméra
   * mais change le plafond (`labelCap`) et compte donc comme un mouvement. */
  private lastSize = { width: Number.NaN, height: Number.NaN };
  /** Pose et taille CSS du dernier `paint()` (M1, distinct de `lastPos`/`lastSize` qui datent
   * de la dernière sélection) : permet à `onView()` de sauter la repeinture quand rien n'a
   * bougé depuis le dernier rendu, même si une sélection reste due plus tard. */
  private readonly lastPaintPos = new THREE.Vector3(Number.NaN, 0, 0);
  private lastPaintSize = { width: Number.NaN, height: Number.NaN };
  private readonly now: () => number;
  private readonly defer: (cb: () => void, ms: number) => unknown;

  constructor(private readonly deps: LabelsControllerDeps) {
    this.now = deps.now ?? (() => performance.now());
    this.defer = deps.defer ?? ((cb, ms) => setTimeout(cb, ms));
  }

  setData(set: LabelSet | null): void {
    this.set = set;
    this.placed = [];
    this.values.clear();
    if (this.enabled) this.refresh();
  }

  /** `layerShown` : une couche est affichée même si ses valeurs sont illisibles (`data` nul) —
   * le fond est alors coloré et la variante sombre ne s'applique pas. */
  setValueSource(data: TooltipData | null, layerShown = data !== null): void {
    this.source = data;
    this.layerShown = layerShown;
    this.values.clear();
    if (this.enabled) this.refresh();
  }

  /** Les obstacles ont bougé sans que la caméra bouge (panneaux repliés ou déployés). */
  relayout(): void {
    if (this.enabled) this.refresh();
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (on) this.refresh();
    else {
      this.placed = [];
      this.deps.layer.clear();
    }
  }

  /** Vrai si la caméra a bougé ou si la taille CSS a changé depuis la dernière sélection (F2 :
   * une rotation d'écran ne bouge pas la caméra mais change le plafond). */
  private changedSinceLastSelect({ width, height }: Size): boolean {
    return !this.lastPos.equals(this.deps.camera.position) || width !== this.lastSize.width || height !== this.lastSize.height;
  }

  /** Vrai si la caméra ou la taille CSS ont changé depuis le dernier `paint()` (M1). */
  private changedSinceLastPaint({ width, height }: Size): boolean {
    return !this.lastPaintPos.equals(this.deps.camera.position) || width !== this.lastPaintSize.width || height !== this.lastPaintSize.height;
  }

  /** Avant chaque rendu WebGL (`SceneHandle.onViewChange`). */
  onView(): void {
    if (!this.enabled || !this.set) return;
    const size = this.deps.size(); // une seule lecture par vue : `clientWidth` peut forcer une mise en page
    const changed = this.changedSinceLastSelect(size);
    if (changed && this.now() - this.lastSelect >= SELECT_INTERVAL_MS) {
      this.refresh(size);
      return;
    }
    if (changed) this.scheduleCatchUp();
    // M1 : pose et taille identiques à celles du dernier paint() (pas de la dernière sélection)
    // → rien à repeindre. Entre deux sélections, la caméra qui bouge continue de repeindre à
    // chaque vue puisque changedSinceLastPaint() reste vraie tant qu'elle n'a pas été rattrapée.
    if (!this.changedSinceLastPaint(size)) return;
    this.paint(size, false);
  }

  /** La caméra (ou la taille) peut s'arrêter de changer entre deux sélections, et plus aucune
   * vue n'arrive (rendu à la demande). */
  private scheduleCatchUp(ms = SELECT_INTERVAL_MS): void {
    if (this.pending) return;
    this.pending = true;
    this.defer(() => {
      this.pending = false;
      if (!this.enabled || !this.set || !this.changedSinceLastSelect(this.deps.size())) return;
      // Une sélection naturelle a pu avoir lieu depuis l'armement de ce rattrapage (caméra en
      // mouvement continu) : ne jamais re-sélectionner à moins de SELECT_INTERVAL_MS de la
      // dernière sélection ; sinon on se réarme pour le temps restant.
      const wait = SELECT_INTERVAL_MS - (this.now() - this.lastSelect);
      if (wait > 0) {
        this.scheduleCatchUp(wait);
        return;
      }
      this.refresh();
    }, ms);
  }

  private refresh(size: Size = this.deps.size()): void {
    const set = this.set;
    if (!set) return;
    const { camera } = this.deps;
    const { width, height } = size;
    const d = camera.position.length();
    const tier = tierIndex(d);
    // Changement de palier : on repart de l'ordre de priorité strict (spec §3).
    const shown = tier === this.lastTier ? new Set(this.placed.map((x) => x.id)) : new Set<number>();
    this.lastTier = tier;
    this.placed = selectLabels({
      set, d, camDir: { x: camera.position.x / d, y: camera.position.y / d, z: camera.position.z / d },
      project: (id, out) => {
        const s = projectToScreen(p.fromArray(set.unit, id * 3), camera, width, height);
        out.x = s.x;
        out.y = s.y;
        return s.visible;
      },
      cap: labelCap(this.deps.tier, width), hasValue: this.source !== null, shown,
      bounds: { x0: 0, y0: 0, x1: width, y1: height }, obstacles: this.deps.obstacles?.(),
    });
    this.lastSelect = this.now();
    this.lastPos.copy(camera.position);
    this.lastSize = { width, height };
    this.paint(size, true);
  }

  /** Reprojette les étiquettes placées ; celles qui passent l'horizon ou le bord disparaissent d'ici
   * la prochaine sélection. `fresh` : la sélection vient de les projeter, ses positions servent telles quelles. */
  private paint(size: Size, fresh: boolean): void {
    const set = this.set;
    if (!set) return;
    const { camera } = this.deps;
    const { width, height } = size;
    // Style carte (fond clair) sans couche lisible : le blanc à halo sombre devient illisible,
    // il faut la variante sombre (F5). Avec une couche, le fond est sa couleur : le blanc reste
    // le bon choix quelle que soit la distance.
    this.deps.layer.setDark(mapStyleFor(camera.position.length()) >= 0.5 && !this.layerShown);
    const views: LabelView[] = [];
    for (const pl of this.placed) {
      let { x, y } = pl;
      if (!fresh) {
        const s = projectToScreen(p.fromArray(set.unit, pl.id * 3), camera, width, height);
        if (!s.visible) continue;
        x = s.x;
        y = s.y;
      }
      const item = set.items[pl.id]!;
      let value: string | null = null;
      if (item.kind === "city") {
        if (!this.values.has(item.id)) this.values.set(item.id, labelValue(this.source, item.lon, item.lat));
        value = this.values.get(item.id) ?? null;
      }
      views.push({ id: item.id, kind: item.kind, name: item.name, value, x, y });
    }
    this.deps.layer.render(views);
    this.lastPaintPos.copy(camera.position);
    this.lastPaintSize = { width, height };
  }
}
