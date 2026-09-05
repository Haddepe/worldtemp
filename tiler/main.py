"""Orchestration : blocs → canaux → tuiles → index (spec tuiles §3) et CLI.

    python -m tiler.main extract-gebco --zip gebco.zip --box 0 --out dem/
    python -m tiler.main map --box 0 --dem dem.tif --land land.shp --borders borders.geojson --out out/ --max-level 8
    python -m tiler.main sat --source bmng.png --out out/ --max-level 5
    python -m tiler.main merge-index --inputs a.bin b.bin --out-dir out/ --version v1 --sat-max 5 --map-max 8
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Protocol

import numpy as np
from PIL import Image

from . import borders as borders_mod
from .cut import cut_block, tile_path, write_jpeg, write_png
from .encode import TileIndex, compose_channels, is_ocean_tile, write_manifest
from .grid import TILE_SIZE, Bounds, block_bounds, box_for_job, gebco_pattern, iter_blocks
from .sat import iter_sat_tiles, open_source, sat_tile

Log = Callable[..., None]


class Backend(Protocol):
    def hillshade(self, bounds: Bounds, width: int, height: int) -> np.ndarray: ...
    def land_mask(self, bounds: Bounds, width: int, height: int) -> np.ndarray: ...
    def ocean_only(self, bounds: Bounds) -> bool: ...


def build_map_box(
    backend: Backend,
    box: Bounds,
    lines: list[borders_mod.Line],
    out_dir: Path,
    min_level: int = 1,
    max_level: int = 8,
    block: int = 8,
    log: Log = print,
) -> TileIndex:
    """Niveaux ≥ 1 seulement : les tuiles de niveau 1 (90°) sont alignées sur les boîtes GEBCO, pas celles de niveau 0."""
    if min_level < 1:
        raise ValueError("le niveau 0 est assemblé par build_level0, pas par boîte")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    index = TileIndex(max_level)
    written = 0
    t0 = time.monotonic()
    for z in range(min_level, max_level + 1):
        for blk in iter_blocks(z, box, block):
            bb = block_bounds(blk)
            blk_lines = borders_mod.lines_in_bounds(lines, bb)
            if not blk_lines and backend.ocean_only(bb):
                continue
            w, h = blk.nx * TILE_SIZE, blk.ny * TILE_SIZE
            land = backend.land_mask(bb, w, h)
            shade = np.where(land > 0, backend.hillshade(bb, w, h), np.uint8(128)).astype(np.uint8)
            border = borders_mod.rasterize_lines(blk_lines, bb, w, h)
            rgb = compose_channels(shade, land, border)
            for x, y, tile in cut_block(rgb, blk):
                if is_ocean_tile(tile):
                    continue
                write_png(tile_path(out_dir, "map", z, x, y, "png"), tile)
                index.set(z, x, y)
                written += 1
        log(f"niveau {z} : {index.count(z)} tuiles, {written} au total, {time.monotonic() - t0:.0f} s")
    (out_dir / "index-partial.bin").write_bytes(index.to_bytes())
    return index


def build_sat(src: Image.Image, out_dir: Path, max_level: int = 5, log: Log = print) -> int:
    n = 0
    for z, x, y in iter_sat_tiles(max_level):
        write_jpeg(tile_path(out_dir, "sat", z, x, y, "jpg"), sat_tile(src, z, x, y))
        n += 1
        if x == 0 and y == 0:
            log(f"sat niveau {z} commencé")
    return n


def build_level0(level1_dir: Path, out_dir: Path, index: TileIndex) -> int:
    """Assemble les 2 tuiles de niveau 0 depuis les tuiles de niveau 1 (4 par tuile, océan plat si absente)."""
    ocean = np.zeros((TILE_SIZE, TILE_SIZE, 3), np.uint8)
    ocean[..., 0] = 128
    written = 0
    for x0 in (0, 1):
        big = np.zeros((2 * TILE_SIZE, 2 * TILE_SIZE, 3), np.uint8)
        for dy in (0, 1):
            for dx in (0, 1):
                p = Path(level1_dir) / "map" / "1" / str(2 * x0 + dx) / f"{dy}.png"
                tile = np.asarray(Image.open(p).convert("RGB"), dtype=np.uint8) if p.exists() else ocean
                big[dy * TILE_SIZE : (dy + 1) * TILE_SIZE, dx * TILE_SIZE : (dx + 1) * TILE_SIZE] = tile
        small = np.asarray(Image.fromarray(big, "RGB").reduce(2), dtype=np.uint8)
        if is_ocean_tile(small):
            continue
        write_png(tile_path(out_dir, "map", 0, x0, 0, "png"), small)
        index.set(0, x0, 0)
        written += 1
    return written


def merge_indexes(
    paths: Iterable[Path], out_dir: Path, *, version: str, generated_at: str, sat_max: int, map_max: int, level1_dir: Path | None = None
) -> Path:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    merged = TileIndex(map_max)
    for p in paths:
        merged.merge(TileIndex.from_bytes(Path(p).read_bytes()))
    if level1_dir is not None:
        build_level0(level1_dir, out_dir, merged)
    out = out_dir / "index.bin"
    out.write_bytes(merged.to_bytes())
    write_manifest(out_dir / "manifest.json", version=version, generated_at=generated_at, sat_max=sat_max, map_max=map_max)
    return out


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="tiler")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("extract-gebco")
    p.add_argument("--zip", required=True, type=Path)
    p.add_argument("--box", required=True, type=int)
    p.add_argument("--out", required=True, type=Path)

    p = sub.add_parser("map")
    p.add_argument("--box", required=True, type=int)
    p.add_argument("--dem", required=True, type=Path)
    p.add_argument("--land", required=True, type=Path)
    p.add_argument("--borders", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--work", type=Path, default=Path("work"))
    p.add_argument("--min-level", type=int, default=1)
    p.add_argument("--max-level", type=int, default=8)

    p = sub.add_parser("sat")
    p.add_argument("--source", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--max-level", type=int, default=5)

    p = sub.add_parser("merge-index")
    p.add_argument("--inputs", required=True, nargs="+", type=Path)
    p.add_argument("--out-dir", required=True, type=Path)
    p.add_argument("--version", required=True)
    p.add_argument("--sat-max", type=int, default=5)
    p.add_argument("--map-max", type=int, default=8)
    p.add_argument("--level1-dir", type=Path, default=None, help="dossier contenant map/1/x/y.png (assemblage du niveau 0)")

    a = ap.parse_args(argv)
    if a.cmd == "extract-gebco":
        from .gdal_adapter import extract_gebco_tile
        print(extract_gebco_tile(a.zip, gebco_pattern(box_for_job(a.box)), a.out))
        return 0
    if a.cmd == "map":
        from .gdal_adapter import GdalBackend, clip_vector
        box = box_for_job(a.box)
        a.work.mkdir(parents=True, exist_ok=True)
        land = clip_vector(a.land, box, a.work / "land_box.shp")
        lines = borders_mod.lines_in_bounds(borders_mod.load_geojson_lines(a.borders), box)
        index = build_map_box(GdalBackend(a.dem, land, a.work), box, lines, a.out, a.min_level, a.max_level)
        print(f"boîte {a.box} : {sum(index.count(z) for z in range(a.min_level, a.max_level + 1))} tuiles")
        return 0
    if a.cmd == "sat":
        print(f"sat : {build_sat(open_source(a.source), a.out, a.max_level)} tuiles")
        return 0
    if a.cmd == "merge-index":
        print(merge_indexes(a.inputs, a.out_dir, version=a.version, generated_at=_now(), sat_max=a.sat_max, map_max=a.map_max, level1_dir=a.level1_dir))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
