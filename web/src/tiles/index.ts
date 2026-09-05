/** Lecture de `index.bin` (spec tuiles §2). MIROIR PYTHON : tiler/encode.py TileIndex. */
import { tilesPerLevel } from "./grid";

export class IndexError extends Error {
  constructor(message: string) {
    super(`index.bin : ${message}`);
    this.name = "IndexError";
  }
}

const MAGIC = [0x57, 0x54, 0x49, 0x58]; // "WTIX"

export class TileIndex {
  private constructor(
    readonly maxLevel: number,
    private readonly levels: Uint8Array[],
  ) {}

  static parse(buf: ArrayBuffer): TileIndex {
    const b = new Uint8Array(buf);
    if (b.length < 6 || MAGIC.some((c, i) => b[i] !== c)) throw new IndexError("en-tête invalide");
    if (b[4] !== 1) throw new IndexError(`version ${b[4]} inconnue`);
    const maxLevel = b[5] as number;
    const levels: Uint8Array[] = [];
    let offset = 6;
    for (let z = 0; z <= maxLevel; z++) {
      const [cols, rows] = tilesPerLevel(z);
      const n = Math.ceil((cols * rows) / 8);
      if (offset + n > b.length) throw new IndexError(`niveau ${z} tronqué`);
      levels.push(b.subarray(offset, offset + n));
      offset += n;
    }
    return new TileIndex(maxLevel, levels);
  }

  has(z: number, x: number, y: number): boolean {
    const level = this.levels[z];
    if (!level) return false;
    const [cols] = tilesPerLevel(z);
    const i = y * cols + x;
    const byte = level[i >> 3];
    return byte !== undefined && ((byte >> (i & 7)) & 1) === 1;
  }
}
