import { describe, expect, it, vi } from "vitest";
import { paint } from "../src/capture/paint";

/** Contexte 2D factice : seules les méthodes que `paint` appelle. Sans `roundRect` = iOS < 16, Firefox < 112. */
function fakeCtx(withRoundRect: boolean) {
  const g = { addColorStop: vi.fn() };
  const ctx: Record<string, unknown> = {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), fill: vi.fn(),
    createLinearGradient: vi.fn(() => g), arc: vi.fn(), stroke: vi.fn(), strokeText: vi.fn(), fillText: vi.fn(),
  };
  if (withRoundRect) ctx.roundRect = vi.fn();
  return ctx as unknown as CanvasRenderingContext2D & { rect: ReturnType<typeof vi.fn>; roundRect?: ReturnType<typeof vi.fn> };
}

describe("paint — rectangles arrondis (revue finale capture)", () => {
  const ops = [
    { kind: "rect" as const, x: 0, y: 0, w: 10, h: 10, fill: "#000", radius: 2 },
    { kind: "gradient" as const, x: 0, y: 0, w: 10, h: 2, stops: [{ at: 0, color: "#000" }], radius: 1 },
  ];
  it("sans roundRect : repli sur rect, aucune exception", () => {
    const ctx = fakeCtx(false);
    expect(() => paint(ctx, ops)).not.toThrow();
    expect(ctx.rect).toHaveBeenCalledTimes(2);
  });
  it("avec roundRect : coins arrondis", () => {
    const ctx = fakeCtx(true);
    paint(ctx, ops);
    expect(ctx.roundRect).toHaveBeenCalledWith(0, 0, 10, 10, 2);
    expect(ctx.rect).not.toHaveBeenCalled();
  });
});
