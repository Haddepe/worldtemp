/** Worker de déclenchement du pipeline (spec cron-worker). Corps complet : tâche 2. */

export interface Env {
  GITHUB_TOKEN?: string;
}

export default {
  async scheduled(_controller: unknown, _env: Env): Promise<void> {
    throw new Error("dispatch pas encore implémenté");
  },
};
