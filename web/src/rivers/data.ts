/**
 * `geo/rivers.bin` → segments 3D (spec repères §5). Little-endian : « WTRV », u16 version, u32
 * lignes ; par ligne u8 rang, u8 réservé, u16 n, n × (i16 lon, i16 lat) en centièmes de degré,
 * lignes triées par rang croissant. Logique pure. Miroir : tools/build_geo.py.
 */
import * as THREE from "three";
import { lonLatToVec3 } from "../tiles/patch";

export class RiversError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RiversError";
  }
}

/** Sous les traînées de vent (1,002), au-dessus de la surface. */
export const RIVER_RADIUS = 1.001;
/** Au-delà, la corde passerait sous la surface : on subdivise le long du grand cercle. */
export const MAX_SEGMENT_DEG = 2;

export interface RiverSegments {
  count: number;
  starts: Float32Array;
  ends: Float32Array;
  ranks: Float32Array;
  /** `countByRank[r]` = nombre de segments de rang ≤ r (préfixe, grâce au tri). */
  countByRank: Uint32Array;
}

const HEADER = 10;
const MAX_STEP = (MAX_SEGMENT_DEG * Math.PI) / 180;

export function parseRivers(buffer: ArrayBuffer): RiverSegments {
  if (buffer.byteLength < HEADER) throw new RiversError("en-tête tronqué");
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "WTRV") throw new RiversError("magic WTRV attendu");
  if (view.getUint16(4, true) !== 1) throw new RiversError(`version ${view.getUint16(4, true)} inconnue`);
  const lines = view.getUint32(6, true);

  const starts: number[] = [];
  const ends: number[] = [];
  const ranks: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  let o = HEADER;
  let lastRank = 0;
  for (let l = 0; l < lines; l++) {
    if (o + 4 > buffer.byteLength) throw new RiversError("ligne tronquée");
    const rank = view.getUint8(o);
    // Réservé = 0 en version 1 : autre chose annonce un format qu'on lirait de travers.
    if (view.getUint8(o + 1) !== 0) throw new RiversError("octet réservé non nul");
    const n = view.getUint16(o + 2, true);
    o += 4;
    if (n < 2) throw new RiversError("ligne de moins de deux points");
    if (rank < lastRank) throw new RiversError("lignes non triées par rang");
    lastRank = rank;
    if (o + n * 4 > buffer.byteLength) throw new RiversError("points tronqués");
    for (let i = 0; i < n; i++, o += 4) {
      const lon = view.getInt16(o, true);
      const lat = view.getInt16(o + 2, true);
      if (Math.abs(lon) > 18000 || Math.abs(lat) > 9000) throw new RiversError("coordonnée hors bornes");
      lonLatToVec3(lon / 100, lat / 100, b);
      if (i > 0) {
        const angle = a.angleTo(b);
        const pieces = Math.max(1, Math.ceil(angle / MAX_STEP - 1e-9));
        from.copy(a);
        for (let k = 1; k <= pieces; k++) {
          // interpolation sphérique : les points intermédiaires restent sur le grand cercle
          if (k === pieces) to.copy(b);
          else {
            const t = k / pieces;
            const s = Math.sin(angle);
            to.copy(a).multiplyScalar(Math.sin((1 - t) * angle) / s).addScaledVector(b, Math.sin(t * angle) / s);
          }
          starts.push(from.x * RIVER_RADIUS, from.y * RIVER_RADIUS, from.z * RIVER_RADIUS);
          ends.push(to.x * RIVER_RADIUS, to.y * RIVER_RADIUS, to.z * RIVER_RADIUS);
          ranks.push(rank);
          from.copy(to);
        }
      }
      a.copy(b);
    }
  }
  if (o !== buffer.byteLength) throw new RiversError("octets en trop");

  const countByRank = new Uint32Array(lastRank + 1);
  for (const r of ranks) countByRank[r] = countByRank[r]! + 1;
  for (let r = 1; r < countByRank.length; r++) countByRank[r] = countByRank[r]! + countByRank[r - 1]!;
  return { count: ranks.length, starts: new Float32Array(starts), ends: new Float32Array(ends), ranks: new Float32Array(ranks), countByRank };
}
