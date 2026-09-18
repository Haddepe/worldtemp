/**
 * Adoucissement des couches à fronts raides (nuages : TCDC saute de 0 à 100 % entre cellules
 * voisines, et le Catmull-Rom du shader restitue fidèlement ces marches). Flou gaussien séparable
 * du canal R, une fois par PNG : bouclage en longitude, bornage en latitude. Logique pure.
 * Le tooltip lit toujours les pixels bruts — seul le rendu est adouci.
 */

/** Noyau normalisé, rayon ⌈3σ⌉. */
function kernel(sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma);
  const k = new Float32Array(2 * r + 1);
  let total = 0;
  for (let i = -r; i <= r; i++) total += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] = k[i]! / total;
  return k;
}

/**
 * `pixels` : RGBA `width × height × 4`, nord en haut (`data/pixels.ts`). Renvoie le canal R
 * flouté, `width × height`. `flipRows` livre les rangées sud en premier, ordre attendu par une
 * texture `flipY = false` alignée sur les ImageBitmap `flipY` du loader. `sigma` en cellules.
 */
export function blurRedChannel(
  pixels: Uint8ClampedArray, width: number, height: number, sigma: number, flipRows = false,
): Uint8Array {
  const W = width;
  const H = height;
  const out = new Uint8Array(W * H);
  if (!(sigma > 0)) {
    for (let y = 0; y < H; y++) {
      const o = (flipRows ? H - 1 - y : y) * W;
      for (let x = 0; x < W; x++) out[o + x] = pixels[(y * W + x) * 4]!;
    }
    return out;
  }
  const k = kernel(sigma);
  const r = (k.length - 1) / 2;
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += k[i + r]! * pixels[(row + ((((x + i) % W) + W) % W)) * 4]!;
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < H; y++) {
    const o = (flipRows ? H - 1 - y : y) * W;
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += k[i + r]! * tmp[Math.min(H - 1, Math.max(0, y + i)) * W + x]!;
      out[o + x] = Math.round(acc);
    }
  }
  return out;
}
