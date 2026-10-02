# Worker de déclenchement horaire du pipeline — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un Worker Cloudflare `worldtemp-cron` appelle chaque heure à :55 UTC l'API
`workflow_dispatch` de GitHub pour lancer `pipeline.yml`, à la place du cron GitHub qui ne
tient que 4 à 7 passages par jour (dette n° 62).

**Architecture:** nouveau dossier `cron/`, indépendant de `web/` : un handler `scheduled` qui
délègue à une fonction `dispatch(env, fetchFn, log)` testable sans réseau (`fetch` injecté).
Déployé par un nouveau job CI `deploy-cron` sur push de `master` ; secret `GITHUB_TOKEN` posé
une fois par l'utilisateur dans le dashboard Cloudflare. Pipeline Python, `pipeline.yml` et
Worker du site inchangés.

**Tech Stack:** TypeScript 5.9, Vitest 4 (environnement node), Wrangler 4, Node 24 en CI ;
API REST GitHub (version `2026-03-10`) ; cron triggers Cloudflare Workers.

**Spec:** `docs/superpowers/specs/2026-10-02-cron-worker-design.md` — à lire avec ce plan.

## Global Constraints

- Cron du Worker : exactement `55 * * * *` (UTC). Cron GitHub `12 * * * *` de `pipeline.yml` **non modifié**.
- Appel : `POST https://api.github.com/repos/Haddepe/worldtemp/actions/workflows/pipeline.yml/dispatches`, corps `{"ref":"master"}`.
- En-têtes : `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2026-03-10`, `User-Agent: worldtemp-cron`, `Content-Type: application/json`.
- Délai réseau : 10 s (`AbortSignal.timeout(10_000)`).
- Succès : HTTP 200 ou 204, rien d'autre. Pas de nouvelle tentative dans une exécution.
- Le token n'apparaît **jamais** dans un message d'erreur, un log, le dépôt ou la CI.
- Worker : `name: "worldtemp-cron"`, `workers_dev: false`, **aucune** `route`/`routes`, pas de handler `fetch`, `observability.enabled: true`.
- Versions alignées sur `web/` : `typescript ^5.9.0`, `vitest ^4.1.11`, `wrangler ^4.128.0` ; `compatibility_date` `2026-09-02` (celle de `web/wrangler.jsonc`).
- Code interne, commentaires, messages d'erreur et commits **en français** ; fichiers en **LF**.
- Chaque commit se termine par la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- La CI bloque le déploiement si `python tools/history_check.py` échoue : HISTORY à jour **avant** le push de `master`.

## Review Focus

- **Token collé avec un espace ou un saut de ligne** dans le dashboard → il est nettoyé (`trim`), l'en-tête `Authorization` reste valide (test T2 « token nettoyé »).
- **Erreur de `fetch` dont le message cite le token** (p. ex. en-tête invalide : undici recopie la valeur fautive) → le token est masqué en `***` dans l'erreur levée (test T2 « token masqué dans une erreur réseau »).
- **5xx de GitHub avec une page HTML de plusieurs Ko** → le message ne garde que les 200 premiers caractères du corps (test T2 « corps tronqué »).
- **200 au corps inattendu** (`workflow_run_id` absent, de type chaîne, JSON invalide) → succès, log sans identifiant (test T2 « 200 sans id exploitable »).
- **Jeton Cloudflare de la CI sans droit sur les cron triggers** → `deploy-cron` échoue en rouge sans toucher au déploiement du site (job séparé) ; vérifié en T4 étape 6.

---

## Structure des fichiers

| Fichier | Rôle | Tâche |
|---|---|---|
| `cron/package.json`, `cron/package-lock.json` | dépendances de dev, scripts `test`/`typecheck`/`deploy` | T1 |
| `cron/tsconfig.json` | typage strict, `lib` ES2022 + DOM (types `fetch`/`Response`), types `node` (tests) | T1 |
| `cron/wrangler.jsonc` | Worker `worldtemp-cron`, cron `55 * * * *`, sans URL publique | T1 |
| `cron/tests/config.test.ts` | garde mécanique sur `wrangler.jsonc` | T1 |
| `cron/src/index.ts` | `dispatch()` et handler `scheduled` | T1 (squelette), T2 |
| `cron/tests/dispatch.test.ts` | tests de `dispatch()` | T2 |
| `.gitignore` | `cron/dist/`, `cron/.wrangler/` | T1 |
| `.github/workflows/test.yml` | jobs `cron` et `deploy-cron` | T3 |
| `HISTORY.md` | §2, §3, §5, §7, §8, §9, pied de page | T4 |

