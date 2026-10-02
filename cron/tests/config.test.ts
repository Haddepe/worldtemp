import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Garde mécanique de la spec §3.1 : le Worker n'a ni URL publique ni autre cadence.
const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;

describe("wrangler.jsonc", () => {
  it("déclenche chaque heure à :55, et rien d'autre", () => {
    expect(config.triggers).toEqual({ crons: ["55 * * * *"] });
  });

  it("n'expose aucune URL publique", () => {
    expect(config.workers_dev).toBe(false);
    expect(config).not.toHaveProperty("routes");
    expect(config).not.toHaveProperty("route");
  });

  it("nomme le Worker et garde ses logs", () => {
    expect(config.name).toBe("worldtemp-cron");
    expect(config.main).toBe("src/index.ts");
    expect(config.observability).toEqual({ enabled: true });
  });
});
