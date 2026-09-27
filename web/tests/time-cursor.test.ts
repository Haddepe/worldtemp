import { describe, expect, it } from "vitest";
import { END_HOLD_MS, MAX_STEP_MS, PLAY_RATE, TimeCursor } from "../src/time/cursor";
import { HORIZON_MS, HOUR_MS } from "../src/time/timeline";

const START = Date.parse("2026-09-12T10:00:00Z");
const RANGE = { start: START, end: START + HORIZON_MS };
const NOW = START + 40 * 60_000; // 10:40
const all = () => true;

describe("TimeCursor — spec lot E §5.1, §7.1", () => {
  it("démarre en live, à l'heure courante", () => {
    const c = new TimeCursor(RANGE, NOW);
    expect(c.state).toMatchObject({ t: NOW, mode: "live", playing: false, buffering: false });
  });
  it("live suit l'heure à chaque nouvelle plage", () => {
    const c = new TimeCursor(RANGE, NOW);
    c.setRange(RANGE, NOW + 5 * 60_000);
    expect(c.state.t).toBe(NOW + 5 * 60_000);
  });
  it("seek : pause, mode fixed, arrondi à l'heure, borné à la plage", () => {
    const c = new TimeCursor(RANGE, NOW);
    c.seek(START + 3 * HOUR_MS + 20 * 60_000);
    expect(c.state).toMatchObject({ t: START + 3 * HOUR_MS, mode: "fixed", playing: false });
    c.seek(START + 100 * HOUR_MS);
    expect(c.state.t).toBe(RANGE.end);
  });
  it("fixed : un nouveau run garde l'heure absolue, ramenée dans la nouvelle plage", () => {
    const c = new TimeCursor(RANGE, NOW);
    c.seek(START + 5 * HOUR_MS);
    c.setRange({ start: START + HOUR_MS, end: START + 49 * HOUR_MS }, NOW + HOUR_MS);
    expect(c.state.t).toBe(START + 5 * HOUR_MS);
    c.setRange({ start: START + 6 * HOUR_MS, end: START + 54 * HOUR_MS }, NOW + 6 * HOUR_MS);
    expect(c.state.t).toBe(START + 6 * HOUR_MS);
  });
  it("goLive : retour à l'heure courante", () => {
    const c = new TimeCursor(RANGE, NOW);
    c.seek(START + 5 * HOUR_MS);
    c.goLive(NOW);
    expect(c.state).toMatchObject({ t: NOW, mode: "live" });
  });
  it("lecture : le premier tick amorce, puis 3 h par seconde", () => {
    const c = new TimeCursor(RANGE, NOW);
    c.play();
    expect(c.state).toMatchObject({ playing: true, mode: "fixed" });
    expect(c.tick(1000, all)).toBe(false);
    expect(c.tick(1050, all)).toBe(true);
    expect(c.state.t).toBeCloseTo(NOW + 50 * PLAY_RATE, 6);
    expect(PLAY_RATE * 1000).toBe(3 * HOUR_MS);
  });
  it("pas d'avance de plus de MAX_STEP_MS réelles par image (onglet revenu d'arrière-plan)", () => {
    const c = new TimeCursor(RANGE, NOW);
    c.play();
    c.tick(0, all);
    c.tick(60_000, all);
    expect(c.state.t).toBeCloseTo(NOW + MAX_STEP_MS * PLAY_RATE, 6);
  });
  it("échéance suivante pas prête : attente (buffering), sans avancer", () => {
    const c = new TimeCursor(RANGE, NOW);
    c.play();
    c.tick(0, all);
    expect(c.tick(50, () => false)).toBe(false);
    expect(c.state).toMatchObject({ t: NOW, buffering: true, playing: true });
    expect(c.tick(100, all)).toBe(true);
    expect(c.state.buffering).toBe(false);
  });
  it("fin de frise : pause d'END_HOLD_MS puis retour au début", () => {
    const r1 = { start: START, end: START + HOUR_MS };
    const c = new TimeCursor(r1, START);
    c.play();
    c.tick(0, all);
    let now = 0;
    while (c.state.t < r1.end) {
      now += 100; // 100 ms réelles = 18 min de prévision : 4 images pour 1 h
      c.tick(now, all);
    }
    expect(c.state.t).toBe(r1.end);
    expect(c.tick(now + END_HOLD_MS - 1, all)).toBe(false);
    expect(c.tick(now + END_HOLD_MS, all)).toBe(true);
    expect(c.state.t).toBe(r1.start);
    expect(c.state.playing).toBe(true);
  });
  it("play depuis la fin repart du début ; plage vide : pas de lecture", () => {
    const c = new TimeCursor(RANGE, NOW);
    c.seek(RANGE.end);
    c.play();
    expect(c.state.t).toBe(RANGE.start);
    const empty = new TimeCursor({ start: START, end: START }, NOW);
    empty.play();
    expect(empty.state.playing).toBe(false);
  });
  it("pause : garde t et le mode, plus aucun tick", () => {
    const c = new TimeCursor(RANGE, NOW);
    c.play();
    c.tick(0, all);
    c.tick(50, all);
    const t = c.state.t;
    c.pause();
    expect(c.tick(100, all)).toBe(false);
    expect(c.state).toMatchObject({ t, mode: "fixed", playing: false });
  });
});
