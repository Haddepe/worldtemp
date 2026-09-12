/** LRU minimal : `capacity` entrées vivantes, l'éviction appelle `dispose()` (spec couches §10). */
export class LayerCache<T extends { dispose(): void }> {
  private readonly items = new Map<string, T>(); // ordre d'insertion = du moins au plus récent

  constructor(
    private readonly capacity: number,
    private readonly factory: (id: string) => T,
  ) {
    if (!(capacity >= 1)) throw new Error("capacité ≥ 1 attendue");
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  ids(): string[] {
    return [...this.items.keys()];
  }

  /** `pinned` (couche affichée) n'est jamais évincé ; si c'est le seul candidat, la capacité est
   * temporairement dépassée d'un plutôt que de disposer la texture en cours d'affichage. */
  get(id: string, pinned: string | null = null): T {
    let it = this.items.get(id);
    if (it) {
      this.items.delete(id); // re-insertion en fin = plus récent
    } else {
      it = this.factory(id);
      while (this.items.size >= this.capacity) {
        const oldest = [...this.items.keys()].find((k) => k !== pinned);
        if (oldest === undefined) break; // seul(s) restant(s) : l'id épinglé
        this.items.get(oldest)!.dispose();
        this.items.delete(oldest);
      }
    }
    this.items.set(id, it);
    return it;
  }

  dispose(): void {
    for (const it of this.items.values()) it.dispose();
    this.items.clear();
  }
}
