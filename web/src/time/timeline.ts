/**
 * Modèle de temps de la frise (spec lot E §5.1) : logique pure, sans DOM ni GPU. Les instants sont
 * des millisecondes UTC ; les échéances sont repérées par leur index dans `frames`.
 */
export const HOUR_MS = 3_600_000;
/** Horizon du curseur (spec lot E §2). */
export const HORIZON_MS = 48 * HOUR_MS;

/** Deux échéances qui encadrent un instant et facteur de mélange de `a` vers `b`. */
export interface FramePair {
  a: number;
  b: number;
  /** Dans [0, 1[ ; 0 quand `a === b`. */
  f: number;
  /** Instant hors de la frise : on reste sur la première ou la dernière échéance. */
  clamped: boolean;
}

export interface TimeRange {
  start: number;
  end: number;
}

export function framePair(frames: readonly { valid_ms: number }[], t: number): FramePair {
  const n = frames.length;
  if (n === 0) throw new Error("no forecast frame");
  const first = frames[0]!.valid_ms;
  const last = frames[n - 1]!.valid_ms;
  if (t <= first) return { a: 0, b: 0, f: 0, clamped: t < first };
  if (t >= last) return { a: n - 1, b: n - 1, f: 0, clamped: t > last };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.valid_ms <= t) lo = mid;
    else hi = mid;
  }
  const t0 = frames[lo]!.valid_ms;
  const f = (t - t0) / (frames[hi]!.valid_ms - t0);
  return f === 0 ? { a: lo, b: lo, f: 0, clamped: false } : { a: lo, b: hi, f, clamped: false };
}

/**
 * Plage du curseur : de l'heure courante arrondie à l'heure inférieure jusqu'à la dernière
 * échéance disponible (toutes couches confondues, arrondie à l'heure), bornée à +48 h.
 */
export function timelineRange(lastValidMs: readonly number[], nowMs: number): TimeRange {
  const start = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const last = lastValidMs.length ? Math.floor(Math.max(...lastValidMs) / HOUR_MS) * HOUR_MS : start;
  return { start, end: Math.max(start, Math.min(start + HORIZON_MS, last)) };
}

export function clampTime(t: number, range: TimeRange): number {
  return Math.min(range.end, Math.max(range.start, t));
}

export function snapToHour(t: number): number {
  return Math.round(t / HOUR_MS) * HOUR_MS;
}

/**
 * Ordre de préchargement (spec lot E §5.4) : de l'échéance de `t` vers l'avant jusqu'à celle qui
 * encadre `toMs` (fin de plage : rien au-delà, revue finale F5), puis vers l'arrière jusqu'à celle de `fromMs`.
 */
export function loadOrder(frames: readonly { valid_ms: number }[], t: number, fromMs: number, toMs: number): number[] {
  const n = frames.length;
  if (n === 0) return [];
  const a = framePair(frames, t).a;
  const floor = Math.min(a, framePair(frames, fromMs).a);
  const ceil = Math.max(a, framePair(frames, toMs).b);
  const order: number[] = [];
  for (let i = a; i <= ceil; i++) order.push(i);
  for (let i = a - 1; i >= floor; i--) order.push(i);
  return order;
}

/**
 * Paire effectivement affichable (spec lot E §5.4, repli) : la paire voulue si ses échéances sont
 * prêtes ; sinon l'échéance prête la plus proche de la plus proche des deux, sans mélange ;
 * `null` si aucune n'est prête.
 */
export function resolvePair(p: FramePair, ready: (i: number) => boolean, n: number): FramePair | null {
  if (ready(p.a) && (p.f === 0 || ready(p.b))) return p;
  const i = byDistance(nearestFrame(p), n).find(ready);
  return i === undefined ? null : { a: i, b: i, f: 0, clamped: p.clamped };
}

/**
 * Échéances de repli à tenter quand la paire voulue n'a pas pu être chargée (revue finale F1, spec
 * lot E §5.4) : au plus `max`, les plus proches de la cible d'abord (même ordre que `resolvePair`),
 * parmi celles que `usable` accepte.
 */
export function fallbackFrames(p: FramePair, n: number, usable: (i: number) => boolean, max: number): number[] {
  return byDistance(nearestFrame(p), n).filter(usable).slice(0, max);
}

/** Index de la frise par distance croissante à `target` (à égalité, le plus tôt d'abord). */
function byDistance(target: number, n: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < n; d++) {
    for (const i of d === 0 ? [target] : [target - d, target + d]) {
      if (i >= 0 && i < n) out.push(i);
    }
  }
  return out;
}

/** Échéance la plus proche de l'instant (légende : min/max de cette échéance). */
export function nearestFrame(p: FramePair): number {
  return p.f < 0.5 ? p.a : p.b;
}
