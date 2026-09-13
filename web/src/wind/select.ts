/** Logique pure de l'interrupteur vent (spec vent §9) : `?wind=`, défaut par tier et reduced-motion. */
import type { Tier } from "../gpu/tier";

const PARAM = "wind";

export function parseWindParam(search: string, tier: Tier, reducedMotion: boolean): boolean {
  const raw = new URLSearchParams(search).get(PARAM);
  if (raw === "1") return true;
  if (raw === "0") return false;
  if (reducedMotion) return false;
  return tier === "high";
}

/** Réécrit seulement `wind` dans la query string. Résultat préfixé par `?`. */
export function withWindParam(search: string, on: boolean): string {
  const p = new URLSearchParams(search);
  p.set(PARAM, on ? "1" : "0");
  return `?${p.toString()}`;
}
