import * as THREE from "three";
import type { Tier } from "../gpu/tier";
import { type TileId, subRect, tileBounds, tileKey, tileSpan } from "../tiles/grid";
import { type ViewState, mapStyleFor, selectTiles } from "../tiles/lod";
import type { TileLoader } from "../tiles/loader";
import { buildPatchGeometry } from "../tiles/patch";
import fragmentShader from "./shaders/patch.frag.glsl?raw";
import vertexShader from "./shaders/patch.vert.glsl?raw";

/** Profils par tier (spec tuiles §5 « Tiers »). */
export const TIER_PROFILE: Record<Tier, { maxLevel: number; segments: number; budgetBytes: number; concurrency: number; k: number }> = {
  high: { maxLevel: 8, segments: 32, budgetBytes: 256 * 1024 * 1024, concurrency: 8, k: 1 },
  low: { maxLevel: 7, segments: 16, budgetBytes: 96 * 1024 * 1024, concurrency: 4, k: 1.5 },
};

export interface TiledGlobe {
  group: THREE.Group;
  /** `null` retire la heatmap (style carte gris avec le filtre actif). */
  setHeatmap(texture: THREE.Texture | null, width: number, height: number): void;
  setLut(lut: THREE.DataTexture): void;
  setFilter(on: boolean): void;
  /** Blue Marble 4K locale, équirectangulaire, utilisée quand aucune tuile `sat` n'est disponible (repli). */
  setFallbackSat(texture: THREE.Texture | null): void;
  setMaxLevel(level: number): void;
  /** Sélection, chargement et mise à jour des meshes pour cette vue. Renvoie le nombre de patches affichés. */
  update(view: ViewState): number;
  dispose(): void;
}

interface PatchUniforms {
  sat: THREE.Texture | null;
  satRect: THREE.Vector4;
  map: THREE.Texture | null;
  mapRect: THREE.Vector4;
}

const ZERO_RECT = new THREE.Vector4(0, 0, 1, 1);

/** Sous-rectangle d'une tuile dans une texture équirectangulaire du monde entier (v = 0 au sud). */
function equirectRect(t: TileId): THREE.Vector4 {
  const b = tileBounds(t);
  const s = tileSpan(t.z);
  return new THREE.Vector4((b.lonMin + 180) / 360, (b.latMin + 90) / 180, s / 360, s / 180);
}

export function createTiledGlobe(tier: Tier, loader: TileLoader, maxLevel: number): TiledGlobe {
  const profile = TIER_PROFILE[tier];
  let levelCap = maxLevel;
  let fallbackSat: THREE.Texture | null = null;

  const uniforms = {
    uSat: { value: null as THREE.Texture | null },
    uSatRect: { value: ZERO_RECT.clone() },
    uHasSat: { value: 0 },
    uMap: { value: null as THREE.Texture | null },
    uMapRect: { value: ZERO_RECT.clone() },
    uHasMap: { value: 0 },
    uHeatmap: { value: null as THREE.Texture | null },
    uGridSize: { value: new THREE.Vector2(1440, 721) },
    uLut: { value: null as THREE.DataTexture | null },
    uHasHeatmap: { value: 0 },
    uFilter: { value: 1 },
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
      mesh.userData = { sat: null, satRect: ZERO_RECT.clone(), map: null, mapRect: ZERO_RECT.clone() } satisfies PatchUniforms;
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
  };

  return {
    group,
    setHeatmap(texture, width, height) {
      uniforms.uHeatmap.value = texture;
      uniforms.uGridSize.value.set(width, height);
      uniforms.uHasHeatmap.value = texture ? 1 : 0;
    },
    setLut(lut) {
      uniforms.uLut.value = lut;
    },
    setFilter(on) {
      uniforms.uFilter.value = on ? 1 : 0;
    },
    setFallbackSat(texture) {
      fallbackSat = texture;
    },
    setMaxLevel(level) {
      levelCap = level;
    },
    update(view) {
      const leaves = selectTiles(view, { maxLevel: levelCap, k: profile.k });
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
