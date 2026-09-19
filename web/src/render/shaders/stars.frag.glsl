// Point rond à bord doux. Mélange additif sur le fond noir : alpha = intensité. Pas de
// colorspace_fragment : couleurs données en sRGB, comme le vent et les fleuves.
varying vec3 vColor;

void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float alpha = 1.0 - smoothstep(0.35, 1.0, r);
  gl_FragColor = vec4(vColor, alpha);
}
