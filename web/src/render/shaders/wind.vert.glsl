// Traînées de vent (spec vent §8) : un quad par segment, élargi en pixels dans l'espace écran
// par screenQuad (shaders/screen-quad.glsl, préfixé par render/wind.ts).
// aStart / aEnd : extrémités déjà sur la sphère (rayon 1,002), lues dans le tampon de la simulation.
attribute vec3 aStart;
attribute vec3 aEnd;
uniform float uCount;      // N particules
uniform float uTrail;      // K slots
uniform vec2 uViewport;    // pixels du tampon de dessin
uniform float uWidthPx;    // largeur du trait, pixels du tampon
uniform float uPixelRatio;
varying float vAlpha;
varying float vDist;       // distance à l'axe du trait, pixels du tampon

void main() {
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
  // Demi-largeur du quad : trait + liseré (1 px CSS) + 1 px d'anti-crénelage.
  float halfQuad = 0.5 * uWidthPx + uPixelRatio + 1.0;
  gl_Position = screenQuad(c0, c1, position.xy, halfQuad, uViewport);
  vDist = position.y * halfQuad;
  // Instance j = k·N + i : alpha k/(K−1) au début du segment, (k+1)/(K−1) à la fin (0 en queue, 1 en tête).
  float k = floor((float(gl_InstanceID) + 0.5) / uCount);
  vAlpha = (k + position.x) / (uTrail - 1.0);
}
