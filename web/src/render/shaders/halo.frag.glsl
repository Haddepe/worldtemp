// Lueur = fonction de la distance b entre le rayon de vue et le centre de la Terre (paramètre
// d'impact) : maximale contre le limbe (b = 1), décroissance exponentielle d'échelle uScale,
// comme une atmosphère vue par la tranche. Indépendant du maillage. Mélange additif : alpha =
// intensité. Pas de colorspace_fragment : couleur donnée en sRGB, comme le vent et les fleuves.
uniform vec3 uColor;
uniform float uIntensity;
uniform float uOpacity;
uniform float uScale;
uniform float uRadius;
varying vec3 vWorld;

void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  float b = length(cross(cameraPosition, dir));
  float h = max(b - 1.0, 0.0);
  float glow = exp(-h / uScale);
  // Fondu vers zéro au bord de la coque : pas de coupure nette là où le maillage s'arrête.
  float edge = 1.0 - smoothstep(0.7, 1.0, h / (uRadius - 1.0));
  gl_FragColor = vec4(uColor, uIntensity * uOpacity * glow * edge);
}
