"""Orchestration : blocs → canaux → tuiles → index (spec tuiles §3) et CLI.

    python -m tiler.main extract-gebco --zip gebco.zip --box 0 --out dem/
    python -m tiler.main map --box 0 --dem dem.tif --land land.shp --borders borders.geojson --out out/ --max-level 8
    python -m tiler.main sat --source bmng.png --out out/ --max-level 5
    python -m tiler.main merge-index --inputs a.bin b.bin --out-dir out/ --version v1 --sat-max 5 --map-max 8
    python -m tiler.main forest --box 0 --out out/ --work work/ --max-level 8 --max-level-outside 7 [--sample 16]
    python -m tiler.main merge-forest-index --inputs a.bin b.bin --out-dir out/ --version v1.12 --level1-dir out/
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Protocol

import numpy as np
from PIL import Image

from . import borders as borders_mod
from .cut import cut_block, tile_path, write_jpeg, write_png
from . import forest as forest_mod
from .encode import TileIndex, compose_channels, is_ocean_tile, write_forest_manifest, write_manifest
from .grid import (
    TILE_SIZE, Bounds, block_bounds, box_for_job, gebco_pattern, iter_blocks, tile_range, tile_span, tiles_per_level,
)
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
                if p.exists():
                    with Image.open(p) as im:
                        tile = np.asarray(im.convert("RGB"), dtype=np.uint8)
                else:
                    tile = ocean
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


# --- Tuiles forêt (spec forêt §5-§6) ---------------------------------------------------------

HANSEN_PIXEL_DEG = 0.00025  # pas natif des dalles Hansen (≈ 30 m)
# Bande où le niveau max_level existe quand max_level_outside < max_level (repli stockage §5.1) ;
# contient l'Amazonie (Rondônia, Pará), Bornéo/Sumatra et le bassin du Congo.
TROPICS = Bounds(-180.0, 180.0, -30.0, 30.0)
# Pic mémoire mesuré en Task 2 : bloc de 8 x 8 tuiles au facteur 5 ≈ 2,3 Go (lecture + agrégation),
# proportionnel au nombre de pixels lus. Runners : 7 Go ; on vise ≤ 3 Go.
PEAK_REF_BYTES = 2.3e9
PEAK_REF_PIXELS = (8 * TILE_SIZE * 5) ** 2
PEAK_LIMIT_BYTES = 3e9
BLOCK_CHOICES = (8, 6, 4, 2, 1)


class ForestBackend(Protocol):
    def read_block(self, bounds: Bounds, width: int, height: int, factor: int) -> tuple[np.ndarray, np.ndarray]: ...


def forest_factor(z: int) -> int:
    """Règle R1 : pixels Hansen par pixel de tuile au niveau z, ceil((180 / (512·2^z)) / 0,00025).

    Niveau 8 → 6, niveau 7 → 11. Le bloc est lu au plus proche à ce pas (un peu plus fin que le
    natif, jamais plus grossier), puis réduit par `forest.aggregate(..., f)`.
    """
    return math.ceil(180.0 / (TILE_SIZE * 2**z) / HANSEN_PIXEL_DEG)


def forest_peak_bytes(block: int, factor: int) -> float:
    """Pic mémoire estimé d'un bloc de block x block tuiles lu au facteur `factor`."""
    return PEAK_REF_BYTES * (block * TILE_SIZE * factor) ** 2 / PEAK_REF_PIXELS


def forest_block(z: int, factor: int | None = None) -> int:
    """Plus grand bloc (tuiles de côté) dont le pic estimé reste ≤ 3 Go : niveau 8 → 6, niveau 7 → 4."""
    f = forest_factor(z) if factor is None else factor
    return next((b for b in BLOCK_CHOICES if forest_peak_bytes(b, f) <= PEAK_LIMIT_BYTES), 1)


