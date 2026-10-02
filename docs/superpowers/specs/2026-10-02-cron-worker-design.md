# Spec — Déclenchement horaire du pipeline par un Worker Cloudflare (dette n° 62)

**Date :** 2026-10-02 · **Statut :** validée en brainstorming, à planifier
**Périmètre :** nouveau dossier `cron/` (Worker `worldtemp-cron`), `.github/workflows/test.yml`
(deux jobs ajoutés), `HISTORY.md`.
**Aucun changement** du pipeline Python (`pipeline/`), de `pipeline.yml` (son cron
`12 * * * *` et son `workflow_dispatch` restent tels quels), du Worker du site (`web/`), ni du
contrat R2.

## 1. Objectif

Dette n° 62 (HISTORY §8). Le cron `schedule` de `pipeline.yml` ne déclenche que 4 à 7 passages
par jour au lieu de 24 : 167 passages du 2026-09-02 au 2026-10-02, écart moyen 4,3 h,
maximum 8,6 h, minute de déclenchement répartie uniformément. C'est une limite documentée et
non corrigeable côté dépôt : GitHub retarde et **abandonne** des événements `schedule` sous
charge, et décaler la minute ou multiplier les lignes de cron n'aide presque pas (mesures
publiques, HISTORY §6 du 2026-10-02). Un `workflow_dispatch`, lui, démarre immédiatement.

**But :** le pipeline est déclenché **chaque heure à :55 UTC** par un cron trigger Cloudflare.
Le site suit chaque nouveau run GFS à moins de ~10 min de sa sortie complète sur NOMADS, au lieu
de 4 à 12 h aujourd'hui.

## 2. Décisions (validées par l'utilisateur le 2026-10-02, ne pas rouvrir)

| Décision | Pourquoi |
|---|---|
| **Worker Cloudflare qui appelle l'API `workflow_dispatch`**, plutôt que réparer le cron GitHub | Diagnostic : la cause est côté GitHub (§1). Le site est déjà sur Cloudflare ; les cron triggers sont inclus dans le plan gratuit (5 par compte, 10 ms de CPU par exécution, un seul `fetch` suffit). |
| **Worker séparé `worldtemp-cron` (dossier `cron/`)**, pas un script ajouté au Worker du site | Le Worker du site est sans script (assets seuls) ; y mêler le déclenchement lierait celui-ci au déploiement du site et mélangerait deux rôles. |
| **Token personnel fine-grained** (dépôt `worldtemp` seul, permission *Actions : Read and write*, expiration 1 an), pas une GitHub App | Un seul appel par heure : l'App (JWT signé, installation, token d'installation) coûterait bien plus de code et de pièces. Contrepartie : l'expiration, couverte par un rappel daté (§7). |
| **Toutes les heures à :55** (`55 * * * *`), pas de créneaux ciblés | Aucune couche ne change toutes les heures : GFS et GEFS-Aerosols sortent 4 runs par jour chacun, complets (f060) à **R + 3 h 48–50** et **R + 4 h 48–49** (horodatages NOMADS du 2026-10-02). Les deux finissent vers :50 : c'est la minute qui fixe le retard, pas la fréquence. L'horaire coûte 16 passages à vide par jour (~25 s chacun, minutes Actions gratuites sur dépôt public) et rattrape tout retard de NOAA à l'heure suivante, sans rien changer si NOAA décale ses horaires. |
| **Cron GitHub `12 * * * *` conservé en secours** | Si le Worker tombe (token expiré, API changée), on retrouve les 4 à 6 passages par jour actuels au lieu de zéro. Un double déclenchement est sans effet : le groupe `concurrency: pipeline` les met en file, et un passage sans nouveauté s'arrête en ~25 s. |
| **Surveillance passive** : exécution « failed » dans Cloudflare, bandeau « outdated » du site, rappel daté de l'expiration du token dans HISTORY | Une panne du Worker est sans gravité (le cron GitHub prend le relais). Une alerte active demanderait un service d'envoi de plus ; ouvrir une issue GitHub serait impossible avec un token expiré. |
| **Pas de nouvelle tentative dans une exécution** | Le passage suivant arrive une heure plus tard et le cron GitHub reste en secours : une reprise compliquerait le code pour un gain d'au plus une heure. |

