"""Index binaire des tuiles `map`, canaux R/G/B, manifeste (spec tuiles §2)."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .grid import TILE_SIZE, tiles_per_level

MAGIC = b"WTIX"
VERSION = 1
SOURCES = [
    "NASA Blue Marble Next Generation (BMNG)",
    "GEBCO 2026",
    "OpenStreetMap land polygons (ODbL)",
    "Natural Earth 10m",
]


def _level_bytes(z: int) -> int:
    cols, rows = tiles_per_level(z)
    return -(-cols * rows // 8)


class TileIndex:
    """1 bit per tile, y major / x minor, LSB first. MIRROR TS : web/src/tiles/index.ts."""

    def __init__(self, max_level: int) -> None:
        self.max_level = max_level
        self._levels = [bytearray(_level_bytes(z)) for z in range(max_level + 1)]

    def _pos(self, z: int, x: int, y: int) -> tuple[int, int]:
        cols, _ = tiles_per_level(z)
        i = y * cols + x
        return i // 8, i % 8

    def set(self, z: int, x: int, y: int) -> None:
        byte, bit = self._pos(z, x, y)
        self._levels[z][byte] |= 1 << bit

    def has(self, z: int, x: int, y: int) -> bool:
        byte, bit = self._pos(z, x, y)
        return bool(self._levels[z][byte] >> bit & 1)

    def count(self, z: int) -> int:
        return sum(bin(b).count("1") for b in self._levels[z])

    def to_bytes(self) -> bytes:
        return MAGIC + bytes([VERSION, self.max_level]) + b"".join(self._levels)

    @classmethod
    def from_bytes(cls, data: bytes) -> "TileIndex":
        if data[:4] != MAGIC or len(data) < 6 or data[4] != VERSION:
            raise ValueError("index de tuiles : en-tête invalide")
        idx = cls(data[5])
        offset = 6
        for z in range(idx.max_level + 1):
            n = _level_bytes(z)
            chunk = data[offset : offset + n]
            if len(chunk) != n:
                raise ValueError(f"index de tuiles : niveau {z} tronqué")
            idx._levels[z][:] = chunk
            offset += n
        return idx

    def merge(self, other: "TileIndex") -> None:
        if other.max_level != self.max_level:
            raise ValueError("index de tuiles : niveaux max différents")
        for mine, theirs in zip(self._levels, other._levels):
            for i, b in enumerate(theirs):
                mine[i] |= b


def compose_channels(shade: np.ndarray, land: np.ndarray, border: np.ndarray) -> np.ndarray:
    """R = ombrage (128 = plat), G = masque terre, B = frontière ; tous uint8 de même forme."""
    if not shade.shape == land.shape == border.shape:
        raise ValueError("canaux de formes différentes")
    return np.stack([shade, land, border], axis=-1).astype(np.uint8, copy=False)


def is_ocean_tile(rgb: np.ndarray) -> bool:
    """Tuile sans terre ni frontière (G et B nuls partout) : non écrite (spec §2)."""
    return not rgb[..., 1].any() and not rgb[..., 2].any()


def write_manifest(path: Path, *, version: str, generated_at: str, sat_max: int, map_max: int) -> None:
    manifest = {
        "schema_version": 1,
        "version": version,
        "tile_size": TILE_SIZE,
        "sets": {
            "sat": {"ext": "jpg", "max_level": sat_max},
            "map": {"ext": "png", "max_level": map_max, "index": "index.bin"},
        },
        "generated_at": generated_at,
        "sources": SOURCES,
    }
    Path(path).write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


FOREST_SOURCE = "Hansen/UMD/Google/USGS/NASA — Global Forest Change 2000–2024 (v1.12)"
FOREST_LICENSE = "CC BY 4.0"


def write_forest_manifest(
    path: Path,
    *,
    version: str,
    generated_at: str,
    max_level: int,
    max_level_outside: int,
    tropics: tuple[float, float, float, float],
    channels: dict[str, int],
    threshold: int,
) -> None:
    """Manifeste du jeu `forest` (spec forêt §6), publié sous `tiles/forest/<version>/manifest.json`.

    `max_level` n'existe que dans `tropics` (lon_min, lon_max, lat_min, lat_max), alignée sur la grille
    du niveau `max_level_outside` ; ailleurs la pyramide s'arrête à `max_level_outside`. L'index de
    présence (`index.bin`) fait foi tuile par tuile.
    """
    lon_min, lon_max, lat_min, lat_max = tropics
    manifest = {
        "schema_version": 1,
        "version": version,
        "tile_size": TILE_SIZE,
        "ext": "png",
        "index": "index.bin",
        "max_level": max_level,
        "max_level_outside": max_level_outside,
        "tropics": {"lon_min": lon_min, "lon_max": lon_max, "lat_min": lat_min, "lat_max": lat_max},
        "channels": dict(channels),
        "year_base": 2000,
        "threshold": threshold,
        "source": FOREST_SOURCE,
        "license": FOREST_LICENSE,
        "generated_at": generated_at,
    }
    Path(path).write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
