// Halo d'atmosphère : coque un peu plus grande que le globe, vue par sa face arrière. Le globe
// (opaque, dessiné avant) masque par la profondeur tout ce qui passe derrière lui : seul
// l'anneau qui dépasse du limbe reste visible.
varying vec3 vWorld;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
