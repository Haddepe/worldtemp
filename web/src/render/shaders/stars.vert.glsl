// Étoiles à l'infini : seule la ROTATION de la caméra s'applique (mat3 de viewMatrix), jamais sa
// position — aucune parallaxe au zoom, et le ciel tourne avec l'orbite comme vu depuis l'espace.
attribute float aSize;
attribute vec3 aColor;
uniform float uPixelRatio;
varying vec3 vColor;

void main() {
  vColor = aColor;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  // z = 0 : milieu du volume de découpe, jamais rogné par near/far (qui suivent l'altitude) ;
  // la profondeur ne sert pas (depthTest et depthWrite coupés). w < 0 derrière la caméra : rogné.
  gl_Position = vec4(clip.xy, 0.0, clip.w);
  gl_PointSize = aSize * uPixelRatio;
}
