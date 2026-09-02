export type Tier = "high" | "low";

export interface TierInputs {
  urlSearch: string;
  rendererName: string | null;
  hardwareConcurrency: number | undefined;
  userAgent: string;
  devicePixelRatio: number;
}

export interface TierDecision {
  tier: Tier;
  reason: string;
}

export const PIXEL_RATIO_CAP: Record<Tier, number> = { high: 2, low: 1.5 };

const HIGH_GPU = /Apple|NVIDIA|GeForce|Radeon|Arc|Iris|Xe/i;
const LOW_GPU = /Mali-[4T]|Adreno( \(TM\))? [345]|PowerVR/i;
const MOBILE_UA = /Mobi|Android/i;

/**
 * Faisceau d'indices (spec §4) : l'URL prime, puis le nom du GPU, puis une
 * heuristique. Aucun signal n'est fiable seul ; pas de micro-benchmark.
 */
export function decideTier(i: TierInputs): TierDecision {
  const forced = new URLSearchParams(i.urlSearch).get("tier");
  if (forced === "high" || forced === "low") {
    return { tier: forced, reason: `paramètre d'URL tier=${forced}` };
  }

  if (i.rendererName) {
    if (HIGH_GPU.test(i.rendererName)) return { tier: "high", reason: `GPU « ${i.rendererName} »` };
    if (LOW_GPU.test(i.rendererName)) return { tier: "low", reason: `GPU « ${i.rendererName} »` };
  }

  const cores = i.hardwareConcurrency ?? 0;
  if (cores > 0 && cores <= 4) {
    return { tier: "low", reason: `hardwareConcurrency ${cores}` };
  }
  if (MOBILE_UA.test(i.userAgent) && i.devicePixelRatio < 2) {
    return { tier: "low", reason: `mobile, devicePixelRatio ${i.devicePixelRatio}` };
  }
  return { tier: "high", reason: "heuristique par défaut" };
}

/** Lit le navigateur puis délègue à `decideTier`. */
export function detectTier(gl: WebGLRenderingContext | WebGL2RenderingContext): TierDecision {
  let rendererName: string | null = null;
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  if (ext) {
    const name = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    rendererName = typeof name === "string" ? name : null;
  }
  return decideTier({
    urlSearch: window.location.search,
    rendererName,
    hardwareConcurrency: navigator.hardwareConcurrency,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
  });
}
