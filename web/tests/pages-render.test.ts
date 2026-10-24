import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderMoreBody, renderPageHtml, renderSitemap } from "../src/build/pages";
import { PAGES, SITE, pagePath, type PageDef } from "../src/pages/registry";

const html = readFileSync(join(__dirname, "..", "index.html"), "utf8");

function metaContent(source: string, key: string): string | null {
  const m = source.match(new RegExp(`<meta\\s+(?:name|property)="${key}"\\s+content="([^"]*)"`));
  return m ? m[1]! : null;
}

/** Contenu de l'élément d'id `id` (balise `tag`, sans imbrication de même balise). */
function inner(source: string, tag: string, id: string): string {
  const m = source.match(new RegExp(`<${tag} id="${id}"[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) throw new Error(`#${id} absent`);
  return m[1]!;
}

const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

describe("rendu des pages (lot G, spec §4)", () => {
  it("l'accueil rendu égale index.html", () => {
    expect(renderPageHtml(html, PAGES[0]!)).toBe(html);
  });

  it("le rendu est idempotent", () => {
    for (const page of PAGES) {
      const once = renderPageHtml(html, page);
      expect(renderPageHtml(once, page), page.slug).toBe(once);
    }
  });

  it.each(PAGES.map((p) => ({ ...p, name: p.slug || "accueil" })))("$name : en-tête, résumé, Read more, tiroir", (page) => {
    const out = renderPageHtml(html, page);
    const url = SITE + pagePath(page);
    expect(out.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(out).toContain(`<title>${esc(page.title)}</title>`);
    expect(out).toContain(`<link rel="canonical" href="${url}" />`);
    expect(metaContent(out, "description")).toBe(esc(page.description));
    expect(metaContent(out, "og:url")).toBe(url);
    expect(metaContent(out, "og:image")).toBe(SITE + page.ogImage);
    expect(metaContent(out, "twitter:image")).toBe(SITE + page.ogImage);
    expect(metaContent(out, "og:title")).toBe(esc(page.title));
    expect(metaContent(out, "og:image:alt")).toBe(esc(page.ogAlt));
    const ld = JSON.parse(out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!);
    expect(ld.description).toBe(page.description);
    expect(ld.url).toBe(url);
    expect(ld["@type"]).toBe(page.slug === "" ? "WebApplication" : "WebPage");
    expect(inner(out, "h1", "summary-title")).toContain(esc(page.h1));
    expect(inner(out, "p", "summary-text")).toBe(esc(page.summary));
    const more = inner(out, "div", "more-body");
    expect(more).toContain('<h2 id="more-title">');
    for (const para of page.body) expect(more).toContain(`<p>${esc(para)}</p>`);
    for (const slug of page.related) expect(more).toContain(`href="/${slug}/"`);
    const nav = inner(out, "nav", "drawer-nav");
    for (const p of PAGES.slice(1)) expect(nav).toContain(`href="/${p.slug}/"`);
    expect(nav.match(/href="/g)).toHaveLength(16);
    const current = [...nav.matchAll(/<a href="([^"]*)" aria-current="page">/g)].map((m) => m[1]);
    expect(current).toEqual(page.slug === "" ? [] : [pagePath(page)]);
    expect(nav.match(/aria-current/g)?.length ?? 0).toBe(page.slug === "" ? 0 : 1);
  });

  it("une page autre que l'accueil : JSON-LD WebPage rattaché à l'application", () => {
    const out = renderPageHtml(html, PAGES[4]!);
    const ld = JSON.parse(out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!);
    expect(ld).toEqual({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: PAGES[4]!.title,
      url: `${SITE}/rain-map/`,
      description: PAGES[4]!.description,
      inLanguage: "en",
      image: `${SITE}/og/rain-map.jpg`,
      isPartOf: { "@type": "WebApplication", name: "GlobeLayers", url: `${SITE}/` },
    });
  });

  it("échappement", () => {
    const fake: PageDef = { ...PAGES[1]!, title: 'A <b> & "c"', body: ["x < y & z"] };
    const out = renderPageHtml(html, fake);
    expect(out).toContain("<title>A &lt;b&gt; &amp; &quot;c&quot;</title>");
    expect(renderMoreBody(fake)).toContain("<p>x &lt; y &amp; z</p>");
    // Le JSON-LD ne doit pas pouvoir fermer sa balise <script>.
    const ld = out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!;
    expect(ld).not.toContain("<");
    expect(JSON.parse(ld).name).toBe('A <b> & "c"');
  });

  it("un gabarit sans un élément attendu lève", () => {
    expect(() => renderPageHtml(html.replace('id="drawer-nav"', 'id="x"'), PAGES[1]!)).toThrow();
    expect(() => renderPageHtml(html.replace("<title>", "<title>a</title><title>"), PAGES[1]!)).toThrow();
  });
});

describe("sitemap (lot G)", () => {
  const xml = renderSitemap(PAGES);

  it("17 URL, l'accueil en premier, toutes avec barre finale", () => {
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]!);
    expect(locs).toHaveLength(17);
    expect(locs[0]).toBe(`${SITE}/`);
    expect(locs).toEqual(PAGES.map((p) => SITE + pagePath(p)));
    for (const loc of locs) expect(loc.endsWith("/"), loc).toBe(true);
  });

  it("XML bien formé en LF", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.endsWith("</urlset>\n")).toBe(true);
    expect(xml.includes("\r")).toBe(false);
  });
});
