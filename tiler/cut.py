"""Découpe d'un bloc raster en tuiles et écriture PNG/JPEG (spec tuiles §3)."""
from __future__ import annotations

from pathlib import Path
from typing import Iterator

import numpy as np
from PIL import Image

from .grid import TILE_SIZE, Block


def cut_block(rgb: np.ndarray, block: Block) -> Iterator[tuple[int, int, np.ndarray]]:
    """Parcourt le bloc ligne par ligne (y puis x) et renvoie (x, y, tuile) en coordonnées absolues."""
    h, w = rgb.shape[:2]
    if (w, h) != (block.nx * TILE_SIZE, block.ny * TILE_SIZE):
        raise ValueError(f"bloc {w}×{h}, attendu {block.nx * TILE_SIZE}×{block.ny * TILE_SIZE} (tuiles de {TILE_SIZE})")
    for iy in range(block.ny):
        for ix in range(block.nx):
            tile = rgb[iy * TILE_SIZE : (iy + 1) * TILE_SIZE, ix * TILE_SIZE : (ix + 1) * TILE_SIZE]
            yield block.x0 + ix, block.y0 + iy, tile


def tile_path(out_dir: Path, set_name: str, z: int, x: int, y: int, ext: str) -> Path:
    p = Path(out_dir) / set_name / str(z) / str(x) / f"{y}.{ext}"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def write_png(path: Path, arr: np.ndarray) -> None:
    Image.fromarray(np.ascontiguousarray(arr), "RGB").save(path, format="PNG", optimize=True)


def write_jpeg(path: Path, arr: np.ndarray, quality: int = 85) -> None:
    Image.fromarray(np.ascontiguousarray(arr), "RGB").save(path, format="JPEG", quality=quality, optimize=True, progressive=False)
