import * as THREE from "three";
import type { Tier } from "../gpu/tier";
import { type TileId, subRect, tileBounds, tileKey, tileSpan } from "../tiles/grid";
import { type ViewState, mapStyleFor, selectTiles } from "../tiles/lod";
import type { TileLoader } from "../tiles/loader";
import type { ForestChannels } from "../tiles/manifest";
import { buildPatchGeometry } from "../tiles/patch";
import fragmentShader from "./shaders/patch.frag.glsl?raw";
import vertexShader from "./shaders/patch.vert.glsl?raw";

/** Profils par tier (spec tuiles §5 « Tiers »). */
export const TIER_PROFILE: Record<Tier, { maxLevel: number; segments: number; budgetBytes: number; concurrency: number; k: number }> = {
  high: { maxLevel: 8, segments: 32, budgetBytes: 256 * 1024 * 1024, concurrency: 8, k: 1 },
  low: { maxLevel: 7, segments: 16, budgetBytes: 96 * 1024 * 1024, concurrency: 4, k: 1.5 },
};

/** Niveau forêt le plus fin lu par tier (lot R5c) : 9 (archives profondes) en `high`, 8 en `low`. */
export const FOREST_TIER_LEVEL: Record<Tier, number> = { high: 9, low: 8 };

export interface TiledGlobe {
  group: THREE.Group;
  /**
   * Échéances de la couche active (spec lot E §6.1) : A, et B mélangée à `mix` ∈ [0, 1] ; `a` nul =
   * mode « Aucune » (satellite/carte seuls). Sans `b`, pas de mélange (seconde série de lectures sautée).
   */
  setLayer(a: THREE.Texture | null, width: number, height: number, b?: THREE.Texture | null, mix?: number): void;
  setLut(lut: THREE.DataTexture): void;
  /** Pas des isolignes en unités de `t` (octet/255) ; 0 = désactivé. */
  setIsoStep(step: number): void;
  /** Blue Marble 4K locale, équirectangulaire, utilisée quand aucune tuile `sat` n'est disponible (repli). */
  setFallbackSat(texture: THREE.Texture | null): void;
  setMaxLevel(level: number): void;
  /** Niveau le plus fin sous Forest (lot R5c, `ForestSource.deepMaxLevel`) : la sélection descend jusqu'à
   * `max(levelCap, level)` quand Forest est allumée ; `sat`/`map` se lisent alors sur l'ancêtre. */
  setForestMaxLevel(level: number): void;
  /**
   * Couche Forest (spec forêt §7) : allumée, le jeu `forest` est chargé et composé par-dessus le fond
   * à la place de la couche météo (laissée telle quelle, elle revient à l'extinction).
   */
  setForest(on: boolean): void;
  /** LUT 256 × 2 de la forêt (render/colormap `buildForestLut`), canaux et côté des tuiles (manifeste forêt). */
  setForestPalette(lut: THREE.DataTexture, channels: ForestChannels, tileSize?: number): void;
  /** Sélection, chargement et mise à jour des meshes pour cette vue. Renvoie le nombre de patches affichés. */
  update(view: ViewState): number;
  dispose(): void;
}

interface PatchUniforms {
  sat: THREE.Texture | null;
  satRect: THREE.Vector4;
  map: THREE.Texture | null;
  mapRect: THREE.Vector4;
  forest: THREE.Texture | null;
  forestRect: THREE.Vector4;
}

const ZERO_RECT = new THREE.Vector4(0, 0, 1, 1);

/** Ligne k = grandeur k (couvert, année, part), 1 dans la colonne de son canal RGB : `M · texel.rgb`. */
function channelMatrix(c: ForestChannels): THREE.Matrix3 {
  const m = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  const e = m.elements; // colonnes d'abord
  [c.cover, c.year, c.share].forEach((col, row) => (e[col * 3 + row] = 1));
  return m;
}

/** Sous-rectangle d'une tuile dans une texture équirectangulaire du monde entier (v = 0 au sud). */
function equirectRect(t: TileId): THREE.Vector4 {
  const b = tileBounds(t);
  const s = tileSpan(t.z);
  return new THREE.Vector4((b.lonMin + 180) / 360, (b.latMin + 90) / 180, s / 360, s / 180);
}

