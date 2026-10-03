/**
 * Partage ou enregistrement de l'image (spec capture §4.1, complété le 2026-10-03). Sur appareil
 * tactile capable de partager des fichiers, l'utilisateur choisit : feuille native, ou
 * téléchargement — sur Android il arrive dans `Download/`, que la Galerie et Google Photos
 * affichent (la feuille de partage d'Android n'a pas d'option « galerie »). Sur ordinateur :
 * téléchargement direct (Chrome sous Windows accepte aussi le partage de fichiers, d'où la garde
 * tactile). Environnement injectable : testé sans navigateur.
 */
import { STRINGS } from "../i18n";

export type ShareOutcome = "shared" | "saved" | "cancelled";
export type CaptureChoice = "share" | "save";

export interface ShareEnv {
  coarse: boolean;
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  download(blob: Blob, name: string): void;
}

export function browserShareEnv(): ShareEnv {
  return {
    coarse: matchMedia("(pointer: coarse)").matches,
    canShare: navigator.canShare?.bind(navigator),
    share: navigator.share?.bind(navigator),
    download(blob, name) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000); // laisser le téléchargement démarrer
    },
  };
}

export function shareData(blob: Blob, name: string, text: string, url: string): ShareData {
  return { files: [new File([blob], name, { type: "image/png" })], title: STRINGS.capture.shareTitle, text, url };
}

/** Choix offerts après la capture : le menu n'apparaît que s'il y en a deux. */
export function captureChoices(env: ShareEnv, data: ShareData): CaptureChoice[] {
  return env.coarse && env.share && env.canShare?.(data) ? ["share", "save"] : ["save"];
}

export function saveImage(blob: Blob, name: string, env: ShareEnv = browserShareEnv()): ShareOutcome {
  env.download(blob, name);
  return "saved";
}

export async function shareImage(blob: Blob, name: string, data: ShareData, env: ShareEnv = browserShareEnv()): Promise<ShareOutcome> {
  if (env.share) {
    try {
      await env.share(data);
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // NotAllowedError ou autre : on enregistre quand même plutôt que de perdre l'image.
    }
  }
  return saveImage(blob, name, env);
}
