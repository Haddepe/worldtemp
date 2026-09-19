/**
 * Retrait des commentaires GLSL (spec site public §3.1). Module de build : importé par
 * `vite.config.ts` seulement, jamais par le site — il n'entre pas dans le bundle.
 * Les sept shaders de `render/shaders/` sont importés en `?raw` ; leurs commentaires
 * restent en français dans les sources et sont retirés à la transformation.
 *
 * Fonction pure. GLSL n'a pas de littéraux de chaîne : deux barres obliques ou une barre
 * suivie d'une étoile ne peuvent qu'ouvrir un commentaire, aucun cas particulier n'est
 * nécessaire. Chaque saut de ligne est conservé (le nombre de lignes ne change pas : les
 * numéros de ligne des erreurs GLSL restent justes). Un commentaire en bloc laisse une
 * espace à sa place, comme le préprocesseur C, pour que deux jetons séparés par un bloc ne
 * se recollent pas. Les espaces de fin de ligne sont retirés ensuite, y compris un retour
 * chariot final : une source en CRLF ressort en LF, avec le même nombre de lignes.
 */
export function stripGlslComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (two === "/*") {
      i += 2;
      while (i < source.length && source.slice(i, i + 2) !== "*/") {
        if (source[i] === "\n") out += "\n";
        i++;
      }
      i = Math.min(i + 2, source.length);
      out += " ";
    } else {
      out += source[i];
      i++;
    }
  }
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t\r]+$/, ""))
    .join("\n");
}
