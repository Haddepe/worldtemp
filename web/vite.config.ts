import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";
import { CF_BEACON_TOKEN, beaconTag } from "./src/build/beacon.ts";
import { stripGlslComments } from "./src/build/glsl.ts";

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
    transformIndexHtml: (html) => {
      const tag = beaconTag(CF_BEACON_TOKEN);
      return tag === "" ? html : html.replace("</body>", `  ${tag}\n  </body>`);
    },
  };
}

export default defineConfig({
  // strictPort : le port 5173 est seul autorisé par le CORS du bucket R2 (localhost:5173) ; en cas
  // de conflit on veut une erreur, pas un serveur silencieusement inaccessible aux tuiles sur 5174.
  server: { strictPort: true },
  plugins: [glslStrip(), cloudflareBeacon()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
