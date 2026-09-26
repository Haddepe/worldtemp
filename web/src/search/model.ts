/** État de la liste de résultats (spec lot F §5.2) : élément actif, clavier, requêtes périmées. Logique pure. */
import type { SearchResult } from "./index";

export type SearchAction = { type: "none" } | { type: "choose"; result: SearchResult } | { type: "close" };

const NONE: SearchAction = { type: "none" };

export class SearchModel {
  results: readonly SearchResult[] = [];
  active = -1;
  private ticket = 0;

  /** Avant chaque requête ; toute requête antérieure devient périmée. */
  begin(): number {
    return ++this.ticket;
  }

  /** Pose les résultats si `ticket` est la dernière requête ; renvoie `false` sinon. */
  accept(ticket: number, results: readonly SearchResult[]): boolean {
    if (ticket !== this.ticket) return false;
    this.results = results;
    this.active = results.length ? 0 : -1;
    return true;
  }

  key(key: string): SearchAction {
    const n = this.results.length;
    switch (key) {
      case "ArrowDown":
        if (n) this.active = (this.active + 1) % n;
        return NONE;
      case "ArrowUp":
        if (n) this.active = (this.active - 1 + n) % n;
        return NONE;
      case "Enter":
        return this.active >= 0 ? { type: "choose", result: this.results[this.active]! } : NONE;
      case "Escape":
        return { type: "close" };
      default:
        return NONE;
    }
  }
}
