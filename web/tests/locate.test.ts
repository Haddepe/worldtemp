import { describe, expect, it, vi } from "vitest";
import { LOCATE_OPTIONS, locate } from "../src/ui/locate";

describe("locate — géolocalisation du navigateur (spec lot F §5.4)", () => {
  it("succès : lon/lat, avec les options de la spec", async () => {
    const getCurrentPosition = vi.fn<Geolocation["getCurrentPosition"]>((ok) => ok({ coords: { longitude: 6.45, latitude: 48.17 } } as GeolocationPosition));
    await expect(locate({ getCurrentPosition })).resolves.toEqual({ lon: 6.45, lat: 48.17 });
    expect(getCurrentPosition.mock.calls[0]![2]).toEqual({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 });
    expect(LOCATE_OPTIONS.timeout).toBe(10_000);
  });
  it("refus ou délai : rejet", async () => {
    const getCurrentPosition = vi.fn((_ok: PositionCallback, err?: PositionErrorCallback | null) => err?.({ code: 1 } as GeolocationPositionError));
    await expect(locate({ getCurrentPosition })).rejects.toThrowError("geolocation error 1");
  });
  it("API absente : rejet", async () => {
    await expect(locate(undefined)).rejects.toThrowError("geolocation unsupported");
  });
});
