"""Maths de la pyramide géodésique (spec tuiles §2). MIROIR TS : web/src/tiles/grid.ts.

Modifier l'un impose de modifier l'autre ; les deux sont testés avec les mêmes nombres.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

TILE_SIZE = 512


@dataclass(frozen=True)
class Bounds:
    lon_min: float
    lon_max: float
    lat_min: float
    lat_max: float

    @property
    def width(self) -> float:
        return self.lon_max - self.lon_min

    @property
    def height(self) -> float:
        return self.lat_max - self.lat_min

    def intersects(self, other: "Bounds") -> bool:
        return (
            self.lon_min < other.lon_max
            and other.lon_min < self.lon_max
            and self.lat_min < other.lat_max
            and other.lat_min < self.lat_max
        )


def tiles_per_level(z: int) -> tuple[int, int]:
    return 2 ** (z + 1), 2**z


def tile_span(z: int) -> float:
    return 180.0 / 2**z


def tile_bounds(z: int, x: int, y: int) -> Bounds:
    s = tile_span(z)
    lon_min = -180.0 + x * s
    lat_max = 90.0 - y * s
    return Bounds(lon_min, lon_min + s, lat_max - s, lat_max)


def tile_at(z: int, lon: float, lat: float) -> tuple[int, int]:
    cols, rows = tiles_per_level(z)
    s = tile_span(z)
    x = min(cols - 1, max(0, int((lon + 180.0) // s)))
    y = min(rows - 1, max(0, int((90.0 - lat) // s)))
    return x, y


def pixels_per_degree(z: int) -> float:
    return TILE_SIZE * 2**z / 180.0


def box_for_job(n: int) -> Bounds:
    if not 0 <= n < 8:
        raise ValueError(f"boîte {n} hors de 0..7")
    lon_min = -180.0 + 90.0 * (n % 4)
    lat_min = 0.0 if n < 4 else -90.0
    return Bounds(lon_min, lon_min + 90.0, lat_min, lat_min + 90.0)


def gebco_pattern(box: Bounds) -> str:
    """Motif glob de la dalle GEBCO couvrant la boîte (nommage 2024/2026 : un chiffre décimal)."""
    return f"*n{box.lat_max:.1f}_s{box.lat_min:.1f}_w{box.lon_min:.1f}_e{box.lon_max:.1f}*.tif"


def tile_range(z: int, box: Bounds) -> tuple[int, int, int, int]:
    """Tuiles (x0..x1, y0..y1 inclus) couvrant une boîte alignée sur la grille."""
    x0, y0 = tile_at(z, box.lon_min, box.lat_max)
    cols, rows = tiles_per_level(z)
    s = tile_span(z)
    x1 = min(cols - 1, x0 + max(1, round(box.width / s)) - 1)
    y1 = min(rows - 1, y0 + max(1, round(box.height / s)) - 1)
    return x0, x1, y0, y1


@dataclass(frozen=True)
class Block:
    z: int
    x0: int
    y0: int
    nx: int
    ny: int


def iter_blocks(z: int, box: Bounds, block: int = 8) -> Iterator[Block]:
    x0, x1, y0, y1 = tile_range(z, box)
    for by in range(y0, y1 + 1, block):
        for bx in range(x0, x1 + 1, block):
            yield Block(z, bx, by, min(block, x1 - bx + 1), min(block, y1 - by + 1))


def block_bounds(b: Block) -> Bounds:
    first = tile_bounds(b.z, b.x0, b.y0)
    s = tile_span(b.z)
    return Bounds(first.lon_min, first.lon_min + b.nx * s, first.lat_max - b.ny * s, first.lat_max)
