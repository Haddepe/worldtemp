/** « Ma position » (spec lot F §5.4) : la position reste dans le navigateur, ni envoyée ni stockée. */
export const LOCATE_OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 };

export function locate(geo: Pick<Geolocation, "getCurrentPosition"> | undefined): Promise<{ lon: number; lat: number }> {
  return new Promise((resolve, reject) => {
    if (!geo) {
      reject(new Error("geolocation unsupported"));
      return;
    }
    geo.getCurrentPosition(
      (p) => resolve({ lon: p.coords.longitude, lat: p.coords.latitude }),
      (e) => reject(new Error(`geolocation error ${e.code}`)),
      LOCATE_OPTIONS,
    );
  });
}
