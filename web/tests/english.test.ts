import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { stripGlslComments } from "../src/build/glsl";

/**
 * Garde-fou « tout ce qui est livré est en anglais » (spec site public §8.1). Seuls les littéraux
 * de chaîne sont contrôlés : les commentaires restent en français. Découpage volontairement
 * simple (commentaires | littéraux) : un littéral d'expression régulière contenant un guillemet
 * le tromperait — aucun dans `src/` aujourd'hui. Les shaders et les fichiers statiques sont
 * livrés tels quels : pour eux le contrôle porte sur le texte entier.
 */
const WEB = join(__dirname, "..");
const SRC = join(WEB, "src");
const SHADERS = join(SRC, "render", "shaders");
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
      "avec", "pour", "dans", "sans", "les", "des", "une", "est", "et", "ou", "du", "au", "aux",
      "le", "la", "de", "pas", "vide", "racine", "depuis", "entre", "taille", "erreur", "fichier",
    ].join("|") +
    ")\\b",
  "i",
);

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

  it.each(files)("$rel : aucun littéral français", ({ path }) => {
    expect(frenchLiterals(readFileSync(path, "utf8"))).toEqual([]);
  });

  it("index.html : aucun texte français", () => {
    const html = readFileSync(join(WEB, "index.html"), "utf8");
    expect(html).toContain('<html lang="en">');
    expect(html.match(FRENCH_LETTER)).toBeNull();
    expect(html.match(FRENCH_WORD)).toBeNull();
  });

  const statics = ["public/robots.txt", "public/sitemap.xml", "public/site.webmanifest", "public/favicon.svg"];

  it.each(statics)("%s : aucun texte français", (rel) => {
    const text = readFileSync(join(WEB, rel), "utf8");
    expect(text.match(FRENCH_LETTER)).toBeNull();
    expect(text.match(FRENCH_WORD)).toBeNull();
  });

  const shaders = readdirSync(SHADERS).filter((name) => name.endsWith(".glsl"));

  it("les onze shaders sont bien contrôlés (un dossier vide ferait passer it.each à vide)", () => {
    expect(shaders).toHaveLength(11);
  });

  it.each(shaders)("%s : rien de français ne survit au retrait des commentaires", (name) => {
    const source = readFileSync(join(SHADERS, name), "utf8");
    const stripped = stripGlslComments(source);
    expect(stripped.match(FRENCH_LETTER)).toBeNull();
    expect(stripped.match(FRENCH_WORD)).toBeNull();
    expect(stripped.split("\n").length).toBe(source.split("\n").length);
  });
});
