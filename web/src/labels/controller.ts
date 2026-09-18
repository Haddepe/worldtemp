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
import { labelCap, selectLabels, tierIndex, type Placed } from "./select";
import { labelValue } from "./text";

export const SELECT_INTERVAL_MS = 100;

export interface LabelsControllerDeps {
  layer: Pick<LabelsLayer, "render" | "clear" | "setDark">;
  camera: THREE.PerspectiveCamera;
  /** Taille CSS du canvas. */
  size(): { width: number; height: number };
  tier: Tier;
  now?: () => number;
  defer?: (cb: () => void, ms: number) => unknown;
}

const p = new THREE.Vector3();

export class LabelsController {
  private set: LabelSet | null = null;
  private source: TooltipData | null = null;
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

  setValueSource(data: TooltipData | null): void {
    this.source = data;
    this.values.clear();
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
  private changedSinceLastSelect(): boolean {
    const { width, height } = this.deps.size();
    return !this.lastPos.equals(this.deps.camera.position) || width !== this.lastSize.width || height !== this.lastSize.height;
  }

  /** Avant chaque rendu WebGL (`SceneHandle.onViewChange`). */
  onView(): void {
    if (!this.enabled || !this.set) return;
    const changed = this.changedSinceLastSelect();
    if (changed && this.now() - this.lastSelect >= SELECT_INTERVAL_MS) {
      this.refresh();
      return;
    }
    if (changed) this.scheduleCatchUp();
    this.paint();
  }

  /** La caméra (ou la taille) peut s'arrêter de changer entre deux sélections, et plus aucune
   * vue n'arrive (rendu à la demande). */
  private scheduleCatchUp(ms = SELECT_INTERVAL_MS): void {
    if (this.pending) return;
    this.pending = true;
    this.defer(() => {
      this.pending = false;
      if (!this.enabled || !this.set || !this.changedSinceLastSelect()) return;
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

  private refresh(): void {
    const set = this.set;
    if (!set) return;
    const { camera } = this.deps;
    const { width, height } = this.deps.size();
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
    });
    this.lastSelect = this.now();
    this.lastPos.copy(camera.position);
    this.lastSize = { width, height };
    this.paint();
  }

  /** Reprojette les étiquettes placées ; celles qui passent l'horizon ou le bord disparaissent d'ici la prochaine sélection. */
  private paint(): void {
    const set = this.set;
    if (!set) return;
    const { camera } = this.deps;
    const { width, height } = this.deps.size();
    // Style carte (fond clair) sans couche lisible : le blanc à halo sombre devient illisible,
    // il faut la variante sombre (F5). Avec une couche, le fond est sa couleur : le blanc reste
    // le bon choix quelle que soit la distance.
    this.deps.layer.setDark(mapStyleFor(camera.position.length()) >= 0.5 && this.source === null);
    const views: LabelView[] = [];
    for (const pl of this.placed) {
      const s = projectToScreen(p.fromArray(set.unit, pl.id * 3), camera, width, height);
      if (!s.visible) continue;
      const item = set.items[pl.id]!;
      let value: string | null = null;
      if (item.kind === "city") {
        if (!this.values.has(item.id)) this.values.set(item.id, labelValue(this.source, item.lon, item.lat));
        value = this.values.get(item.id) ?? null;
      }
      views.push({ id: item.id, kind: item.kind, name: item.name, value, x: s.x, y: s.y });
    }
    this.deps.layer.render(views);
  }
}
