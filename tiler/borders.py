"""Frontières : GeoJSON (sorti d'ogr2ogr) → lignes → canal B rasterisé, tracé supersamplé 2× (spec tuiles §3)."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from .grid import Bounds

Line = list[tuple[float, float]]


def load_geojson_lines(path: Path) -> list[Line]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    lines: list[Line] = []
    for feature in data.get("features", []):
        geom = feature.get("geometry") or {}
        kind, coords = geom.get("type"), geom.get("coordinates", [])
        if kind == "LineString":
            lines.append([(float(p[0]), float(p[1])) for p in coords])
        elif kind == "MultiLineString":
            lines.extend([(float(p[0]), float(p[1])) for p in part] for part in coords)
    return lines


def lines_in_bounds(lines: list[Line], bounds: Bounds) -> list[Line]:
    kept = []
    for line in lines:
        lons = [p[0] for p in line]
        lats = [p[1] for p in line]
        if Bounds(min(lons), max(lons), min(lats), max(lats)).intersects(bounds):
            kept.append(line)
    return kept


def rasterize_lines(
    lines: list[Line], bounds: Bounds, width: int, height: int, line_width: int = 3, supersample: int = 2
) -> np.ndarray:
    """Image L (height, width) : 255 sur le trait, anti-aliasé par réduction depuis `supersample`×."""
    if not lines:
        return np.zeros((height, width), np.uint8)
    w, h = width * supersample, height * supersample
    canvas = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(canvas)
    sx = w / bounds.width
    sy = h / bounds.height
    for line in lines:
        pts = [((lon - bounds.lon_min) * sx, (bounds.lat_max - lat) * sy) for lon, lat in line]
        if len(pts) >= 2:
            draw.line(pts, fill=255, width=line_width, joint="curve")
    reduced = canvas.reduce(supersample)
    return np.asarray(reduced, dtype=np.uint8)
