import { describe, expect, it, vi } from "vitest";
import { shareOrSave, type ShareEnv } from "../src/capture/share";

const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
const env = (over: Partial<ShareEnv>): ShareEnv => ({ coarse: true, canShare: () => true, share: vi.fn(async () => {}), download: vi.fn(), ...over });

describe("shareOrSave — feuille native sur tactile, sinon téléchargement", () => {
  it("tactile + canShare : partage avec le fichier, titre, texte et URL", async () => {
    const e = env({});
    expect(await shareOrSave(blob, "a.png", "Dust · now", "https://globelayers.com/?layer=dust", e)).toBe("shared");
    const data = (e.share as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ShareData;
    expect(data.title).toBe("GlobeLayers");
    expect(data.text).toBe("Dust · now");
    expect(data.url).toBe("https://globelayers.com/?layer=dust");
    expect(data.files![0]!.name).toBe("a.png");
    expect(data.files![0]!.type).toBe("image/png");
    expect(e.download).not.toHaveBeenCalled();
  });
  it("ordinateur (pointeur fin) : téléchargement même si le partage existe", async () => {
    const e = env({ coarse: false });
    expect(await shareOrSave(blob, "a.png", "t", "u", e)).toBe("saved");
    expect(e.share).not.toHaveBeenCalled();
    expect(e.download).toHaveBeenCalledWith(blob, "a.png");
  });
  it("canShare refuse les fichiers : téléchargement", async () => {
    const e = env({ canShare: () => false });
    expect(await shareOrSave(blob, "a.png", "t", "u", e)).toBe("saved");
  });
  it("API absente : téléchargement", async () => {
    const e = env({ share: undefined, canShare: undefined });
    expect(await shareOrSave(blob, "a.png", "t", "u", e)).toBe("saved");
  });
  it("annulation par l'utilisateur (AbortError) : rien d'autre", async () => {
    const e = env({ share: vi.fn(async () => { throw new DOMException("cancel", "AbortError"); }) });
    expect(await shareOrSave(blob, "a.png", "t", "u", e)).toBe("cancelled");
    expect(e.download).not.toHaveBeenCalled();
  });
  it("activation perdue (NotAllowedError, iOS après un await) : repli sur le téléchargement", async () => {
    const e = env({ share: vi.fn(async () => { throw new DOMException("no gesture", "NotAllowedError"); }) });
    expect(await shareOrSave(blob, "a.png", "t", "u", e)).toBe("saved");
    expect(e.download).toHaveBeenCalledWith(blob, "a.png");
  });
});
