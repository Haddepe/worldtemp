// Traînées de vent (spec vent §8) : positions déjà sur la sphère (rayon 1,002), alpha statique par slot.
attribute float aAlpha;
varying float vAlpha;

void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
