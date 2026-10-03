/** Exécute les ordres de `compose.ts` sur un canvas 2D (pas de test : Vitest tourne sans canvas). */
import type { DrawOp } from "./compose";

function shape(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (r > 0) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export function paint(ctx: CanvasRenderingContext2D, ops: readonly DrawOp[]): void {
  for (const op of ops) {
    ctx.save();
    switch (op.kind) {
      case "rect":
        ctx.fillStyle = op.fill;
        shape(ctx, op.x, op.y, op.w, op.h, op.radius ?? 0);
        ctx.fill();
        break;
      case "gradient": {
        const g = ctx.createLinearGradient(op.x, 0, op.x + op.w, 0);
        for (const s of op.stops) g.addColorStop(Math.min(1, Math.max(0, s.at)), s.color);
        ctx.fillStyle = g;
        shape(ctx, op.x, op.y, op.w, op.h, op.radius ?? 0);
        ctx.fill();
        break;
      }
      case "dot":
        ctx.beginPath();
        ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
        ctx.fillStyle = op.fill;
        ctx.fill();
        ctx.lineWidth = op.strokeWidth;
        ctx.strokeStyle = op.stroke;
        ctx.stroke();
        break;
      case "text":
        ctx.font = op.font;
        ctx.textAlign = op.align;
        ctx.textBaseline = "middle";
        if (op.letterSpacing) ctx.letterSpacing = `${op.letterSpacing}px`; // ignoré par les navigateurs qui ne le gèrent pas
        if (op.halo && op.haloWidth) {
          // Équivalent du text-shadow CSS : contour arrondi sous le texte.
          ctx.lineJoin = "round";
          ctx.lineWidth = op.haloWidth;
          ctx.strokeStyle = op.halo;
          ctx.strokeText(op.text, op.x, op.y);
        }
        ctx.fillStyle = op.fill;
        ctx.fillText(op.text, op.x, op.y);
        break;
    }
    ctx.restore();
  }
}
