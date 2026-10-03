import { describe, expect, it, vi } from "vitest";
import { captureChoices, saveImage, shareData, shareImage, type ShareEnv } from "../src/capture/share";

const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
const env = (over: Partial<ShareEnv>): ShareEnv => ({ coarse: true, canShare: () => true, share: vi.fn(async () => {}), download: vi.fn(), ...over });
const data = shareData(blob, "a.png", "Dust · now", "https://globelayers.com/?layer=dust");

describe("shareData — fichier, titre, texte, URL", () => {
  it("PNG nommé, titre GlobeLayers", () => {
    expect(data.title).toBe("GlobeLayers");
    expect(data.text).toBe("Dust · now");
    expect(data.url).toBe("https://globelayers.com/?layer=dust");
    expect(data.files![0]!.name).toBe("a.png");
    expect(data.files![0]!.type).toBe("image/png");
  });
});

describe("captureChoices — menu Share/Save sur tactile seulement", () => {
  it("tactile + canShare : partager ou enregistrer", () => {
    expect(captureChoices(env({}), data)).toEqual(["share", "save"]);
  });
  it("ordinateur (pointeur fin) : enregistrer seulement, même si le partage existe", () => {
    expect(captureChoices(env({ coarse: false }), data)).toEqual(["save"]);
  });
  it("canShare refuse les fichiers, ou API absente : enregistrer seulement", () => {
    expect(captureChoices(env({ canShare: () => false }), data)).toEqual(["save"]);
    expect(captureChoices(env({ share: undefined, canShare: undefined }), data)).toEqual(["save"]);
  });
});

describe("saveImage — téléchargement (Android : dossier Download, visible dans la Galerie)", () => {
  it("télécharge le PNG sous son nom", () => {
    const e = env({});
    expect(saveImage(blob, "a.png", e)).toBe("saved");
    expect(e.download).toHaveBeenCalledWith(blob, "a.png");
    expect(e.share).not.toHaveBeenCalled();
  });
});

describe("shareImage — feuille native", () => {
  it("partage les données telles quelles", async () => {
    const e = env({});
    expect(await shareImage(blob, "a.png", data, e)).toBe("shared");
    expect(e.share).toHaveBeenCalledWith(data);
    expect(e.download).not.toHaveBeenCalled();
  });
  it("annulation par l'utilisateur (AbortError) : rien d'autre", async () => {
    const e = env({ share: vi.fn(async () => { throw new DOMException("cancel", "AbortError"); }) });
    expect(await shareImage(blob, "a.png", data, e)).toBe("cancelled");
    expect(e.download).not.toHaveBeenCalled();
  });
  it("autre rejet (NotAllowedError) ou API absente : repli sur le téléchargement", async () => {
    const e = env({ share: vi.fn(async () => { throw new DOMException("no gesture", "NotAllowedError"); }) });
    expect(await shareImage(blob, "a.png", data, e)).toBe("saved");
    expect(e.download).toHaveBeenCalledWith(blob, "a.png");
    const none = env({ share: undefined });
    expect(await shareImage(blob, "a.png", data, none)).toBe("saved");
  });
});
