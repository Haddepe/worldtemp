/**
 * État du curseur temporel (spec lot E §5.1, §7.1) : instant, mode live/fixed, lecture. Logique
 * pure : l'appelant fournit l'heure (`nowMs`) et dit si les échéances d'un instant sont prêtes.
 */
import { HOUR_MS, type TimeRange, clampTime, snapToHour } from "./timeline";

/** Millisecondes de prévision par milliseconde réelle : 3 h par seconde (48 h ≈ 16 s). */
export const PLAY_RATE = (3 * HOUR_MS) / 1000;
/** Pause en fin de frise avant de reboucler. */
export const END_HOLD_MS = 1000;
/** Avance maximale par image, en temps réel : un onglet revenu d'arrière-plan ne saute pas. */
export const MAX_STEP_MS = 100;

export type CursorMode = "live" | "fixed";

export interface CursorState {
  t: number;
  mode: CursorMode;
  playing: boolean;
  /** Lecture en attente d'une échéance pas encore chargée. */
  buffering: boolean;
  range: TimeRange;
}

export class TimeCursor {
  private t: number;
  private mode: CursorMode = "live";
  private playing = false;
  private buffering = false;
  private last: number | null = null;
  private holdUntil: number | null = null;

  constructor(
    private range: TimeRange,
    nowMs: number,
  ) {
    this.t = clampTime(nowMs, range);
  }

  get state(): CursorState {
    return { t: this.t, mode: this.mode, playing: this.playing, buffering: this.buffering, range: this.range };
  }

  /** Nouvelle plage (manifeste neuf, minute qui passe) : live suit l'heure, fixed garde l'heure absolue, ramenée dans la plage. */
  setRange(range: TimeRange, nowMs: number): void {
    this.range = range;
    this.t = clampTime(this.mode === "live" ? nowMs : this.t, range);
  }

  /** Déplacement du curseur par l'utilisateur : pause, heure pleine. */
  seek(t: number): void {
    this.stop();
    this.mode = "fixed";
    this.t = clampTime(snapToHour(t), this.range);
  }

  goLive(nowMs: number): void {
    this.stop();
    this.mode = "live";
    this.t = clampTime(nowMs, this.range);
  }

  play(): void {
    if (this.range.end <= this.range.start) return;
    if (this.t >= this.range.end) this.t = this.range.start;
    this.mode = "fixed";
    this.playing = true;
    this.buffering = false;
    this.last = null;
    this.holdUntil = null;
  }

  pause(): void {
    this.stop();
  }

  /**
   * Une image d'animation. `settled(t)` : les échéances nécessaires à `t` sont prêtes ou en échec
   * (repli) — sinon on attend. Renvoie vrai si `t` a changé.
   */
  tick(nowMs: number, settled: (t: number) => boolean): boolean {
    if (!this.playing) return false;
    if (this.last === null) {
      this.last = nowMs;
      return false;
    }
    const dt = Math.min(nowMs - this.last, MAX_STEP_MS);
    this.last = nowMs;
    if (this.holdUntil !== null) {
      if (nowMs < this.holdUntil) return false;
      this.holdUntil = null;
      this.t = this.range.start;
      return true;
    }
    const next = Math.min(this.range.end, this.t + dt * PLAY_RATE);
    if (!settled(next)) {
      this.buffering = true;
      return false;
    }
    this.buffering = false;
    this.t = next;
    if (next >= this.range.end) this.holdUntil = nowMs + END_HOLD_MS;
    return true;
  }

  private stop(): void {
    this.playing = false;
    this.buffering = false;
    this.last = null;
    this.holdUntil = null;
  }
}
