/**
 * Lecture CPU de la heatmap (spec navigation §5) : l'ImageBitmap est créé `flipY` (sud en
 * ligne 0) ; le dessin re-retourne pour livrer des lignes nord en haut, comme le PNG du
 * pipeline. Un seul canvas réutilisé ; ≈ 4 Mo par rafraîchissement.
 */
type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

let canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let ctx: Ctx2D | null = null;

function context(width: number, height: number): Ctx2D | null {
  if (canvas && canvas.width === width && canvas.height === height) return ctx;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(width, height);
  } else {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
  }
  ctx = (canvas.getContext("2d", { willReadFrequently: true }) as Ctx2D | null) ?? null;
  return ctx;
}

/** RGBA, `width × height × 4`, nord en haut. `null` si aucun contexte 2D ou lecture impossible. */
export function bitmapPixels(bitmap: ImageBitmap): Uint8ClampedArray | null {
  try {
    const { width, height } = bitmap;
    const c = context(width, height);
    if (!c) return null;
    c.save();
    c.scale(1, -1);
    c.drawImage(bitmap, 0, -height);
    c.restore();
    return c.getImageData(0, 0, width, height).data;
  } catch (e) {
    console.warn("[worldtemp] lecture des pixels de la heatmap impossible :", e);
    return null;
  }
}
