import * as THREE from "three";

export interface Stop {
  /** Température en °C. */
  c: number;
  /** Couleur sRGB 0–255. */
  rgb: [number, number, number];
}

/**
 * Palette (spec §4 « Colormap ») : arrêts densifiés entre -45 et +45 °C, là où
 * vivent 99 % des pixels ; teintes extrêmes réservées aux queues.
 * SEULE source de vérité : la LUT GPU et le gradient CSS de la légende en
 * dérivent tous deux.
 */
export const STOPS: readonly Stop[] = [
  { c: -90, rgb: [30, 0, 50] }, // violet quasi-noir
  { c: -45, rgb: [10, 20, 110] }, // bleu foncé
  { c: -30, rgb: [20, 60, 200] }, // bleu
  { c: -15, rgb: [40, 190, 230] }, // cyan
  { c: 0, rgb: [40, 170, 70] }, // vert
  { c: 10, rgb: [240, 230, 40] }, // jaune
  { c: 20, rgb: [250, 150, 20] }, // orange
  { c: 30, rgb: [220, 30, 20] }, // rouge
  { c: 45, rgb: [120, 0, 10] }, // rouge foncé
  { c: 60, rgb: [90, 0, 70] }, // magenta foncé
];

export const LUT_SIZE = 256;

/** Couleur interpolée linéairement (sRGB) à la température `c`, bornée aux arrêts extrêmes. */
export function colorAt(stops: readonly Stop[], c: number): [number, number, number] {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) throw new Error("palette vide");
  if (c <= first.c) return [...first.rgb];
  if (c >= last.c) return [...last.rgb];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (c <= b.c) {
      const t = (c - a.c) / (b.c - a.c);
      return [
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t,
      ];
    }
  }
  return [...last.rgb];
}

/**
 * LUT 256 × 1 RGBA : le texel i représente la température
 * minC + i / 255 · (maxC − minC), soit exactement le décodage du PNG 8 bits.
 */
export function buildLut(stops: readonly Stop[], minC: number, maxC: number): Uint8Array {
  const out = new Uint8Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const c = minC + (i / (LUT_SIZE - 1)) * (maxC - minC);
    const [r, g, b] = colorAt(stops, c);
    out[i * 4] = Math.round(r);
    out[i * 4 + 1] = Math.round(g);
    out[i * 4 + 2] = Math.round(b);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Gradient CSS de la légende, construit depuis les mêmes arrêts. */
export function legendGradientCss(stops: readonly Stop[], minC: number, maxC: number): string {
  const parts = stops.map((s) => {
    const pct = ((s.c - minC) / (maxC - minC)) * 100;
    const p = Number.isInteger(pct) ? String(pct) : pct.toFixed(2);
    return `rgb(${s.rgb.join(", ")}) ${p}%`;
  });
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/**
 * Texture GPU de la LUT. `SRGBColorSpace` : les octets sont du sRGB, le GPU les
 * décode en linéaire à l'échantillonnage, ce qui rend le mix avec Blue Marble
 * (elle aussi sRGB décodée) cohérent avant la conversion de sortie.
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
