// Composition d'un patch (spec tuiles §6). Un seul matériau partagé ; les uniforms de tuile
// (uSat*, uMap*) sont posés par mesh dans onBeforeRender (render/globe.ts).
uniform sampler2D uSat;          // Blue Marble (tuile ou ancêtre), sRGB décodée par le GPU
uniform vec4 uSatRect;           // offset.xy, scale.zw du sous-rectangle UV
uniform float uHasSat;
uniform sampler2D uMap;          // R ombrage, G terre, B frontière : données (NoColorSpace)
uniform vec4 uMapRect;
uniform float uHasMap;           // 0 = océan connu ou tuile pas encore arrivée
uniform sampler2D uHeatmap;      // PNG 8 bits global, NoColorSpace
uniform vec2 uGridSize;          // (1440, 721) depuis latest.json grid
uniform sampler2D uLut;          // 256×1, sRGB décodée par le GPU
uniform float uHasHeatmap;
uniform float uFilter;           // 1 = filtre Température actif
uniform float uMapStyle;         // 0 = satellite, 1 = style carte (fondu selon l'altitude)
uniform vec3 uLightDir;          // espace vue, normalisé

varying vec2 vUv;
varying vec2 vLonLat;
varying vec3 vNormal;

// Catmull-Rom en 9 prélèvements bilinéaires (spec §6), coordonnées en texels.
vec4 catmullRom(sampler2D tex, vec2 uv, vec2 texSize) {
  vec2 samplePos = uv * texSize;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 offset12 = w2 / w12;
  vec2 texPos0 = (texPos1 - 1.0) / texSize;
  vec2 texPos3 = (texPos1 + 2.0) / texSize;
  vec2 texPos12 = (texPos1 + offset12) / texSize;
  vec4 result = vec4(0.0);
  result += texture2D(tex, vec2(texPos0.x, texPos0.y)) * w0.x * w0.y;
  result += texture2D(tex, vec2(texPos12.x, texPos0.y)) * w12.x * w0.y;
  result += texture2D(tex, vec2(texPos3.x, texPos0.y)) * w3.x * w0.y;
  result += texture2D(tex, vec2(texPos0.x, texPos12.y)) * w0.x * w12.y;
  result += texture2D(tex, vec2(texPos12.x, texPos12.y)) * w12.x * w12.y;
  result += texture2D(tex, vec2(texPos3.x, texPos12.y)) * w3.x * w12.y;
  result += texture2D(tex, vec2(texPos0.x, texPos3.y)) * w0.x * w3.y;
  result += texture2D(tex, vec2(texPos12.x, texPos3.y)) * w12.x * w3.y;
  result += texture2D(tex, vec2(texPos3.x, texPos3.y)) * w3.x * w3.y;
  return result;
}

void main() {
  // Heatmap : UV équirectangulaire depuis lon/lat, puis grille cellulaire (spec pipeline §4).
  // MIROIR TS : data/sampling.ts (heatmapUv). Modifier l'un impose de modifier l'autre.
  vec2 eq = vec2((vLonLat.x + 180.0) / 360.0, (vLonLat.y + 90.0) / 180.0);
  vec2 hm = vec2(eq.x + 0.5 / uGridSize.x,
                 1.0 - ((1.0 - eq.y) * (uGridSize.y - 1.0) + 0.5) / uGridSize.y);
  float t = catmullRom(uHeatmap, hm, uGridSize).r;
  vec3 heat = texture2D(uLut, vec2(t, 0.5)).rgb;

  vec3 map = uHasMap > 0.5 ? texture2D(uMap, uMapRect.xy + vUv * uMapRect.zw).rgb : vec3(0.5, 0.0, 0.0);
  float shade = map.r;
  float land = map.g;
  float border = map.b;
  float tone = 0.8 + 0.6 * (shade - 0.5);
  float lambert = max(dot(normalize(vNormal), uLightDir), 0.0);

  vec3 color;
  if (uFilter > 0.5) {
    vec3 base = uHasHeatmap > 0.5 ? heat : vec3(0.5);
    color = base * mix(1.0, tone, land);
    color = mix(color, vec3(1.0), border * 0.7);
    color *= 0.85 + 0.15 * lambert;
  } else {
    vec3 sat = uHasSat > 0.5 ? texture2D(uSat, uSatRect.xy + vUv * uSatRect.zw).rgb : vec3(0.05, 0.10, 0.20);
    vec3 satCol = sat * (0.25 + 0.75 * lambert);
    vec3 mapCol = mix(vec3(0.72, 0.80, 0.88), vec3(0.85, 0.83, 0.78) * tone, land);
    color = mix(satCol, mapCol, uMapStyle);
    color = mix(color, vec3(1.0), border * mix(0.35, 0.7, uMapStyle));
  }
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
