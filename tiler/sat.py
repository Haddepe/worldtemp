"""Jeu `sat` : tuiles JPEG découpées directement dans la Blue Marble 21600×10800 (spec tuiles §2).

Chaque tuile est un `resize(box=…)` de la source : jamais d'image intermédiaire de 32768 px.
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterator

import numpy as np
from PIL import Image

from .grid import TILE_SIZE, tile_bounds, tiles_per_level

Image.MAX_IMAGE_PIXELS = None


def open_source(path: Path) -> Image.Image:
    im = Image.open(path)
    im.load()
    return im.convert("RGB") if im.mode != "RGB" else im


def sat_tile(src: Image.Image, z: int, x: int, y: int) -> np.ndarray:
    w, h = src.size
    b = tile_bounds(z, x, y)
    box = ((b.lon_min + 180.0) / 360.0 * w, (90.0 - b.lat_max) / 180.0 * h,
           (b.lon_max + 180.0) / 360.0 * w, (90.0 - b.lat_min) / 180.0 * h)
    tile = src.resize((TILE_SIZE, TILE_SIZE), Image.Resampling.LANCZOS, box=box)
    return np.asarray(tile, dtype=np.uint8)


def iter_sat_tiles(max_level: int) -> Iterator[tuple[int, int, int]]:
    for z in range(max_level + 1):
        cols, rows = tiles_per_level(z)
        for y in range(rows):
            for x in range(cols):
                yield z, x, y