def tropical_tiles(tropics: Bounds, z: int) -> tuple[int, int, int, int]:
    """Tuiles (x0..x1, y0..y1 inclus) du niveau z qui coupent `tropics` (intérieur strict).

    La bande est ainsi alignée sur la grille du niveau z : une tuile de niveau > z est « tropicale »
    si son ancêtre au niveau z l'est, ce qui garantit que les 4 enfants d'une tuile tropicale existent.
    """
    s = tile_span(z)
    cols, rows = tiles_per_level(z)
    x0 = max(0, math.floor((tropics.lon_min + 180.0) / s))
    x1 = min(cols - 1, math.ceil((tropics.lon_max + 180.0) / s) - 1)
    y0 = max(0, math.floor((90.0 - tropics.lat_max) / s))
    y1 = min(rows - 1, math.ceil((90.0 - tropics.lat_min) / s) - 1)
    return x0, x1, y0, y1


def _decode(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert("RGB"), dtype=np.uint8)


def reduce_forest_tile(src_dir: Path, z: int, x: int, y: int) -> np.ndarray | None:
    """Tuile (z, x, y) par réduction 2x2 de ses 4 enfants `forest/z+1` déjà écrits (enfant absent = vide).

    Même règle que depuis le 30 m : `aggregate(couvert, année, 2, part)` ; None si aucun enfant ou
    si le résultat est vide.
    """
    big = np.zeros((2 * TILE_SIZE, 2 * TILE_SIZE, 3), np.uint8)
    found = False
    for dy in (0, 1):
        for dx in (0, 1):
            p = Path(src_dir) / "forest" / str(z + 1) / str(2 * x + dx) / f"{2 * y + dy}.png"
            if p.exists():
                big[dy * TILE_SIZE : (dy + 1) * TILE_SIZE, dx * TILE_SIZE : (dx + 1) * TILE_SIZE] = _decode(p)
                found = True
    if not found:
        return None
    ch = forest_mod.CHANNELS
    cover, year, share = forest_mod.aggregate(big[..., ch["cover"]], big[..., ch["year"]], 2, big[..., ch["share"]])
    tile = forest_mod.encode_tile(cover, year, share)
    return None if forest_mod.is_empty_tile(tile) else tile


def _write_forest(out_dir: Path, z: int, x: int, y: int, tile: np.ndarray, index: TileIndex, sizes: dict[int, int]) -> None:
    p = tile_path(out_dir, "forest", z, x, y, "png")
    write_png(p, tile)
    index.set(z, x, y)
    sizes[z] = sizes.get(z, 0) + p.stat().st_size


