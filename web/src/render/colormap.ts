import * as THREE from "three";
import { decode, encode, type Encoding } from "../data/encoding";
import type { LayerDef, Rgba, Stop } from "../layers/registry";

export const LUT_SIZE = 256;

/** Couleur RGBA interpolée linéairement (sRGB) à la valeur `v`, bornée aux arrêts extrêmes. */
export function colorAt(stops: readonly Stop[], v: number): Rgba {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) throw new Error("palette vide");
  if (v <= first.v) return [...first.rgba];
  if (v >= last.v) return [...last.rgba];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (v <= b.v) {
      const t = (v - a.v) / (b.v - a.v);
      return [0, 1, 2, 3].map((k) => a.rgba[k]! + (b.rgba[k]! - a.rgba[k]!) * t) as Rgba;
    }
  }
  return [...last.rgba];
}

/**
 * LUT 256 × 1 RGBA : le texel i représente la valeur decode(i) — exactement le
 * décodage du PNG 8 bits, linéaire ou racine. Le shader indexe par l'octet brut.
 */
export function buildLut(def: LayerDef, enc: Encoding): Uint8Array {
  const out = new Uint8Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const [r, g, b, a] = colorAt(def.stops, decode(i, enc));
    out[i * 4] = Math.round(r);
    out[i * 4 + 1] = Math.round(g);
    out[i * 4 + 2] = Math.round(b);
    out[i * 4 + 3] = Math.round(a);
  }
  return out;
}

function pct(v: number, enc: Encoding): string {
  const p = (encode(v, enc) / 255) * 100;
  return Number.isInteger(p) ? String(p) : p.toFixed(2).replace(/\.?0+$/, "");
}

/** Gradient CSS de la légende, mêmes arrêts, positions encode(v)/255 (non uniformes en racine). */
export function legendGradientCss(def: LayerDef, enc: Encoding): string {
  const parts = def.stops.map((st) => {
    const [r, g, b, a] = st.rgba;
    const alpha = Number((a / 255).toFixed(3));
    return `rgba(${r}, ${g}, ${b}, ${alpha}) ${pct(st.v, enc)}%`;
  });
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/**
 * Texture GPU de la LUT. `SRGBColorSpace` : les octets sont du sRGB, le GPU les
 * décode en linéaire à l'échantillonnage, cohérent avec les tuiles satellite.
 */
export function createLutTexture(lut: Uint8Array): THREE.DataTexture {
  const tex = new THREE.DataTexture(lut, LUT_SIZE, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