---

### Task 1: Squelette `cron/` et garde de configuration

**Files:**
- Create: `cron/package.json`, `cron/tsconfig.json`, `cron/wrangler.jsonc`, `cron/src/index.ts`, `cron/tests/config.test.ts`
- Create (généré) : `cron/package-lock.json`
- Modify: `.gitignore` (section « Node / Vite »)

**Interfaces:**
- Consumes: rien.
- Produces: `cron/src/index.ts` exporte `interface Env { GITHUB_TOKEN?: string }` et un `export default { scheduled }` (corps provisoire, remplacé en T2) ; scripts npm `test` (`vitest run`), `typecheck` (`tsc --noEmit`), `deploy` (`wrangler deploy`).

- [ ] **Step 1: Créer `cron/package.json`**

```json
{
  "name": "worldtemp-cron",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.9.0",
    "vitest": "^4.1.11",
    "wrangler": "^4.128.0"
  }
}
```

- [ ] **Step 2: Créer `cron/tsconfig.json`**

Pas de `@cloudflare/workers-types` : le code n'utilise que `fetch`, `Response`, `RequestInit`, `AbortSignal` et `console`, fournis par `lib: DOM` ; `@types/node` sert au test de configuration (`node:fs`). Les deux paquets de types globaux Workers et Node se contredisent, on évite d'avoir à les concilier.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Installer les dépendances**

Run: `cd cron && npm install`
Expected: `cron/node_modules/` et `cron/package-lock.json` créés, 0 erreur.

- [ ] **Step 4: Écrire le test de configuration (échoue : pas de `wrangler.jsonc`)**

`cron/tests/config.test.ts` :

```ts
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
```

- [ ] **Step 5: Lancer le test pour le voir échouer**

Run: `cd cron && npx vitest run tests/config.test.ts`
Expected: FAIL avec `ENOENT: no such file or directory` sur `wrangler.jsonc`.

- [ ] **Step 6: Créer `cron/wrangler.jsonc`**

Commentaires sur des lignes à eux seuls uniquement (le test retire les lignes `//`).

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  // Déclenche pipeline.yml par workflow_dispatch chaque heure à :55 UTC (spec cron-worker §2).
  // Ni route ni workers.dev : aucune URL publique.
  "name": "worldtemp-cron",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-02",
  "triggers": { "crons": ["55 * * * *"] },
  "workers_dev": false,
  "observability": { "enabled": true }
}
```

- [ ] **Step 7: Créer le squelette `cron/src/index.ts`**

Corps provisoire, pour que `tsc` et `wrangler deploy --dry-run` aient un point d'entrée ; T2 le remplace.

```ts
/** Worker de déclenchement du pipeline (spec cron-worker). Corps complet : tâche 2. */

export interface Env {
  GITHUB_TOKEN?: string;
}

export default {
  async scheduled(_controller: unknown, _env: Env): Promise<void> {
    throw new Error("dispatch pas encore implémenté");
  },
};
```

- [ ] **Step 8: Ajouter les sorties locales au `.gitignore`**

Dans `.gitignore`, section `# Node / Vite`, après la ligne `web/.wrangler/`, ajouter :

```
cron/dist/
cron/.wrangler/
```

- [ ] **Step 9: Vérifier tests, typage et bundle**

Run: `cd cron && npm test && npm run typecheck && npx wrangler deploy --dry-run --outdir dist`
Expected: 3 tests PASS ; `tsc` sans erreur ; wrangler termine par `--dry-run: exiting now.` sans demander d'authentification, et `cron/dist/index.js` existe.

- [ ] **Step 10: Commit**

```bash
git add .gitignore cron/package.json cron/package-lock.json cron/tsconfig.json cron/wrangler.jsonc cron/src/index.ts cron/tests/config.test.ts
git commit -m "feat(cron): squelette du Worker worldtemp-cron et garde de configuration (dette n° 62)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `dispatch()` — appel `workflow_dispatch` et traitement des réponses

**Files:**
- Modify: `cron/src/index.ts` (remplacé en entier)
- Test: `cron/tests/dispatch.test.ts`

**Interfaces:**
- Consumes: `Env` (T1).
- Produces:
  - `export const DISPATCH_URL: string` = `https://api.github.com/repos/Haddepe/worldtemp/actions/workflows/pipeline.yml/dispatches`
  - `export type Fetch = (url: string, init: RequestInit) => Promise<Response>`
  - `export async function dispatch(env: Env, fetchFn: Fetch, log?: (message: string) => void): Promise<number | null>` — renvoie `workflow_run_id` ou `null` ; lève une `Error` sinon.
  - `export default { scheduled(_controller: unknown, env: Env): Promise<void> }` qui appelle `dispatch(env, fetch)`.

