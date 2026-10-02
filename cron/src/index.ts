/** Worker de déclenchement du pipeline (spec cron-worker) : le cron GitHub ne tient que 4 à 7
 *  passages par jour, ce Worker lance pipeline.yml par workflow_dispatch chaque heure à :55. */

export interface Env {
  GITHUB_TOKEN?: string;
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const OWNER = "Haddepe";
const REPO = "worldtemp";
const WORKFLOW = "pipeline.yml";
const REF = "master";
const API_VERSION = "2026-03-10"; // épinglée : 200 + workflow_run_id (204 sans corps avant)
const TIMEOUT_MS = 10_000;
const BODY_EXCERPT = 200;

export const DISPATCH_URL = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;

/** Lance pipeline.yml ; renvoie l'id du run créé (null si la réponse n'en donne pas).
 *  Lève une erreur sur tout autre statut que 200/204 : l'exécution du cron passe alors
 *  « failed » dans Cloudflare (surveillance passive, spec §5). Le token n'est jamais cité. */
export async function dispatch(env: Env, fetchFn: Fetch, log: (message: string) => void = console.log): Promise<number | null> {
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_TOKEN absent");
  const hide = (text: string): string => text.split(token).join("***");

  let response: Response;
  try {
    response = await fetchFn(DISPATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "worldtemp-cron",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: REF }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (exc) {
    const reason = exc instanceof Error ? exc.message : String(exc);
    throw new Error(hide(`workflow_dispatch injoignable : ${reason}`));
  }

  const body = await response.text().catch(() => "");
  if (response.status !== 200 && response.status !== 204) {
    throw new Error(hide(`workflow_dispatch refusé : HTTP ${response.status} — ${body.slice(0, BODY_EXCERPT)}`));
  }
  const runId = runIdOf(body);
  log(runId === null ? "déclenché" : `déclenché : run ${runId}`);
  return runId;
}

function runIdOf(body: string): number | null {
  try {
    const id: unknown = (JSON.parse(body) as { workflow_run_id?: unknown } | null)?.workflow_run_id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await dispatch(env, fetch);
  },
};