export function createTiledGlobe(tier: Tier, loader: TileLoader, maxLevel: number): TiledGlobe {
  const profile = TIER_PROFILE[tier];
  let levelCap = maxLevel;
  let forestLevelCap = 0;
  let fallbackSat: THREE.Texture | null = null;
  let forestOn = false;

  const uniforms = {
    uSat: { value: null as THREE.Texture | null },
    uSatRect: { value: ZERO_RECT.clone() },
    uHasSat: { value: 0 },
    uMap: { value: null as THREE.Texture | null },
    uMapRect: { value: ZERO_RECT.clone() },
    uHasMap: { value: 0 },
    uForest: { value: null as THREE.Texture | null },
    uForestRect: { value: ZERO_RECT.clone() },
    uHasForest: { value: 0 },
    uForestOn: { value: 0 },
    uForestLut: { value: null as THREE.DataTexture | null },
    uForestChannels: { value: channelMatrix({ cover: 0, year: 1, share: 2 }) },
    uForestSize: { value: 512 },
    uLayerA: { value: null as THREE.Texture | null },
    uLayerB: { value: null as THREE.Texture | null },
    uMix: { value: 0 },
    uGridSize: { value: new THREE.Vector2(1440, 721) },
    uLut: { value: null as THREE.DataTexture | null },
    uHasLayer: { value: 0 },
    uIsoStep: { value: 0 },
    uMapStyle: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0.5, 0.4, 1).normalize() },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  const group = new THREE.Group();
  const meshes = new Map<string, THREE.Mesh>();

  const applyPatch = (mesh: THREE.Mesh) => {
    const p = mesh.userData as PatchUniforms;
    uniforms.uSat.value = p.sat;
    uniforms.uSatRect.value.copy(p.satRect);
    uniforms.uHasSat.value = p.sat ? 1 : 0;
    uniforms.uMap.value = p.map;
    uniforms.uMapRect.value.copy(p.mapRect);
    uniforms.uHasMap.value = p.map ? 1 : 0;
    uniforms.uForest.value = p.forest;
    uniforms.uForestRect.value.copy(p.forestRect);
    uniforms.uHasForest.value = p.forest ? 1 : 0;
    material.uniformsNeedUpdate = true;
  };

  const meshFor = (t: TileId): THREE.Mesh => {
    const key = tileKey(t);
    let mesh = meshes.get(key);
    if (!mesh) {
      mesh = new THREE.Mesh(buildPatchGeometry(t, profile.segments), material);
      mesh.frustumCulled = false;         // lod.ts a déjà éliminé
      mesh.matrixAutoUpdate = false;
      mesh.onBeforeRender = () => applyPatch(mesh!);
      mesh.userData = {
        sat: null, satRect: ZERO_RECT.clone(), map: null, mapRect: ZERO_RECT.clone(), forest: null, forestRect: ZERO_RECT.clone(),
      } satisfies PatchUniforms;
      meshes.set(key, mesh);
      group.add(mesh);
    }
    return mesh;
  };

  const refreshPatch = (t: TileId, mesh: THREE.Mesh) => {
    const p = mesh.userData as PatchUniforms;
    const sat = loader.resolve(t, "sat");
    if (sat) {
      p.sat = sat.texture;
      const r = subRect(t, sat.tile);
      p.satRect.set(r.offsetX, r.offsetY, r.scale, r.scale);
    } else if (fallbackSat) {
      p.sat = fallbackSat;
      p.satRect.copy(equirectRect(t));
    } else {
      p.sat = null;
    }
    const map = loader.isOcean(t) ? null : loader.resolve(t, "map");
    if (map) {
      p.map = map.texture;
      const r = subRect(t, map.tile);
      p.mapRect.set(r.offsetX, r.offsetY, r.scale, r.scale);
    } else {
      p.map = null;
    }
    // Forêt : tuile publiée la plus fine à cet endroit (ancêtre de niveau 7 hors tropiques), puis
    // son ancêtre chargé le plus proche ; aucune si l'index la dit vide ou si la couche est éteinte.
    const q = forestOn ? loader.forestTile(t) : null;
    const forest = q ? loader.resolve(q, "forest") : null;
    if (forest) {
      p.forest = forest.texture;
      const r = subRect(t, forest.tile);
      p.forestRect.set(r.offsetX, r.offsetY, r.scale, r.scale);
    } else {
      p.forest = null;
    }
  };

  return {
    group,
    setLayer(a, width, height, b = null, mix = 0) {
      uniforms.uLayerA.value = a;
      uniforms.uLayerB.value = b ?? a; // toujours un sampler valide, même quand uMix = 0
      uniforms.uMix.value = a && b ? Math.min(1, Math.max(0, mix)) : 0;
      uniforms.uGridSize.value.set(width, height);
      uniforms.uHasLayer.value = a ? 1 : 0;
    },
    setLut(lut) {
      uniforms.uLut.value = lut;
    },
    setIsoStep(step) {
      uniforms.uIsoStep.value = step > 0 ? step : 0;
    },
    setFallbackSat(texture) {
      fallbackSat = texture;
    },
    setMaxLevel(level) {
      levelCap = level;
    },
    setForestMaxLevel(level) {
      forestLevelCap = level;
    },
    setForest(on) {
      forestOn = on;
      uniforms.uForestOn.value = on ? 1 : 0;
      // Éteinte, le loader rend ses textures forêt : aucun patch ne doit plus les désigner.
      if (!on) for (const mesh of meshes.values()) (mesh.userData as PatchUniforms).forest = null;
      loader.setForestEnabled(on);
    },
    setForestPalette(lut, channels, tileSize = 512) {
      uniforms.uForestLut.value = lut;
      uniforms.uForestChannels.value = channelMatrix(channels);
      uniforms.uForestSize.value = tileSize;
    },
    update(view) {
      const leaves = selectTiles(view, { maxLevel: forestOn ? Math.max(levelCap, forestLevelCap) : levelCap, k: profile.k });
      loader.update(leaves, view.cameraPosition);
      uniforms.uMapStyle.value = mapStyleFor(view.cameraPosition.length());
      const keep = new Set<string>();
      for (const t of leaves) {
        keep.add(tileKey(t));
        refreshPatch(t, meshFor(t));
      }
      for (const [key, mesh] of meshes) {
        if (keep.has(key)) continue;
        group.remove(mesh);
        mesh.geometry.dispose();
        meshes.delete(key);
      }
      return leaves.length;
    },
    dispose() {
      for (const mesh of meshes.values()) {
        group.remove(mesh);
        mesh.geometry.dispose();
      }
      meshes.clear();
      material.dispose();
    },
  };
}
