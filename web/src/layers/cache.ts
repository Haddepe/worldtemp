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

  get(id: string): T {
    let it = this.items.get(id);
    if (it) {
      this.items.delete(id); // re-insertion en fin = plus récent
    } else {
      it = this.factory(id);
      while (this.items.size >= this.capacity) {
        const oldest = this.items.keys().next().value as string;
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
