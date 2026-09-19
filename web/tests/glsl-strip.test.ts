import { describe, expect, it } from "vitest";
import { stripGlslComments } from "../src/build/glsl";
import patchFrag from "../src/render/shaders/patch.frag.glsl?raw";

const lines = (s: string) => s.split("\n").length;

describe("stripGlslComments — retrait des commentaires GLSL (spec site public §3.1)", () => {
  it("commentaire de ligne seul : la ligne devient vide, elle ne disparaît pas", () => {
    expect(stripGlslComments("// bonjour\nvoid main() {}\n")).toBe("\nvoid main() {}\n");
  });

  it("commentaire en fin de ligne de code : le code reste, sans espace final", () => {
    expect(stripGlslComments("uniform float uSat;   // la tuile\n")).toBe("uniform float uSat;\n");
  });

  it("bloc multi-ligne : même nombre de lignes avant et après", () => {
    const source = "vec3 a;\n/* première ligne\n   deuxième ligne */\nvec3 b;\n";
    const stripped = stripGlslComments(source);
    expect(lines(stripped)).toBe(lines(source));
    expect(stripped).toBe("vec3 a;\n\n\nvec3 b;\n");
  });

  it("bloc au milieu d'une ligne : les jetons ne se recollent pas", () => {
    expect(stripGlslComments("vec4/* couleur */color;\n")).toBe("vec4 color;\n");
  });

  it("#include <colorspace_fragment> survit tel quel", () => {
    expect(stripGlslComments("  #include <colorspace_fragment>\n")).toContain("#include <colorspace_fragment>");
  });

  it("code sans commentaire : inchangé", () => {
    const source = "void main() {\n  gl_FragColor = vec4(1.0);\n}\n";
    expect(stripGlslComments(source)).toBe(source);
  });

  it("les espaces de fin de ligne partent même sans commentaire", () => {
    expect(stripGlslComments("vec3 a;  \t\nvec3 b;\n")).toBe("vec3 a;\nvec3 b;\n");
  });

  it("source vide : résultat vide", () => {
    expect(stripGlslComments("")).toBe("");
  });

  it("câblage : le shader importé en ?raw arrive déjà nettoyé", () => {
    expect(patchFrag).not.toContain("//");
    expect(patchFrag).not.toContain("/*");
    expect(patchFrag).not.toMatch(/[àâçèéêëîïôùûœ]/);
    expect(patchFrag).toContain("void main()");
  });
});
