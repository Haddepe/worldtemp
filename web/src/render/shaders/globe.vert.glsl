varying vec2 vUv;
varying vec3 vNormal;

void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal); // espace vue : la lumière suit la caméra
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
