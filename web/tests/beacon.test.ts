import { describe, expect, it } from "vitest";
import { beaconTag } from "../src/build/beacon";

describe("beaconTag — Cloudflare Web Analytics (spec site public §7)", () => {
  it("jeton vide : rien n'est injecté", () => {
    expect(beaconTag("")).toBe("");
    expect(beaconTag("   ")).toBe("");
  });
  it("jeton présent : script différé, jeton dans data-cf-beacon", () => {
    const token = "0123456789abcdef0123456789abcdef";
    expect(beaconTag(token)).toBe(
      `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${token}"}'></script>`,
    );
  });
  it("jeton non hexadécimal : refusé plutôt qu'injecté dans le HTML", () => {
    expect(() => beaconTag('x"><script>')).toThrowError("invalid Cloudflare beacon token");
  });
});
