attribute vec2 lonlat;          // degrés, depuis tiles/patch.ts

varying vec2 vUv;               // 0..1 dans la tuille, v = 0 au sud
varying vec2 vLonLat;
varying vec3 vNormal;

void main() {
  vUv = uv;
  vLonLat = lonlat;
  vNormal = normalize(normalMatrix * normal);   // espace vue : la lumière suit la caméra
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
