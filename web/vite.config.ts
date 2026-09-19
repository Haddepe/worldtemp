import { defineConfig, type Plugin } from "vitest/config";
import { CF_BEACON_TOKEN, beaconTag } from "./src/build/beacon.ts";

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
  plugins: [cloudflareBeacon()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
