// Fleuves (spec repères §5) : segments statiques au rayon 1,001, élargis par screenQuad
// (shaders/screen-quad.glsl, préfixé par render/rivers.ts).
attribute vec3 aStart;
attribute vec3 aEnd;
attribute float aRank;
uniform vec2 uViewport;   // pixels du tampon de dessin
uniform float uWidthPx;   // largeur du trait, pixels du tampon
uniform float uMaxRank;   // rang admis, flottant : le dernier rang entre en fondu
varying float vAlpha;
varying float vDist;

void main() {
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
  float halfQuad = 0.5 * uWidthPx + 1.0; // + 1 px d'anti-crénelage
  gl_Position = screenQuad(c0, c1, position.xy, halfQuad, uViewport);
  vDist = position.y * halfQuad;
  // Horizon exact pour un point à rayon R (même seuil que wind/sim.ts::isVisible) : sans lui, une
  // bande de surface juste derrière le limbe se dessinerait hors du disque du globe.
  float d = length(cameraPosition);
  float R = length(aStart);
  float thr = (1.0 + sqrt(max(0.0, d * d - 1.0) * max(0.0, R * R - 1.0))) / (d * R);
  float front = step(thr, dot(aStart, cameraPosition) / (d * R));
  vAlpha = front * clamp(uMaxRank - aRank + 1.0, 0.0, 1.0);
}
