import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";
import { CF_BEACON_TOKEN, beaconTag, injectBeacon } from "./src/build/beacon.ts";
import { stripGlslComments } from "./src/build/glsl.ts";
import { renderPageHtml, renderSitemap } from "./src/build/pages.ts";
import { PAGES, pagePath } from "./src/pages/registry.ts";

/**
 * Les shaders importés en `?raw` partiraient sinon dans le bundle avec leurs commentaires
 * français. Aucun `apply` : le plugin tourne en dev, sous Vitest et au build, pour qu'un défaut
 * du retrait casse les tests et pas seulement la production.
 */
function glslStrip(): Plugin {
  return {
    name: "worldtemp:glsl-strip",
    enforce: "pre",
    load(id) {
      if (!/\.glsl\?raw$/.test(id)) return;
      const stripped = stripGlslComments(readFileSync(id.replace(/\?raw$/, ""), "utf8"));
      return `export default ${JSON.stringify(stripped)}`;
    },
  };
}

/** Injecté au build de production seulement : `vite dev` et `localhost` ne sont pas comptés. */
function cloudflareBeacon(): Plugin {
  return {
    name: "worldtemp:cloudflare-beacon",
    apply: "build",
    transformIndexHtml: (html) => injectBeacon(html, beaconTag(CF_BEACON_TOKEN)),
  };
}

/**
 * Pages d'entrée (lot G) : au build, chaque page autre que l'accueil devient `<slug>/index.html`,
 * rendue depuis l'`index.html` final du bundle (scripts hachés, beacon), plus `sitemap.xml`.
 * `enforce: "post"` : l'asset index.html est émis par le plugin HTML de Vite, avant nous.
 * Pas d'`apply: "build"` : le même plugin porte le middleware de dev ; `generateBundle` ne
 * tourne de toute façon qu'au build.
 */
function landingPages(): Plugin {
  return {
    name: "worldtemp:pages",
    enforce: "post",
    // Dev : /rain-map/ sert l'accueil, le JS applique la page au démarrage (pas de rendu serveur).
    configureServer(server) {
      const paths = new Set(PAGES.slice(1).flatMap((p) => [pagePath(p), pagePath(p).slice(0, -1)]));
      server.middlewares.use((raw, _res, next) => {
        // Sans @types/node, IncomingMessage n'expose pas `url` au typage.
        const req = raw as unknown as { url?: string };
        const url = req.url ?? "/";
        const q = url.indexOf("?");
        const path = q < 0 ? url : url.slice(0, q);
        if (paths.has(path)) req.url = "/" + (q < 0 ? "" : url.slice(q));
        next();
      });
    },
    generateBundle(_, bundle) {
      const asset = bundle["index.html"];
      if (!asset || asset.type !== "asset") this.error("index.html missing from the bundle");
      const html = typeof asset.source === "string" ? asset.source : new TextDecoder().decode(asset.source);
      for (const page of PAGES.slice(1)) {
        this.emitFile({ type: "asset", fileName: `${page.slug}/index.html`, source: renderPageHtml(html, page) });
      }
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: renderSitemap(PAGES) });
    },
  };
}

export default defineConfig({
  // strictPort : le port 5173 est seul autorisé par le CORS du bucket R2 (localhost:5173) ; en cas
  // de conflit on veut une erreur, pas un serveur silencieusement inaccessible aux tuiles sur 5174.
  server: { strictPort: true },
  plugins: [glslStrip(), cloudflareBeacon(), landingPages()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
