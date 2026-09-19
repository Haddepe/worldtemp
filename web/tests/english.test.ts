import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou « tout ce qui est livré est en anglais » (spec site public §8.1). Seuls les littéraux
 * de chaîne sont contrôlés : les commentaires restent en français. Découpage volontairement
 * simple (commentaires | littéraux) : un littéral d'expression régulière contenant un guillemet
 * le tromperait — aucun dans `src/` aujourd'hui.
 */
const WEB = join(__dirname, "..");
const SRC = join(WEB, "src");
const TOKEN = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const FRENCH_LETTER = /[àâçèéêëîïôùûœÀÂÇÈÉÊËÎÏÔÙÛŒ«»]/;
const FRENCH_WORD = new RegExp(
  "\\b(" +
    [
      "indisponibles?", "vent", "pluie", "nuages", "couches?", "calme", "recharger", "attendue?s?",
      "invalide", "introuvable", "lignes?", "niveau", "tuiles?", "manifeste", "sur", "valide",
      "il y a", "aucune?", "villes", "pays", "fleuves", "grille", "octets?", "rang", "champs?", "doit",
      "hors", "lecture", "chargement", "isolignes", "poussi", "humidit", "pression",
      "inconnue?s?", "illisibles?", "inattendue?s?", "tampon", "repli",
    ].join("|") +
    ")\\b",
  "i",
);

/** Fichiers pas encore convertis : chaque tâche retire les siens ; vide à la fin de T3. */
const PENDING: string[] = [
  "data/loader.ts", "data/manifest.ts", "data/pixels.ts", "geo/loader.ts", "geo/wiring.ts", "gpu/tier.ts",
  "labels/data.ts", "layers/cache.ts", "main.ts", "render/wind.ts", "rivers/data.ts", "tiles/grid.ts",
  "tiles/index.ts", "tiles/loader.ts", "tiles/manifest.ts", "ui/layers-menu.ts", "ui/overlay.ts",
  "wind/loader.ts", "wind/sim.ts",
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tsFiles(path) : name.endsWith(".ts") ? [path] : [];
  });
}

function frenchLiterals(source: string): string[] {
  return (source.match(TOKEN) ?? [])
    .filter((t) => !t.startsWith("//") && !t.startsWith("/*"))
    .filter((t) => FRENCH_LETTER.test(t) || FRENCH_WORD.test(t));
}

describe("tout ce qui est livré est en anglais (spec site public §3.1)", () => {
  const files = tsFiles(SRC).map((path) => ({ path, rel: relative(SRC, path).replaceAll("\\", "/") }));

  it.each(files.filter((f) => !PENDING.includes(f.rel)))("$rel : aucun littéral français", ({ path }) => {
    expect(frenchLiterals(readFileSync(path, "utf8"))).toEqual([]);
  });

  it("la liste PENDING ne cite que des fichiers existants", () => {
    const known = new Set(files.map((f) => f.rel));
    expect(PENDING.filter((p) => !known.has(p))).toEqual([]);
  });
});
