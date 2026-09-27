/**
 * Deux textures R8 fixes pour le fondu entre échéances (spec lot E §5.3) : la mémoire GPU des
 * couches ne dépend plus du nombre d'échéances. Les données arrivent nord en haut (CPU) et sont
 * recopiées sud en premier, l'ordre qu'avaient les ImageBitmap `flipY` (texture `flipY = false`).
 */
import * as THREE from "three";

export interface FrameImage {
  /** Identité de l'échéance (couche, run, échéance) : une clé déjà chargée n'est pas recopiée. */
  key: string;
  /** Canal R nord en haut, `width × height`. */
  data: Uint8Array;
}

interface Slot {
  texture: THREE.DataTexture;
  key: string | null;
}

export class FrameTextures {
  private readonly slots: [Slot, Slot];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.slots = [this.createSlot(), this.createSlot()];
  }

  /**
   * Lie la paire (A, B) ; `b` nul ou de même clé que `a` : A seule. Un emplacement qui porte déjà
   * la bonne clé est réutilisé — en lecture, l'ancienne B devient A sans recopie.
   */
  show(a: FrameImage, b: FrameImage | null): { a: THREE.Texture; b: THREE.Texture | null } {
    const second = b && b.key !== a.key ? b : null;
    let sa = this.slots.find((s) => s.key === a.key);
    let sb = second ? this.slots.find((s) => s.key === second.key && s !== sa) : undefined;
    if (!sa) {
      sa = this.slots.find((s) => s !== sb)!;
      this.upload(sa, a);
    }
    if (second && !sb) {
      sb = this.slots.find((s) => s !== sa)!;
      this.upload(sb, second);
    }
    return { a: sa.texture, b: sb ? sb.texture : null };
  }

  dispose(): void {
    for (const s of this.slots) s.texture.dispose();
  }

  private createSlot(): Slot {
    const t = new THREE.DataTexture(new Uint8Array(this.width * this.height), this.width, this.height, THREE.RedFormat, THREE.UnsignedByteType);
    t.unpackAlignment = 1; // 1440 est multiple de 4, mais le contrat ne l'impose pas
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.flipY = false;
    return { texture: t, key: null };
  }

  private upload(slot: Slot, img: FrameImage): void {
    const W = this.width;
    const H = this.height;
    if (img.data.length !== W * H) throw new Error(`frame of ${img.data.length} bytes, expected ${W * H}`);
    const dst = (slot.texture.image as { data: Uint8Array }).data;
    for (let y = 0; y < H; y++) dst.set(img.data.subarray((H - 1 - y) * W, (H - y) * W), y * W);
    slot.key = img.key;
    slot.texture.needsUpdate = true;
  }
}
