"""Natural Earth → web/public/geo/ (spec repères §2, §5).

    python tools/build_geo.py

Stdlib seule. Télécharge trois GeoJSON figés sur NE_TAG dans tools/.geo-cache/ (git-ignoré)
et écrit places.json, countries.json, rivers.bin — déterministes, commités, servis avec le site.
"""

from __future__ import annotations

import json
import math
import struct
import sys
import urllib.request
from pathlib import Path

NE_TAG = "v5.1.2"
BASE_URL = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{NE_TAG}/geojson/"
SOURCES = {
    "places": "ne_10m_populated_places.geojson",
    "countries": "ne_50m_admin_0_countries.geojson",
    "rivers": "ne_10m_rivers_lake_centerlines.geojson",
}
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".geo-cache"
OUT = ROOT / "web" / "public" / "geo"

MAGIC = b"WTRV"
VERSION = 1
SEGMENT_BUDGET = 25_000
MAX_SEGMENT_DEG = 2.0  # miroir de web/src/rivers/data.ts


def props(feature: dict) -> dict:
    """Propriétés à clés minuscules : Natural Earth mélange NAME_FR et scalerank selon les fichiers."""
    return {k.lower(): v for k, v in (feature.get("properties") or {}).items()}


def _name(p: dict) -> str:
    return (p.get("name_fr") or p.get("name") or "").strip()


def build_places(features: list[dict]) -> list[list]:
    rows = []
    for f in features:
        p = props(f)
        name = _name(p)
        cap = 1 if str(p.get("featurecla") or "").startswith("Admin-0 capital") else 0
        pop = int(p.get("pop_max") or 0)
        if not name or (pop <= 0 and not cap):
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        rows.append([round(lon, 2), round(lat, 2), name, pop, cap])
    rows.sort(key=lambda r: (-r[4], -r[3], r[2]))
    return rows


def build_countries(features: list[dict]) -> list[list]:
    rows = []
    for f in features:
        p = props(f)
        name = _name(p)
        if not name or p.get("label_x") is None or p.get("label_y") is None:
            continue
        rows.append([round(p["label_x"], 2), round(p["label_y"], 2), name, int(p.get("labelrank") or 9)])
    rows.sort(key=lambda r: (r[3], r[2]))
    return rows


def simplify(points: list[tuple], tol: float) -> list[tuple]:
    """Douglas-Peucker itératif, distance point-segment en degrés plans."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        worst, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            dist = math.hypot(px - ax, py - ay) if norm == 0 else abs(dy * (px - ax) - dx * (py - ay)) / norm
            if dist > worst:
                worst, idx = dist, i
        if worst > tol:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [pt for pt, k in zip(points, keep) if k]


def river_lines(features: list[dict], tol: float) -> list[tuple[int, list[tuple[int, int]]]]:
    lines = []
    for f in features:
        geom = f.get("geometry") or {}
        rank = max(0, min(255, int(props(f).get("scalerank") or 0)))
        parts = geom.get("coordinates") or []
        if geom.get("type") == "LineString":
            parts = [parts]
        for part in parts:
            pts = simplify([(c[0], c[1]) for c in part], tol)
            quant: list[tuple[int, int]] = []
            for lon, lat in pts:
                q = (round(lon * 100), round(lat * 100))
                if not quant or quant[-1] != q:
                    quant.append(q)
            if len(quant) >= 2:
                lines.append((rank, quant))
    lines.sort(key=lambda l: l[0])  # tri stable : l'ordre du fichier source départage
    return lines


def _angle_deg(a: tuple[int, int], b: tuple[int, int]) -> float:
    lon1, lat1, lon2, lat2 = (math.radians(v / 100) for v in (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(h))))


def segment_count(lines) -> int:
    """Segments après subdivision à MAX_SEGMENT_DEG, comme le fera le front."""
    total = 0
    for _, pts in lines:
        for a, b in zip(pts, pts[1:]):
            total += max(1, math.ceil(_angle_deg(a, b) / MAX_SEGMENT_DEG - 1e-9))
    return total


def fit_budget(features, budget: int = SEGMENT_BUDGET, tol: float = 0.02):
    lines = river_lines(features, tol)
    while segment_count(lines) > budget:
        tol *= 1.5
        lines = river_lines(features, tol)
    return lines, tol


def encode_rivers(lines) -> bytes:
    out = bytearray(MAGIC + struct.pack("<HI", VERSION, len(lines)))
    for rank, pts in lines:
        out += struct.pack("<BBH", rank, 0, len(pts))
        for lon, lat in pts:
            out += struct.pack("<hh", lon, lat)
    return bytes(out)


def decode_rivers(data: bytes):
    if data[:4] != MAGIC:
        raise ValueError("magic WTRV attendu")
    version, count = struct.unpack_from("<HI", data, 4)
    if version != VERSION:
        raise ValueError(f"version {version} inconnue")
    off, lines = 10, []
    for _ in range(count):
        rank, _pad, n = struct.unpack_from("<BBH", data, off)
        off += 4
        pts = [struct.unpack_from("<hh", data, off + 4 * i) for i in range(n)]
        off += 4 * n
        lines.append((rank, pts))
    if off != len(data):
        raise ValueError("taille incohérente")
    return lines


def dump_json(obj) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def _load(key: str) -> list[dict]:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{NE_TAG}-{SOURCES[key]}"
    if not path.exists():
        print(f"téléchargement {SOURCES[key]} ({NE_TAG})…")
        urllib.request.urlretrieve(BASE_URL + SOURCES[key], path)
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    places = build_places(_load("places"))
    countries = build_countries(_load("countries"))
    lines, tol = fit_budget(_load("rivers"))
    (OUT / "places.json").write_bytes(dump_json({"version": 1, "places": places}))
    (OUT / "countries.json").write_bytes(dump_json({"version": 1, "countries": countries}))
    (OUT / "rivers.bin").write_bytes(encode_rivers(lines))
    print(f"{len(places)} villes, {len(countries)} pays, {len(lines)} lignes de fleuve, "
          f"{segment_count(lines)} segments (tolérance {tol:.4f}°)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
