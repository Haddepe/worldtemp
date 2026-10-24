/**
 * Rendu HTML des pages d'entrée (lot G, spec §4) à partir du gabarit `index.html`, qui reste la
 * source de l'accueil. Utilisé au build (`vite.config.ts`) ET dans le navigateur (tiroir, Read
 * more) : aucun module Node ici.
 */
import { PAGES, SITE, pagePath, type PageDef } from "../pages/registry";

export function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** JSON sûr dans un <script> : aucun `<` littéral, donc aucun `</script>` possible. */
function jsonValue(v: unknown): string {
  if (v !== null && typeof v === "object") {
    const parts = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${jsonValue(k)}: ${jsonValue(x)}`);
    return `{ ${parts.join(", ")} }`;
  }
  return JSON.stringify(v).replaceAll("<", "\\u003c");
}

/** Bloc JSON-LD complet, une clé par ligne, objets imbriqués sur une ligne (format du gabarit). */
function jsonLd(page: PageDef): string {
  const url = SITE + pagePath(page);
  const image = SITE + page.ogImage;
  const data: Record<string, unknown> =
    page.slug === ""
      ? {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "GlobeLayers",
          url,
          description: page.description,
          applicationCategory: "WeatherApplication",
          operatingSystem: "Any",
          browserRequirements: "Requires WebGL",
          inLanguage: "en",
          isAccessibleForFree: true,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          image,
        }
      : {
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: page.title,
          url,
          description: page.description,
          inLanguage: "en",
          image,
          isPartOf: { "@type": "WebApplication", name: "GlobeLayers", url: `${SITE}/` },
        };
  const lines = Object.entries(data).map(([k, v]) => `        ${jsonValue(k)}: ${jsonValue(v)}`);
  return `<script type="application/ld+json">\n      {\n${lines.join(",\n")}\n      }\n    </script>`;
}

function link(p: PageDef, current: PageDef | null): string {
  const cur = current !== null && p.slug === current.slug ? ' aria-current="page"' : "";
  return `<li><a href="${pagePath(p)}"${cur}>${escapeHtml(p.menuLabel)}</a></li>`;
}

/** HTML de la liste du tiroir (sections Maps, Regions ; Articles absente), aria-current sur `current`. */
export function renderDrawerNav(current: PageDef): string {
  const section = (title: string, kind: PageDef["kind"]) =>
    `<h2 class="drawer-section">${title}</h2><ul>${PAGES.filter((p) => p.kind === kind).map((p) => link(p, current)).join("")}</ul>`;
  return section("Maps", "layer") + section("Regions", "region");
}

/** HTML du corps « Read more » : <h2>, <p> par paragraphe, puis liste de liens `related`. */
export function renderMoreBody(page: PageDef): string {
  const related = page.related.map((slug) => {
    const p = PAGES.find((x) => x.slug === slug);
    if (!p) throw new Error(`unknown related page: ${slug}`);
    return link(p, null);
  });
  return (
    `<h2 id="more-title">${escapeHtml(page.h1)}</h2>` +
    page.body.map((para) => `<p>${escapeHtml(para)}</p>`).join("") +
    `<ul class="more-related" aria-label="Related maps">${related.join("")}</ul>`
  );
}

/** Remplace l'unique occurrence de `re` ; zéro ou plusieurs occurrences lèvent (gabarit modifié). */
function replaceOnce(html: string, re: RegExp, replacement: string): string {
  const global = new RegExp(re.source, "g");
  const count = html.match(global)?.length ?? 0;
  if (count !== 1) throw new Error(`template: ${count} matches for ${re.source}`);
  return html.replace(re, () => replacement);
}

function meta(html: string, attr: "name" | "property", key: string, value: string): string {
  const k = key.replaceAll(":", "\\:");
  return replaceOnce(html, new RegExp(`<meta ${attr}="${k}" content="[^"]*" />`), `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`);
}

function content(html: string, tag: string, id: string, inner: string): string {
  return replaceOnce(html, new RegExp(`<${tag} id="${id}">[\\s\\S]*?</${tag}>`), `<${tag} id="${id}">${inner}</${tag}>`);
}

/** Rend la page `page` à partir du gabarit index.html : remplace <title>, meta description,
 *  canonical, og:url/title/description/image/image:alt, twitter:*, le JSON-LD, et le contenu
 *  des éléments #summary-title, #summary-text, #more-body, #drawer-nav. Idempotent. */
export function renderPageHtml(template: string, page: PageDef): string {
  const url = SITE + pagePath(page);
  const image = SITE + page.ogImage;
  let html = replaceOnce(template, /<title>[^<]*<\/title>/, `<title>${escapeHtml(page.title)}</title>`);
  html = meta(html, "name", "description", page.description);
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`);
  html = meta(html, "property", "og:url", url);
  html = meta(html, "property", "og:title", page.title);
  html = meta(html, "property", "og:description", page.description);
  html = meta(html, "property", "og:image", image);
  html = meta(html, "property", "og:image:alt", page.ogAlt);
  html = meta(html, "name", "twitter:title", page.title);
  html = meta(html, "name", "twitter:description", page.description);
  html = meta(html, "name", "twitter:image", image);
  html = meta(html, "name", "twitter:image:alt", page.ogAlt);
  html = replaceOnce(html, /<script type="application\/ld\+json">[\s\S]*?<\/script>/, jsonLd(page));
  html = content(html, "h1", "summary-title", escapeHtml(page.h1));
  html = content(html, "p", "summary-text", escapeHtml(page.summary));
  html = content(html, "div", "more-body", renderMoreBody(page));
  html = content(html, "nav", "drawer-nav", renderDrawerNav(page));
  return html;
}

export function renderSitemap(pages: readonly PageDef[]): string {
  const urls = pages.map((p) => `  <url>\n    <loc>${escapeHtml(SITE + pagePath(p))}</loc>\n  </url>\n`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>\n`;
}