- [ ] **Step 1: Écrire les tests (échouent : `dispatch` n'existe pas)**

`cron/tests/dispatch.test.ts` :

```ts
import { describe, expect, it, vi } from "vitest";
import { DISPATCH_URL, dispatch, type Fetch } from "../src/index";

const TOKEN = "github_pat_SECRET123";

function respond(status: number, body = ""): Fetch {
  return vi.fn(async () => new Response(status === 204 ? null : body, { status }));
}

async function failure(env: { GITHUB_TOKEN?: string }, fetchFn: Fetch): Promise<Error> {
  try {
    await dispatch(env, fetchFn, () => {});
  } catch (exc) {
    return exc as Error;
  }
  throw new Error("dispatch aurait dû lever une erreur");
}

describe("dispatch — appel", () => {
  it("envoie POST, les cinq en-têtes, le corps et un délai réseau", async () => {
    const fetchFn = respond(204);
    await dispatch({ GITHUB_TOKEN: TOKEN }, fetchFn, () => {});

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/Haddepe/worldtemp/actions/workflows/pipeline.yml/dispatches");
    expect(url).toBe(DISPATCH_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "worldtemp-cron",
      "Content-Type": "application/json",
    });
    expect(init.body).toBe('{"ref":"master"}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("token nettoyé : espaces et saut de ligne collés depuis le dashboard", async () => {
    const fetchFn = respond(204);
    await dispatch({ GITHUB_TOKEN: `  ${TOKEN}\n` }, fetchFn, () => {});
    const [, init] = vi.mocked(fetchFn).mock.calls[0]!;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe("dispatch — succès", () => {
  it("200 avec workflow_run_id : renvoie l'id et le journalise", async () => {
    const log = vi.fn();
    const body = JSON.stringify({ workflow_run_id: 37032914266, run_url: "u", html_url: "h" });
    const id = await dispatch({ GITHUB_TOKEN: TOKEN }, respond(200, body), log);
    expect(id).toBe(37032914266);
    expect(log).toHaveBeenCalledWith("déclenché : run 37032914266");
  });

  it("204 sans corps : succès, journal sans id", async () => {
    const log = vi.fn();
    expect(await dispatch({ GITHUB_TOKEN: TOKEN }, respond(204), log)).toBeNull();
    expect(log).toHaveBeenCalledWith("déclenché");
  });

  it.each([
    ["JSON invalide", "pas du json"],
    ["id absent", "{}"],
    ["id en chaîne", '{"workflow_run_id":"42"}'],
    ["corps vide", ""],
  ])("200 sans id exploitable (%s) : succès, journal sans id", async (_cas, body) => {
    const log = vi.fn();
    expect(await dispatch({ GITHUB_TOKEN: TOKEN }, respond(200, body), log)).toBeNull();
    expect(log).toHaveBeenCalledWith("déclenché");
  });
});

describe("dispatch — échecs", () => {
  it.each([401, 403, 404, 422, 500])("HTTP %i : erreur avec le statut, sans le token", async (status) => {
    const err = await failure({ GITHUB_TOKEN: TOKEN }, respond(status, `{"message":"refus ${TOKEN}"}`));
    expect(err.message).toContain(`HTTP ${status}`);
    expect(err.message).toContain("workflow_dispatch refusé");
    expect(err.message).not.toContain(TOKEN);
  });

  it("corps tronqué : une page d'erreur HTML de plusieurs Ko ne garde que 200 caractères", async () => {
    const html = "<html>" + "x".repeat(5000) + "</html>";
    const err = await failure({ GITHUB_TOKEN: TOKEN }, respond(502, html));
    expect(err.message).toBe(`workflow_dispatch refusé : HTTP 502 — ${html.slice(0, 200)}`);
  });

  it("réseau ou délai dépassé : erreur « injoignable »", async () => {
    const fetchFn: Fetch = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const err = await failure({ GITHUB_TOKEN: TOKEN }, fetchFn);
    expect(err.message).toBe("workflow_dispatch injoignable : The operation was aborted due to timeout");
  });

  it("token masqué dans une erreur réseau qui le recopie", async () => {
    const fetchFn: Fetch = vi.fn(async () => {
      throw new TypeError(`Headers.append: "Bearer ${TOKEN}" is an invalid header value.`);
    });
    const err = await failure({ GITHUB_TOKEN: TOKEN }, fetchFn);
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).toContain("***");
  });

  it.each([
    ["absent", undefined],
    ["vide", ""],
    ["blanc", "  \n"],
  ])("secret %s : erreur avant tout appel", async (_cas, token) => {
    const fetchFn = respond(204);
    const err = await failure({ GITHUB_TOKEN: token }, fetchFn);
    expect(err.message).toBe("GITHUB_TOKEN absent");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd cron && npx vitest run tests/dispatch.test.ts`
Expected: FAIL — `dispatch` / `DISPATCH_URL` non exportés par `../src/index`.

- [ ] **Step 3: Implémenter `cron/src/index.ts` (remplace le squelette)**

```ts
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
```

- [ ] **Step 4: Lancer tous les tests et le typage**

Run: `cd cron && npm test && npm run typecheck && npx wrangler deploy --dry-run --outdir dist`
Expected: tous les tests PASS (3 de configuration + 19 de `dispatch`) ; `tsc` sans erreur ; dry-run wrangler OK.

- [ ] **Step 5: Commit**

```bash
git add cron/src/index.ts cron/tests/dispatch.test.ts
git commit -m "feat(cron): dispatch() lance pipeline.yml par workflow_dispatch, erreurs sans le token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: CI — jobs `cron` et `deploy-cron`

**Files:**
- Modify: `.github/workflows/test.yml` (insertion avant `  deploy:` et ajout en fin de fichier)

**Interfaces:**
- Consumes: scripts npm `typecheck`, `test` de `cron/package.json` (T1) ; `cron/package-lock.json`.
- Produces: job `cron` (chaque push/PR) ; job `deploy-cron` (push de `master`, après `test`, `web`, `cron`). Secrets utilisés : `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (existants).

- [ ] **Step 1: Ajouter le job `cron` juste avant la ligne `  deploy:`**

```yaml
  cron:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: cron
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
          cache-dependency-path: cron/package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - name: Bundle du Worker (sans déploiement)
        run: npx wrangler deploy --dry-run --outdir dist

```

- [ ] **Step 2: Ajouter le job `deploy-cron` en fin de fichier (après le job `deploy`)**

Job séparé de `deploy` : un échec du Worker de déclenchement ne bloque pas le déploiement du site.

```yaml

  deploy-cron:
    needs: [test, web, cron]
    if: github.event_name == 'push' && github.ref == 'refs/heads/master'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: cron
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
          cache-dependency-path: cron/package-lock.json
      - run: npm ci
      - name: Déploiement du Worker de déclenchement (worldtemp-cron)
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

- [ ] **Step 3: Vérifier la syntaxe YAML**

Run: `.venv/Scripts/python -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/test.yml',encoding='utf-8')); print(list(d['jobs']))"`
Expected: `['test', 'web', 'cron', 'deploy', 'deploy-cron']`

- [ ] **Step 4: Commit et push de la branche, CI verte**

```bash
git add .github/workflows/test.yml
git commit -m "ci(cron): jobs cron (tests, typage, bundle) et deploy-cron (master)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/cron-worker
gh run watch "$(gh run list --branch feat/cron-worker --workflow test.yml -L 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Expected: jobs `test`, `web`, `cron` verts ; `deploy` et `deploy-cron` **skipped** (pas `master`).

---

### Task 4: Mise en service (contrôleur + utilisateur, pas de sous-agent)

Tâche interactive : deux actions de l'utilisateur, aucune ne doit être faite à sa place.

**Files:**
- Modify: `HISTORY.md` (§2, §3, §5, §7, §8, §9, pied de page) — procédure du skill `updating-history`.

- [ ] **Step 1: Demander à l'utilisateur de créer le token** (il communique la **date d'expiration**, jamais le token)

Texte à lui donner :

> GitHub → avatar → **Settings** → **Developer settings** → **Personal access tokens** →
> **Fine-grained tokens** → **Generate new token**.
> - Token name : `worldtemp-cron`
> - Expiration : **Custom**, 1 an
> - Resource owner : `Haddepe`
> - Repository access : **Only select repositories** → `worldtemp`
> - Permissions → Repository permissions → **Actions : Read and write** (Metadata passe seul en Read-only)
> - **Generate token**, copie-le de côté (tu le colleras dans Cloudflare à l'étape 5), et donne-moi seulement sa date d'expiration.

- [ ] **Step 2: Mettre HISTORY à jour** (skill `updating-history`, partir du diff `master..feat/cron-worker`)

- §2 : ligne « Déclenchement du pipeline » — cron trigger Cloudflare `worldtemp-cron` (`55 * * * *`) → `workflow_dispatch` ; cron GitHub `12 * * * *` en secours.
- §3 : arbre `cron/` (`wrangler.jsonc`, `package.json`, `tsconfig.json`, `src/index.ts`, `tests/config.test.ts`, `tests/dispatch.test.ts`) ; ligne `test.yml` complétée (jobs `cron`, `deploy-cron`) ; ligne `pipeline.yml` (« cron GitHub minute 12, en secours du Worker `worldtemp-cron` »).
- §5 : les décisions de la spec §2 avec leur pourquoi (une ligne chacune, renvoi à la spec).
- §7 : ligne `feat/cron-worker` avec le sha du merge et le nombre de tests `cron/`.
- §8 : dette n° 62 → ✅ résolue (date, merge) ; **nouvelle dette n° 63 « token GitHub `worldtemp-cron` expire le <date de l'étape 1> »** (rappel daté, à renouveler un mois avant) ; dette n° 57 relue (« cron horaire » → « déclenchement horaire par `worldtemp-cron` ») ; résumé des dettes ouvertes en fin de §8 (62 retirée, 63 ajoutée).
- §9 : entrée datée de la session ; pied de page (nouvelle entrée en tête, l'ancienne rétrogradée).

Run: `python tools/history_check.py`
Expected: `✓ HISTORY.md est à jour`

- [ ] **Step 3: Merge et push de `master`** (après l'étape 2 : `history_check` bloque sinon le déploiement)

```bash
git checkout master
git merge --no-ff feat/cron-worker -m "Merge branch 'feat/cron-worker' — déclenchement horaire du pipeline par un Worker Cloudflare (dette n° 62)"
```

Reporter le sha du merge dans HISTORY §7/§9/pied de page, `python tools/history_check.py`, commit `docs(history): …`, puis :

```bash
git push origin master
gh run watch "$(gh run list --branch master --workflow test.yml -L 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Expected: `test`, `web`, `cron`, `deploy`, `deploy-cron` verts.

- [ ] **Step 4: Vérifier le Worker déployé**

Via le MCP Cloudflare (`workers_get_worker` sur `worldtemp-cron`) ou `cd cron && npx wrangler deployments list` : Worker présent ; dans le dashboard, onglet Settings → Triggers : cron `55 * * * *`, aucun domaine ni route.

- [ ] **Step 5: Demander à l'utilisateur de poser le secret**

> Cloudflare → **Workers & Pages** → `worldtemp-cron` → **Settings** → **Variables and Secrets** →
> **Add** → Type **Secret**, nom `GITHUB_TOKEN`, valeur = le token de l'étape 1 → **Deploy**.

- [ ] **Step 6: Vérifier le premier déclenchement** (au :55 suivant la pose du secret)

```bash
gh run list --workflow pipeline.yml -L 5
```

Expected: un run `workflow_dispatch` créé à :55–:56. Logs du Worker (MCP `query_worker_observability`, Worker `worldtemp-cron`) : `déclenché : run <id>` avec le même id. Si l'exécution est « failed » : lire le message (statut HTTP) — 401/403/404 → token ou permission, revoir l'étape 1 ; si `deploy-cron` a échoué à l'étape 3 (droits du jeton Cloudflare), le signaler à l'utilisateur, le site n'est pas touché.

- [ ] **Step 7: Vérifier sur 24 h** (critère d'acceptation 4 de la spec)

```bash
gh api "repos/Haddepe/worldtemp/actions/workflows/pipeline.yml/runs?event=workflow_dispatch&per_page=50" --jq '.workflow_runs[] | .created_at' | head -30
```

Expected: au moins 22 runs `workflow_dispatch` à :55–:56 sur les 24 h suivant l'étape 6. Résultat noté dans HISTORY §9 à la session suivante.
