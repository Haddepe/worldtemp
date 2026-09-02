uniform sampler2D uBaseMap;      // Blue Marble, sRGB décodée par le GPU
uniform sampler2D uHeatmap;      // PNG 8 bits, NoColorSpace : le texel est une donnée
uniform sampler2D uLut;          // 256×1, sRGB décodée par le GPU
uniform vec2 uGridSize;          // (1440, 721) depuis latest.json grid
uniform float uHeatmapOpacity;   // 0..1
uniform float uHasHeatmap;       // 0 tant qu'aucune texture valide n'est chargée
uniform vec3 uLightDir;          // espace vue, normalisé

varying vec2 vUv;
varying vec3 vNormal;

void main() {
  // Grille cellulaire (spec pipeline §4) : 1440 colonnes sans bouclage (u,
  // RepeatWrapping), 721 lignes pôles inclus (v). MIROIR TS : data/sampling.ts
  // (heatmapUv). Modifier l'un impose de modifier l'autre.
  vec2 hm = vec2(vUv.x + 0.5 / uGridSize.x,
                 1.0 - ((1.0 - vUv.y) * (uGridSize.y - 1.0) + 0.5) / uGridSize.y);
  float t = texture2D(uHeatmap, hm).r;             // 0..1, bilinéaire natif
  vec3 heat = texture2D(uLut, vec2(t, 0.5)).rgb;   // couleur linéaire
  vec3 base = texture2D(uBaseMap, vUv).rgb;        // couleur linéaire
  vec3 albedo = mix(base, heat, uHeatmapOpacity * uHasHeatmap);
  float lambert = max(dot(normalize(vNormal), uLightDir), 0.0);
  gl_FragColor = vec4(albedo * (0.25 + 0.75 * lambert), 1.0);
  #include <colorspace_fragment>
}
