/**
 * Encodage 8 bits d'une couche (spec couches §6). MIROIR PYTHON :
 * pipeline/texture.py::quantize / dequantize. Modifier l'un impose de modifier l'autre.
 */
export interface Encoding {
  bits: number;
  min: number;
  max: number;
  scale: "linear" | "sqrt";
}

/** Valeur physique → octet 0–255 (borné). */
export function encode(v: number, enc: Encoding): number {
  const x = Math.min(1, Math.max(0, (v - enc.min) / (enc.max - enc.min)));
  return Math.round(255 * (enc.scale === "sqrt" ? Math.sqrt(x) : x));
}

/** Octet 0–255 → valeur physique. */
export function decode(i: number, enc: Encoding): number {
  const x = i / 255;
  return enc.min + (enc.max - enc.min) * (enc.scale === "sqrt" ? x * x : x);
}
