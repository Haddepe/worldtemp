import { describe, expect, it } from "vitest";
import { beaconTag, injectBeacon } from "../src/build/beacon";

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

describe("injectBeacon — insertion dans index.html", () => {
  const HTML = "<html>\n  <body>\n    <p>hi</p>\n  </body>\n</html>\n";
  const TAG = '<script defer src="https://example.test/beacon.min.js"></script>';

  it("balise vide : le HTML est rendu inchangé", () => {
    expect(injectBeacon(HTML, "")).toBe(HTML);
  });

  it("balise non vide : insérée juste avant </body>", () => {
    expect(injectBeacon(HTML, TAG)).toBe(`<html>\n  <body>\n    <p>hi</p>\n    ${TAG}\n  </body>\n</html>\n`);
  });

  it("</body> absent : on lève plutôt que de perdre le beacon en silence", () => {
    expect(() => injectBeacon("<html></html>", TAG)).toThrowError("index.html has no </body>");
  });

  it("</body> absent mais balise vide : rien à insérer, rien à signaler", () => {
    expect(injectBeacon("<html></html>", "")).toBe("<html></html>");
  });
});
