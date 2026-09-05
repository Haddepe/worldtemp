/**
 * Géométrie d'un patch de tuile (spec tuiles §5) : grille segments×segments plaquée sur la
 * sphère unité, jupes pour masquer les fissures entre niveaux voisins.
 */
import * as THREE from "three";
import { type TileId, tileBounds, tileSpan } from "./grid";

const DEG = Math.PI / 180;

/** Convention de SphereGeometry (Three.js) : lon −180 en −x, lon −90 en +z, pôle Nord en +y. */
export function lonLatToVec3(lon: number, lat: number, target = new THREE.Vector3()): THREE.Vector3 {
  const phi = (lon + 180) * DEG;
  const theta = (90 - lat) * DEG;
  const st = Math.sin(theta);
  return target.set(-Math.cos(phi) * st, Math.cos(theta), Math.sin(phi) * st);
}

export interface PatchSphere {
  center: THREE.Vector3;
  radius: number;
}

/**
 * Sphère englobante : centre sur la sphère au milieu de la tuile, rayon = distance max aux
 * 4 coins et 4 milieux d'arêtes, marge 5 %. Aux niveaux 0–1 la surface bombe au-delà de ces
 * points ; ces tuiles ne sont jamais derrière l'horizon ni hors champ en pratique.
 */
export function patchSphere(t: TileId): PatchSphere {
  const b = tileBounds(t);
  const lonMid = (b.lonMin + b.lonMax) / 2;
  const latMid = (b.latMin + b.latMax) / 2;
  const center = lonLatToVec3(lonMid, latMid);
  let radius = 0;
  const v = new THREE.Vector3();
  for (const lon of [b.lonMin, lonMid, b.lonMax]) {
    for (const lat of [b.latMin, latMid, b.latMax]) {
      radius = Math.max(radius, lonLatToVec3(lon, lat, v).distanceTo(center));
    }
  }
  return { center, radius: radius * 1.05 };
}

export function buildPatchGeometry(t: TileId, segments: number, skirt = 0.005): THREE.BufferGeometry {
  const b = tileBounds(t);
  const span = tileSpan(t.z);
  const n = segments + 1;
  const surface = n * n;
  const total = surface + 4 * n;
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const lonlat = new Float32Array(total * 2);
  const v = new THREE.Vector3();

  const write = (i: number, lon: number, lat: number, u: number, w: number, scale: number) => {
    lonLatToVec3(lon, lat, v);
    normal.set([v.x, v.y, v.z], i * 3);
    v.multiplyScalar(scale);
    position.set([v.x, v.y, v.z], i * 3);
    uv.set([u, w], i * 2);
    lonlat.set([lon, lat], i * 2);
  };

  // Surface : ligne j = latitude croissante (v = 0 au sud), colonne i = longitude croissante.
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / segments;
      const w = j / segments;
      write(j * n + i, b.lonMin + u * span, b.latMin + w * span, u, w, 1);
    }
  }
  // Jupes : copie des 4 bords, enfoncée de `skirt · span(rad)` vers le centre.
  const depth = 1 - skirt * span * DEG;
  const edges: Array<[number, number][]> = [
    Array.from({ length: n }, (_, i) => [i, 0]),
    Array.from({ length: n }, (_, i) => [i, segments]),
    Array.from({ length: n }, (_, j) => [0, j]),
    Array.from({ length: n }, (_, j) => [segments, j]),
  ];
  let k = surface;
  const skirtStart: number[] = [];
  for (const edge of edges) {
    skirtStart.push(k);
    for (const [i, j] of edge) {
      write(k++, b.lonMin + (i / segments) * span, b.latMin + (j / segments) * span, i / segments, j / segments, depth);
    }
  }

  const index: number[] = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const bIdx = a + 1;
      const c = a + n;
      const d = c + 1;
      index.push(a, bIdx, d, a, d, c);
    }
  }
  const quad = (s0: number, s1: number, k0: number, k1: number) => index.push(s0, k1, k0, s0, s1, k1);
  for (let i = 0; i < segments; i++) {
    quad(i + 1, i, skirtStart[0]! + i + 1, skirtStart[0]! + i);                                   // sud
    quad(segments * n + i, segments * n + i + 1, skirtStart[1]! + i, skirtStart[1]! + i + 1);     // nord
    quad(i * n, (i + 1) * n, skirtStart[2]! + i, skirtStart[2]! + i + 1);                         // ouest
    quad((i + 1) * n + segments, i * n + segments, skirtStart[3]! + i + 1, skirtStart[3]! + i);   // est
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("lonlat", new THREE.BufferAttribute(lonlat, 2));
  g.setIndex(index);
  return g;
}
