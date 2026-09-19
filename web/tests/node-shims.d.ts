/**
 * Déclarations minimales pour `node:fs`/`node:path` et `__dirname`, utilisés par
 * `english.test.ts`. Le dépôt n'a pas `@types/node` (« aucune nouvelle dépendance ») ;
 * ce fichier ne couvre que les signatures effectivement appelées.
 */
declare const __dirname: string;

declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
}
