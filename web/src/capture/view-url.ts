/**
 * Vue caméra toujours à jour dans l'URL (spec capture §4.3). On compare la position à chaque
 * rendu (`onViewChange`) : le zoom passe aussi par `attachZoom`, pas seulement par les événements
 * d'OrbitControls, et le vent animé rend sans bouger la caméra. Écriture armée au premier geste :
 * rien au chargement. `replaceState` : aucune entrée d'historique.
 */
import type * as THREE from "three";
import { withView } from "../geo/params";
import { vec3ToLonLat } from "../render/pick";
import type { ViewGuard } from "./privacy";

export const SETTLE_MS = 400;

export interface ViewUrlDeps {
  camera: { position: THREE.Vector3 };
  onViewChange(cb: () => void): void;
  /** Gestes de l'utilisateur sur le globe (pointerdown, wheel). */
  onInteraction(cb: () => void): void;
  guard: ViewGuard;
  search(): string;
  replace(search: string): void;
}

export function attachViewUrl(deps: ViewUrlDeps): void {
  const last = deps.camera.position.clone();
  let armed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = (): void => {
    timer = null;
    const p = deps.camera.position;
    const { lon, lat } = vec3ToLonLat(p);
    if (!deps.guard.mayWrite(lon, lat)) return;
    deps.replace(withView(deps.search(), lon, lat, p.length()));
  };

  deps.onInteraction(() => {
    armed = true;
  });
  deps.onViewChange(() => {
    const p = deps.camera.position;
    if (p.distanceToSquared(last) < 1e-12) return;
    last.copy(p);
    if (!armed) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(write, SETTLE_MS);
  });
}