## 3. Architecture

```
Cloudflare cron "55 * * * *"
        │
        ▼
Worker worldtemp-cron (cron/)            secret GITHUB_TOKEN
  scheduled() → dispatch()  ── POST api.github.com/repos/Haddepe/worldtemp/actions/workflows/pipeline.yml/dispatches
                                 {"ref": "master"}
        │
        ▼
GitHub Actions pipeline.yml (inchangé)   + cron GitHub "12 * * * *" en secours
```

### 3.1 Fichiers

| Fichier | Rôle |
|---|---|
| `cron/src/index.ts` | `export default { scheduled }` ; `dispatch(env, fetch)` exportée, pure à l'injection de `fetch` près ; constantes `OWNER = "Haddepe"`, `REPO = "worldtemp"`, `WORKFLOW = "pipeline.yml"`, `REF = "master"`, `API_VERSION = "2026-03-10"`, `TIMEOUT_MS = 10_000` |
| `cron/wrangler.jsonc` | `name: "worldtemp-cron"`, `main: "src/index.ts"`, `compatibility_date`, `triggers.crons: ["55 * * * *"]`, `workers_dev: false`, **aucune route**, `observability.enabled: true` |
| `cron/package.json`, `cron/package-lock.json`, `cron/tsconfig.json` | devDependencies `wrangler`, `vitest`, `typescript`, `@cloudflare/workers-types` ; scripts `test`, `typecheck`, `deploy` |
| `cron/tests/dispatch.test.ts` | tests de `dispatch()` (§6) |
| `cron/tests/config.test.ts` | test de `wrangler.jsonc` (§6) |

Constantes dans le code plutôt qu'en `vars` Wrangler : une seule valeur possible, rien à
configurer. Sans route ni `workers_dev`, le Worker n'a **aucune URL publique** et pas de handler
`fetch`.

## 4. Flux d'appel

Une exécution par heure :

```
POST https://api.github.com/repos/Haddepe/worldtemp/actions/workflows/pipeline.yml/dispatches
Authorization: Bearer <GITHUB_TOKEN>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10
User-Agent: worldtemp-cron
Content-Type: application/json

{"ref":"master"}
```

- `X-GitHub-Api-Version` épinglé : depuis `2026-03-10`, l'API répond **200** avec
  `workflow_run_id`, `run_url`, `html_url` ; l'ancienne version répondait **204** sans corps.
  Les deux valent succès.
- `User-Agent` est exigé par l'API GitHub.
- Délai réseau de 10 s par `AbortSignal.timeout(TIMEOUT_MS)`, passé en `signal`.

## 5. Erreurs

| Situation | Traitement |
|---|---|
| 200 (corps avec `workflow_run_id`) | `console.log("déclenché : run <id>")` |
| 204, ou 200 sans corps exploitable | `console.log("déclenché")` |
| 401 (token expiré ou invalide), 403/404 (permission, token non lié au dépôt), 422 (`ref` ou workflow invalide), 5xx | erreur levée : `workflow_dispatch refusé : HTTP <statut> — <200 premiers caractères du corps>` |
| délai dépassé, erreur réseau | erreur levée : `workflow_dispatch injoignable : <message>` |
| `GITHUB_TOKEN` absent ou vide | erreur levée **avant tout appel** : `GITHUB_TOKEN absent` |

- Une erreur levée dans `scheduled` marque l'exécution « failed » dans Cloudflare (logs
  Observability et onglet du Worker) : c'est la surveillance passive.
- **Le token n'apparaît jamais** dans un message ni un log.

## 6. Tests

Vitest dans `cron/`, environnement node, `fetch` injecté (ni réseau ni Cloudflare) :

1. **Appel conforme :** URL exacte, méthode `POST`, les 5 en-têtes ci-dessus (dont
   `Authorization: Bearer <token>`), corps `{"ref":"master"}`, `signal` présent.