def build_forest_box(
    backend: ForestBackend,
    box: Bounds,
    out_dir: Path,
    min_level: int = 1,
    max_level: int = 8,
    max_level_outside: int = 8,
    tropics: Bounds = TROPICS,
    block: int | None = None,
    log: Log = print,
    *,
    sample: int = 1,
    sizes: dict[int, int] | None = None,
    factor_for: Callable[[int], int] | None = None,
) -> TileIndex:
    """Pyramide `forest` d'une boîte, niveaux min_level..max_level (le niveau 0 est assemblé à la fusion).

    Règle R2 : seul le niveau le plus fin de chaque endroit est lu dans Hansen — `max_level` dans la
    bande `tropics` (alignée sur la grille de `max_level_outside`), `max_level_outside` ailleurs ;
    les niveaux plus grossiers sont réduits 2x2 depuis les tuiles déjà écrites. Au niveau
    `max_level_outside` (< max_level), un bloc entièrement tropical est réduit, les autres sont lus.

    - `block` : côté des blocs lus, en tuiles ; None → `forest_block(z)` (pic estimé ≤ 3 Go).
    - Bloc lu entièrement vide (ni couvert ni perte) : rien n'est écrit ; tuile vide : non écrite.
    - `sample` = K > 1 : ne lit qu'un bloc sur K (rang dans l'ordre de `iter_blocks`, parmi les blocs
      à lire de chaque niveau) pour estimer le stockage ; les niveaux réduits n'ont alors qu'une
      partie de leurs enfants (estimation approchée pour eux).
    - `sizes` : rempli avec les octets PNG écrits par niveau.
    - Toute erreur du backend se propage : pas d'`index-partial.bin` pour une boîte incomplète.
    """
    if min_level < 1:
        raise ValueError("le niveau 0 est assemblé par merge-forest-index, pas par boîte")
    if not min_level <= max_level_outside <= max_level:
        raise ValueError("il faut min_level ≤ max_level_outside ≤ max_level")
    if sample < 1:
        raise ValueError("sample doit être ≥ 1")
    factor_for = factor_for or forest_factor
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    sizes = {} if sizes is None else sizes
    index = TileIndex(max_level)
    lo = max_level_outside
    tt = tropical_tiles(tropics, lo)

    def tropical(z: int, x: int, y: int) -> bool:
        sh = z - lo
        return tt[0] <= x >> sh <= tt[1] and tt[2] <= y >> sh <= tt[3]

    def reduce_and_write(z: int, x: int, y: int) -> None:
        tile = reduce_forest_tile(out_dir, z, x, y)
        if tile is not None:
            _write_forest(out_dir, z, x, y, tile, index, sizes)

    t0 = time.monotonic()
    for z in range(max_level, min_level - 1, -1):
        sizes.setdefault(z, 0)
        if z in (max_level, lo):
            f = factor_for(z)
            blk_size = block or forest_block(z, f)
            n_read = n_empty = 0
            for b in iter_blocks(z, box, blk_size):
                tiles = [(b.x0 + ix, b.y0 + iy) for iy in range(b.ny) for ix in range(b.nx)]
                if z > lo:  # niveau fin réservé à la bande tropicale
                    tiles = [t for t in tiles if tropical(z, *t)]
                    if not tiles:
                        continue
                elif z < max_level and all(tropical(z, *t) for t in tiles):
                    for x, y in tiles:  # enfants déjà lus au niveau fin : réduction
                        reduce_and_write(z, x, y)
                    continue
                n_read += 1
                if (n_read - 1) % sample:
                    continue
                cover, loss = backend.read_block(block_bounds(b), b.nx * TILE_SIZE, b.ny * TILE_SIZE, f)
                if not cover.any() and not loss.any():
                    n_empty += 1
                    continue
                c, yr, sh = forest_mod.aggregate(cover, loss, f)
                del cover, loss
                rgb = forest_mod.encode_tile(c, yr, sh)
                del c, yr, sh
                keep = set(tiles)
                for x, y, tile in cut_block(rgb, b):
                    if (x, y) in keep and not forest_mod.is_empty_tile(tile):
                        _write_forest(out_dir, z, x, y, tile, index, sizes)
            how = f"lu (facteur {f}, bloc {blk_size}, {n_read} blocs à lire, {n_empty} vides)"
        else:
            x0, x1, y0, y1 = tile_range(z, box)
            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    if z <= lo or tropical(z, x, y):
                        reduce_and_write(z, x, y)
            how = "réduit 2x2"
        log(f"forêt niveau {z} {how} : {index.count(z)} tuiles, {sizes[z]} octets, {time.monotonic() - t0:.0f} s")
    (out_dir / "index-partial.bin").write_bytes(index.to_bytes())
    return index


