import { describe, expect, it } from "vitest";
import { decideTier, type TierInputs } from "../src/gpu/tier";

const desktop: TierInputs = {
  urlSearch: "",
  rendererName: null,
  hardwareConcurrency: 8,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  devicePixelRatio: 1,
};

describe("decideTier", () => {
  it("?tier=low prime sur tout", () => {
    const d = decideTier({ ...desktop, urlSearch: "?tier=low", rendererName: "NVIDIA GeForce RTX 4090" });
    expect(d.tier).toBe("low");
    expect(d.reason).toMatch(/url/i);
  });

  it("?tier=high prime sur tout", () => {
    const d = decideTier({ ...desktop, urlSearch: "?foo=1&tier=high", hardwareConcurrency: 2 });
    expect(d.tier).toBe("high");
  });

  it.each([
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)", "high"],
    ["Apple M2", "high"],
    ["AMD Radeon RX 6700 XT", "high"],
    ["Intel(R) Arc(TM) A770", "high"],
    ["Intel(R) Iris(R) Xe Graphics", "high"],
    ["Mali-T860", "low"],
    ["Mali-450 MP", "low"],
    ["Adreno (TM) 530", "low"],
    ["Adreno 418", "low"],
    ["PowerVR Rogue GE8320", "low"],
  ])("nom GPU « %s » → %s", (name, tier) => {
    expect(decideTier({ ...desktop, rendererName: name }).tier).toBe(tier);
  });

  it("GPU inconnu et extension absente : 4 cœurs → low", () => {
    const d = decideTier({ ...desktop, hardwareConcurrency: 4 });
    expect(d.tier).toBe("low");
    expect(d.reason).toMatch(/hardwareConcurrency/);
  });

  it("GPU inconnu : 8 cœurs desktop → high", () => {
    expect(decideTier(desktop).tier).toBe("high");
  });

  it("mobile avec dpr < 2 → low, mobile avec dpr 3 → high", () => {
    const mobile = { ...desktop, userAgent: "Mozilla/5.0 (Linux; Android 13) Mobile", hardwareConcurrency: 8 };
    expect(decideTier({ ...mobile, devicePixelRatio: 1.5 }).tier).toBe("low");
    expect(decideTier({ ...mobile, devicePixelRatio: 3 }).tier).toBe("high");
  });

  it("nom GPU reconnu prime sur l'heuristique", () => {
    expect(decideTier({ ...desktop, rendererName: "Apple GPU", hardwareConcurrency: 2 }).tier).toBe("high");
  });
});
