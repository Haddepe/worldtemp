// Fragment partagé (vent, fleuves) : élargit le segment [c0, c1] (espace clip) en quad de
// demi-largeur halfPx (pixels du tampon de dessin). corner.x = 0 | 1 le long du segment,
// corner.y = −1 | +1 en travers. Segment nul → normale nulle → quad d'aire nulle.
vec4 screenQuad(vec4 c0, vec4 c1, vec2 corner, float halfPx, vec2 viewport) {
  vec2 halfVp = 0.5 * viewport;
  vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * halfVp;
  float len = length(d);
  vec2 n = len > 1e-3 ? vec2(-d.y, d.x) / len : vec2(0.0);
  vec4 c = mix(c0, c1, corner.x);
  c.xy += n * (corner.y * halfPx) / halfVp * c.w;
  return c;
}
