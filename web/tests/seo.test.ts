import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..");
const SITE = "https://globelayers.com";
const read = (path: string) => readFileSync(join(WEB, path), "utf8");
const html = read("index.html");

/** Contenu de `<meta name|property="key" content="…">`. */
function metaContent(source: string, key: string): string | null {
  const m = source.match(new RegExp(`<meta\\s+(?:name|property)="${key}"\\s+content="([^"]*)"`));
  return m ? m[1]! : null;
}

describe("référencement — <head> (spec site public §4)", () => {
  it("langue, titre, description courte", () => {
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>GlobeLayers — Live 3D Weather Globe</title>");
    const description = metaContent(html, "description")!;
    expect(description.length).toBeGreaterThan(80);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("canonical, robots, theme-color", () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE}/" />`);
    expect(metaContent(html, "robots")).toBe("index, follow");
    expect(metaContent(html, "theme-color")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("Open Graph et Twitter : URL absolues, image 1200 × 630", () => {
    expect(metaContent(html, "og:type")).toBe("website");
    expect(metaContent(html, "og:site_name")).toBe("GlobeLayers");
    expect(metaContent(html, "og:locale")).toBe("en_US");
    expect(metaContent(html, "og:url")).toBe(`${SITE}/`);
    expect(metaContent(html, "og:image")).toBe(`${SITE}/og.jpg`);
    expect(metaContent(html, "og:image:width")).toBe("1200");
    expect(metaContent(html, "og:image:height")).toBe("630");
    for (const key of ["og:title", "og:description", "og:image:alt", "twitter:title", "twitter:description"]) {
      expect(metaContent(html, key), key).toBeTruthy();
    }
    expect(metaContent(html, "twitter:card")).toBe("summary_large_image");
    expect(metaContent(html, "twitter:image")).toBe(`${SITE}/og.jpg`);
    expect(metaContent(html, "twitter:image:alt")).toBe(metaContent(html, "og:image:alt"));
  });

  it("icônes et manifeste", () => {
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />');
  });

  it("JSON-LD WebApplication parsable", () => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const ld = JSON.parse(m![1]!);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("WebApplication");
    expect(ld.name).toBe("GlobeLayers");
    expect(ld.url).toBe(`${SITE}/`);
    expect(ld.description).toBe(metaContent(html, "description"));
    expect(ld.applicationCategory).toBe("WeatherApplication");
    expect(ld.operatingSystem).toBe("Any");
    expect(ld.browserRequirements).toBe("Requires WebGL");
    expect(ld.inLanguage).toBe("en");
    expect(ld.isAccessibleForFree).toBe(true);
    expect(ld.offers.price).toBe("0");
    expect(ld.image).toBe(`${SITE}/og.jpg`);
  });
});

describe("référencement — fichiers statiques (spec site public §6)", () => {
  it("robots.txt autorise tout et cite le sitemap", () => {
    const robots = read("public/robots.txt");
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it("sitemap.xml : une URL, celle du canonical", () => {
    const locs = [...read("public/sitemap.xml").matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${SITE}/`]);
  });

  it("favicon.svg et manifeste", () => {
    expect(read("public/favicon.svg")).toContain("<svg");
    const manifest = JSON.parse(read("public/site.webmanifest"));
    expect(manifest.name).toBe("GlobeLayers");
    expect(manifest.display).toBe("browser");
    expect(manifest.icons.map((i: { src: string }) => i.src)).toEqual(["/favicon.svg", "/apple-touch-icon.png"]);
    expect(manifest.theme_color).toBe(metaContent(html, "theme-color"));
  });

  it("_headers : cache d'un jour pour les fichiers de référencement", () => {
    const headers = read("public/_headers");
    for (const path of ["/og.jpg", "/favicon.svg", "/apple-touch-icon.png", "/site.webmanifest", "/robots.txt", "/sitemap.xml"]) {
      expect(headers, path).toContain(`${path}\n  Cache-Control: public, max-age=86400`);
    }
  });

  it("aucun fichier statique en CRLF", () => {
    for (const path of ["public/robots.txt", "public/sitemap.xml", "public/favicon.svg", "public/site.webmanifest", "public/_headers"]) {
      expect(existsSync(join(WEB, path)), path).toBe(true);
      expect(read(path).includes("\r"), path).toBe(false);
    }
  });
});

describe("panneau About (spec site public §5)", () => {
  it("texte indexable dans le HTML initial", () => {
    for (const heading of ['<h1 id="about-title">GlobeLayers</h1>', "<h2>Layers</h2>", "<h2>Data &amp; freshness</h2>", "<h2>Sources &amp; credits</h2>", "<h2>Privacy</h2>"]) {
      expect(html, heading).toContain(heading);
    }
    expect(html).toContain("cookie-free audience measurement");
    expect(html).toContain('id="about-open"');
  });
});

/** Dimensions d'un JPEG : premier marqueur SOF0/SOF1/SOF2 (FFC0–FFC2). */
function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let o = 2;
  while (o + 9 < bytes.length) {
    if (bytes[o] !== 0xff) throw new Error("invalid JPEG marker");
    const marker = bytes[o + 1]!;
    const length = (bytes[o + 2]! << 8) | bytes[o + 3]!;
    if (marker >= 0xc0 && marker <= 0xc2) {
      return { height: (bytes[o + 5]! << 8) | bytes[o + 6]!, width: (bytes[o + 7]! << 8) | bytes[o + 8]! };
    }
    o += 2 + length;
  }
  throw new Error("no SOF marker");
}

describe("images de partage (spec site public §6)", () => {
  it("og.jpg : JPEG 1200 × 630, ≤ 150 Ko", () => {
    const bytes = readFileSync(join(WEB, "public/og.jpg"));
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect(bytes.length).toBeLessThanOrEqual(150_000);
    expect(jpegSize(bytes)).toEqual({ width: 1200, height: 630 });
  });
  it("apple-touch-icon.png : PNG 180 × 180", () => {
    const bytes = readFileSync(join(WEB, "public/apple-touch-icon.png"));
    expect(String.fromCharCode(bytes[1]!, bytes[2]!, bytes[3]!)).toBe("PNG");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(16)).toBe(180); // IHDR : largeur puis hauteur, gros-boutiste
    expect(view.getUint32(20)).toBe(180);
  });
});
