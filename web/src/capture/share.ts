/**
 * Partage ou téléchargement de l'image (spec capture §4.1). Feuille native seulement sur appareil
 * tactile : Chrome sous Windows accepte aussi les fichiers, et l'ordinateur ouvrirait la boîte de
 * partage du système au lieu de télécharger. Environnement injectable : testé sans navigateur.
 */
import { STRINGS } from "../i18n";

export type ShareOutcome = "shared" | "saved" | "cancelled";

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

export async function shareOrSave(blob: Blob, name: string, text: string, url: string, env: ShareEnv = browserShareEnv()): Promise<ShareOutcome> {
  const data: ShareData = { files: [new File([blob], name, { type: "image/png" })], title: STRINGS.capture.shareTitle, text, url };
  if (env.coarse && env.share && env.canShare?.(data)) {
    try {
      await env.share(data);
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // NotAllowedError (activation perdue pendant toBlob, iOS) ou autre : on télécharge quand même.
    }
  }
  env.download(blob, name);
  return "saved";
}
