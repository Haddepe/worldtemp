// Blanc sur satellite, gris foncé sur style carte (même uMapStyle que patch.frag.glsl), avec un
// fin liseré de teinte opposée : le trait reste lisible sur les couches claires (température
// jaune-orange) comme sur l'océan sombre.
// Pas de colorspace_fragment : ces gris sont donnés directement en sRGB.
uniform float uMapStyle;
uniform float uWidthPx;
uniform float uPixelRatio;
varying float vAlpha;
varying float vDist;

void main() {
  float a = abs(vDist);
  float w = 0.5 * uWidthPx;
  float core = 1.0 - smoothstep(w - 0.5, w + 0.5, a);
  float outer = 1.0 - smoothstep(w + uPixelRatio - 0.5, w + uPixelRatio + 0.5, a);
  vec3 line = mix(vec3(1.0), vec3(0.15), uMapStyle);
  vec3 rim = mix(vec3(0.0), vec3(1.0), uMapStyle);
  gl_FragColor = vec4(mix(rim, line, core), vAlpha * mix(0.3 * outer, 0.85, core));
}
