/**
 * Capture (spec capture §3) : rendu WebGL explicite puis copie DANS LA MÊME TÂCHE — sans
 * `preserveDrawingBuffer` (coût permanent), le tampon n'est garanti lisible qu'avant le retour à
 * la boucle d'événements. Puis composition 2D et PNG.
 */
import type { SceneHandle } from "../render/scene";
import { composeCapture, type CaptureInput } from "./compose";
import { paint } from "./paint";

export type CaptureState = Omit<CaptureInput, "width" | "height" | "dpr">;

export function captureImage(scene: Pick<SceneHandle, "renderer" | "scene" | "camera">, state: CaptureState): Promise<Blob> {
  const src = scene.renderer.domElement;
  scene.renderer.render(scene.scene, scene.camera);
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d");
  if (!ctx) return Promise.reject(new Error("2D canvas unavailable"));
  ctx.drawImage(src, 0, 0);
  const dpr = src.clientWidth > 0 ? src.width / src.clientWidth : 1;
  const measure = (text: string, font: string): number => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  paint(ctx, composeCapture({ ...state, width: out.width, height: out.height, dpr }, measure));
  return new Promise((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), "image/png");
  });
}
