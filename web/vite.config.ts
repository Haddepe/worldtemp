import { defineConfig } from "vitest/config";

export default defineConfig({
  // strictPort : le port 5173 est seul autorisé par le CORS du bucket R2 (localhost:5173) ; en cas
  // de conflit on veut une erreur, pas un serveur silencieusement inaccessible aux tuiles sur 5174.
  server: { strictPort: true },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
