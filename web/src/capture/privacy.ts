/**
 * Promesse du panneau About (lot F) : « ma position » n'est ni stockée ni partagée. Avec la vue
 * écrite dans l'URL à chaque repos de la caméra, elle y entrerait sans que l'utilisateur le voie :
 * on suspend l'écriture tant que le centre de la vue reste à ≤ 5° du point localisé (spec capture §2).
 */
export const PRIVACY_RADIUS_DEG = 5;

const RAD = Math.PI / 180;

/** Distance angulaire (haversine), en degrés. */
export function angularDistanceDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / RAD;
}

export class ViewGuard {
  private point: { lon: number; lat: number } | null = null;

  /** Vol « ma position » : l'écriture est suspendue autour de ce point. */
  located(lon: number, lat: number): void {
    this.point = { lon, lat };
  }

  /** Ville choisie : la vue redevient partageable. */
  cityChosen(): void {
    this.point = null;
  }

  /** Sortie du rayon = levée définitive : revenir ensuite près du point est un choix de l'utilisateur. */
  mayWrite(lon: number, lat: number): boolean {
    if (this.point === null) return true;
    if (angularDistanceDeg(this.point.lon, this.point.lat, lon, lat) <= PRIVACY_RADIUS_DEG) return false;
    this.point = null;
    return true;
  }
}
