/**
 * Beacon Cloudflare Web Analytics (spec site public §7). Module de build : importé par
 * `vite.config.ts` seulement, jamais par le site — il n'entre pas dans le bundle.
 * Le jeton est public par nature (il est lu dans le HTML de la page).
 */
export const CF_BEACON_TOKEN = "5e96332c41944b9586f926c1ac44f884";

export function beaconTag(token: string): string {
  const t = token.trim();
  if (t === "") return "";
  if (!/^[0-9a-f]{32}$/i.test(t)) throw new Error("invalid Cloudflare beacon token");
  return `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${t}"}'></script>`;
}

/**
 * Insère `tag` juste avant `</body>`. Une balise vide (pas de jeton) laisse le HTML intact ;
 * un `</body>` manquant lève, sinon le beacon disparaîtrait sans bruit du site déployé.
 */
export function injectBeacon(html: string, tag: string): string {
  if (tag === "") return html;
  if (!html.includes("</body>")) throw new Error("index.html has no </body>");
  return html.replace("</body>", `  ${tag}\n  </body>`);
}