2. **Succès :** 200 avec `workflow_run_id` (log avec l'id), 204 (log sans id), 200 sans corps
   JSON valide (succès quand même).
3. **Refus :** 401, 403, 404, 422, 500 → erreur levée contenant le statut ; le message **ne
   contient pas** le token.
4. **Injoignable :** `fetch` qui rejette (réseau, délai) → erreur levée ; message sans le token.
5. **Secret absent** (`undefined` et `""`) → erreur levée, `fetch` jamais appelé.
6. **Configuration :** `wrangler.jsonc` (commentaires retirés, parsé) déclare exactement
   `crons: ["55 * * * *"]`, `workers_dev: false`, ni `routes` ni `route`.

Plus `tsc --noEmit`.

## 7. CI, déploiement et mise en service

### 7.1 CI (`.github/workflows/test.yml`)

- **Job `cron`** : `working-directory: cron`, Node 24, `npm ci`, `npm run typecheck`, `npm test`
  — sur chaque push et PR, comme `test` et `web`.
- **Job `deploy-cron`** : `needs: [test, web, cron]`, même condition que `deploy` (push sur
  `master`), `npx wrangler deploy` dans `cron/` avec `CLOUDFLARE_API_TOKEN` et
  `CLOUDFLARE_ACCOUNT_ID` existants. Le job `deploy` du site est inchangé.
- `wrangler deploy` conserve les secrets déjà posés sur le Worker.

### 7.2 Mise en service, dans l'ordre

1. **Claude :** branche `feat/cron-worker`, TDD, CI verte sur la branche (pas de déploiement
   hors `master`).
2. **Utilisateur :** crée le token fine-grained (étapes exactes fournies par Claude) et
   communique sa **date d'expiration**, jamais le token.
3. **Claude :** HISTORY à jour (§8), merge, push de `master` → la CI crée `worldtemp-cron`.
4. **Utilisateur :** pose le secret `GITHUB_TOKEN` dans le dashboard Cloudflare (Workers &
   Pages → `worldtemp-cron` → Settings → Variables and Secrets). Le token ne transite ni par
   Claude ni par le dépôt. Une exécution à :55 survenue avant échoue (`GITHUB_TOKEN absent`),
   sans conséquence.
5. **Claude :** au :55 suivant, vérifie qu'un run `workflow_dispatch` apparaît dans
   `gh run list --workflow pipeline.yml` et que les logs du Worker montrent « déclenché » ;
   puis, sur 24 h, ~24 passages `workflow_dispatch`.

### 7.3 Retour arrière

`triggers.crons: []` dans `cron/wrangler.jsonc` puis déploiement, ou suppression du Worker :
on retombe sur le cron GitHub seul, sans autre effet.

## 8. HISTORY

§2 (service : cron trigger Cloudflare), §3 (dossier `cron/`), §5 (décisions du §2 avec leur
pourquoi), §7 (ligne de branche), §8 (dette n° 62 fermée ; **nouvelle dette datée « token
GitHub `worldtemp-cron` expire le <date> »** ; dette n° 57, qui suppose un passage horaire,
relue), §9 (entrée de session), pied de page.

## 9. Critères d'acceptation

1. Tests `cron/` verts, typecheck vert, CI verte sur `master` (jobs `cron` et `deploy-cron`).
2. Worker `worldtemp-cron` déployé, sans URL publique, cron `55 * * * *` visible dans
   Cloudflare.
3. Premier :55 après la pose du secret : un run `workflow_dispatch` de `pipeline.yml` démarre
   dans la minute, et le log du Worker l'annonce.
4. Sur les 24 h suivantes : au moins 22 passages `workflow_dispatch` à :55–:56 (tolérance pour
   un incident ponctuel).
5. Aucune trace du token dans le dépôt, la CI ou les logs.

## 10. Hors périmètre

- Alerte active (e-mail, notification) en cas d'échec du Worker.
- Rotation automatique du token ou passage à une GitHub App.
- Toute modification du pipeline Python ou de sa sélection des runs.
- Retrait du cron GitHub de `pipeline.yml`.
