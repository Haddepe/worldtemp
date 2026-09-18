// Bleu-cyan clair sur satellite, bleu soutenu en style carte (où l'eau est déjà bleu pâle) :
// distinct du blanc des frontières. Pas de colorspace_fragment : couleurs données en sRGB.
uniform float uMapStyle;
uniform float uWidthPx;
varying float vAlpha;
varying float vDist;

void main() {
  float w = 0.5 * uWidthPx;
  float core = 1.0 - smoothstep(w - 0.5, w + 0.5, abs(vDist));
  vec3 color = mix(vec3(0.55, 0.82, 1.0), vec3(0.25, 0.50, 0.85), uMapStyle);
  gl_FragColor = vec4(color, 0.8 * vAlpha * core);
}