def merge_forest_indexes(
    paths: Iterable[Path],
    out_dir: Path,
    *,
    version: str,
    generated_at: str,
    max_level: int,
    max_level_outside: int,
    tropics: Bounds = TROPICS,
    level1_dir: Path | None = None,
) -> Path:
    """Fusionne les index des boîtes, assemble le niveau 0 (2x2 depuis `forest/1`) et écrit le manifeste."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    merged = TileIndex(max_level)
    for p in paths:
        merged.merge(TileIndex.from_bytes(Path(p).read_bytes()))
    if level1_dir is not None:
        for x0 in (0, 1):
            tile = reduce_forest_tile(level1_dir, 0, x0, 0)
            if tile is not None:
                write_png(tile_path(out_dir, "forest", 0, x0, 0, "png"), tile)
                merged.set(0, x0, 0)
    out = out_dir / "index.bin"
    out.write_bytes(merged.to_bytes())
    write_forest_manifest(
        out_dir / "manifest.json", version=version, generated_at=generated_at, max_level=max_level,
        max_level_outside=max_level_outside, tropics=(tropics.lon_min, tropics.lon_max, tropics.lat_min, tropics.lat_max),
        channels=forest_mod.CHANNELS, threshold=forest_mod.FOREST_THRESHOLD,
    )
    return out


def parse_bounds(text: str) -> Bounds:
    """« lon_min,lon_max,lat_min,lat_max » → Bounds (en CLI, écrire `--tropics=-180,180,-30,30` avec « = »)."""
    parts = text.split(",")
    if len(parts) != 4:
        raise ValueError(f"4 nombres attendus : {text!r}")
    lon_min, lon_max, lat_min, lat_max = (float(v) for v in parts)
    if not (-180 <= lon_min < lon_max <= 180 and -90 <= lat_min < lat_max <= 90):
        raise ValueError(f"bornes invalides : {text!r}")
    return Bounds(lon_min, lon_max, lat_min, lat_max)


def _print_forest_sizes(box: int, index: TileIndex, sizes: dict[int, int], sample: int) -> None:
    levels = sorted(sizes)
    if sample > 1:
        for z in levels:
            print(f"échantillon niveau {z} : {index.count(z)} tuiles, {sizes[z]} octets, {sizes[z] * sample} octets extrapolés")
        total = sum(sizes.values()) * sample
        print(f"boîte {box} : total extrapolé {total} octets (≈ {total / 1e9:.2f} Go, échantillon 1/{sample})")
    else:
        for z in levels:
            print(f"niveau {z} : {index.count(z)} tuiles, {sizes[z]} octets")
        print(f"boîte {box} : {sum(index.count(z) for z in levels)} tuiles, {sum(sizes.values())} octets")


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

    p = sub.add_parser("forest")
    p.add_argument("--box", required=True, type=int)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--work", type=Path, default=Path("work"))
    p.add_argument("--min-level", type=int, default=1)
    p.add_argument("--max-level", type=int, default=8)
    p.add_argument("--max-level-outside", type=int, default=8, help="niveau max hors de --tropics (repli stockage : 7)")
    p.add_argument("--tropics", type=parse_bounds, default=TROPICS, help="lon_min,lon_max,lat_min,lat_max (écrire --tropics=-180,180,-30,30)")
    p.add_argument("--block", type=int, default=None, help="côté des blocs lus, en tuiles (défaut : selon le niveau, pic ≤ 3 Go)")
    p.add_argument("--sample", type=int, default=1, help="K : ne lit qu'un bloc sur K et imprime l'estimation du stockage")
    p.add_argument("--hansen-base", default=None, help="URL ou dossier des dalles Hansen (défaut : dépôt officiel v1.12)")

    p = sub.add_parser("merge-forest-index")
    p.add_argument("--inputs", required=True, nargs="+", type=Path)
    p.add_argument("--out-dir", required=True, type=Path)
    p.add_argument("--version", required=True)
    p.add_argument("--max-level", type=int, default=8)
    p.add_argument("--max-level-outside", type=int, default=8)
    p.add_argument("--tropics", type=parse_bounds, default=TROPICS, help="mêmes bornes que pour forest")
    p.add_argument("--level1-dir", type=Path, default=None, help="dossier contenant forest/1/x/y.png (assemblage du niveau 0)")

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
    if a.cmd == "forest":
        from . import hansen

        backend = hansen.HansenBackend(a.work, base=a.hansen_base or hansen.HANSEN_BASE)
        sizes: dict[int, int] = {}
        try:
            index = build_forest_box(backend, box_for_job(a.box), a.out, a.min_level, a.max_level, a.max_level_outside,
                                     a.tropics, a.block, sample=a.sample, sizes=sizes)
        finally:
            backend.close()  # dalles téléchargées supprimées, même en cas d'échec
        _print_forest_sizes(a.box, index, sizes, a.sample)
        return 0
    if a.cmd == "merge-forest-index":
        print(merge_forest_indexes(a.inputs, a.out_dir, version=a.version, generated_at=_now(), max_level=a.max_level,
                                   max_level_outside=a.max_level_outside, tropics=a.tropics, level1_dir=a.level1_dir))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
