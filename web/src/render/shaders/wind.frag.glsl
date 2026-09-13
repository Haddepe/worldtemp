// Blanc sur satellite, gris foncé sur style carte (même uMapStyle que patch.frag.glsl).
// Pas de colorspace_fragment : ces gris sont donnés directement en sRGB.
uniform float uMapStyle;
varying float vAlpha;

void main() {
  vec3 color = mix(vec3(1.0), vec3(0.15), uMapStyle);
  gl_FragColor = vec4(color, vAlpha * 0.8);
}
