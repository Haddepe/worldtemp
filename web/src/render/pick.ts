/**
 * Picking analytique sur la sphère unité (spec navigation §3). Indépendant des patches
 * chargés : pas de raycast sur les meshes. La caméra doit avoir `matrixWorld` et
 * `projectionMatrixInverse` à jour (`updateMatrixWorld(true)`, `updateProjectionMatrix()`).
 */
import * as THREE from "three";

const RAD_TO_DEG = 180 / Math.PI;
const origin = new THREE.Vector3();
const dir = new THREE.Vector3();
const camDir = new THREE.Vector3();
const ndc = new THREE.Vector3();

/** Intersection la plus proche du rayon caméra passant par le point NDC avec la sphère unité. */
export function pickSphere(ndcX: number, ndcY: number, camera: THREE.PerspectiveCamera, target = new THREE.Vector3()): THREE.Vector3 | null {
  origin.setFromMatrixPosition(camera.matrixWorld);
  dir.set(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  const b = origin.dot(dir);
  const c = origin.dot(origin) - 1;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null; // caméra sous la surface : impossible avec minDistance > 1
  return target.copy(origin).addScaledVector(dir, t);
}

/** Inverse exact de `tiles/patch.ts::lonLatToVec3`. lon ∈ [−180 ; 180[, lat ∈ [−90 ; 90]. */
export function vec3ToLonLat(p: THREE.Vector3): { lon: number; lat: number } {
  const len = p.length() || 1;
  const y = Math.max(-1, Math.min(1, p.y / len));
  const lat = 90 - Math.acos(y) * RAD_TO_DEG;
  let lon = Math.atan2(p.z, -p.x) * RAD_TO_DEG - 180;
  if (lon < -180) lon += 360;
  if (lon >= 180) lon -= 360;
  return { lon, lat };
}

/** Coordonnées CSS px depuis le coin haut-gauche ; `visible` = devant l'horizon et dans le viewport. */
export function projectToScreen(
  p: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): { x: number; y: number; visible: boolean } {
  camDir.setFromMatrixPosition(camera.matrixWorld);
  const d = camDir.length();
  camDir.divideScalar(d);
  const frontOfHorizon = p.dot(camDir) / (p.length() || 1) > 1 / d;
  ndc.copy(p).project(camera);
  const inView = ndc.x >= -1 && ndc.x <= 1 && ndc.y >= -1 && ndc.y <= 1 && ndc.z <= 1;
  return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height, visible: frontOfHorizon && inView };
}

/** px CSS du canvas → NDC (x droite, y haut). */
export function ndcFromCanvas(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return { x: (x / width) * 2 - 1, y: 1 - (y / height) * 2 };
}
