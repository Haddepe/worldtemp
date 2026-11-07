"""Archives `WTPK` des tuiles forêt profondes (lot R5c). MIROIR TS : cell_of et lecture du répertoire (tâche 5).

Format (little-endian) : en-tête 16 octets (`WTPK`, u8 version=1, 3 nuls, u32 count, u32 nul),
`count` enregistrements de 16 octets triés par (z, x, y) (u8 z, nul, u16 x, u16 y, u16 nul,
u32 offset absolu, u32 length), puis les PNG concaténés dans l'ordre des enregistrements.
"""
from __future__ import annotations

import math
import re
import shutil
import struct
from pathlib import Path

from .grid import Bounds, tile_span

MAGIC = b"WTPK"
VERSION = 1
HEADER_SIZE = 16
RECORD_SIZE = 16
MAX_ARCHIVE_BYTES = 2**32 - 1  # offsets et longueurs en u32


def cell_of(z: int, x: int, y: int) -> tuple[int, int]:
    """Cellule 10° × 10° (cx 0..35, cy 0..17) contenant le centre de la tuile."""
    s = tile_span(z)
    lon = -180.0 + (x + 0.5) * s
    lat = 90.0 - (y + 0.5) * s
    return math.floor((lon + 180.0) / 10.0), math.floor((90.0 - lat) / 10.0)


def is_deep(z: int, x: int, y: int, tropics: Bounds) -> bool:
    """Niveau 9, ou niveau 8 dont le centre est hors de la bande tropicale (règle de forestTileFor)."""
    if z == 9:
        return True
    if z != 8:
        return False
    s = tile_span(z)
    lon = -180.0 + (x + 0.5) * s
    lat = 90.0 - (y + 0.5) * s
    inside = tropics.lon_min <= lon <= tropics.lon_max and tropics.lat_min <= lat <= tropics.lat_max
    return not inside


def write_archive(tiles: list[tuple[int, int, int, Path]], dest: Path) -> int:
    """Écrit l'archive en flux (un PNG à la fois) ; renvoie la taille en octets."""
    ordered = sorted(tiles, key=lambda t: t[:3])
    count = len(ordered)
    offset = HEADER_SIZE + RECORD_SIZE * count
    records = bytearray()
    for z, x, y, path in ordered:
        length = Path(path).stat().st_size
        records += struct.pack("<BBHHHII", z, 0, x, y, 0, offset, length)
        offset += length
    if offset > MAX_ARCHIVE_BYTES:
        raise ValueError(f"archive {Path(dest).name} : {offset} octets, dépasse la limite de 4 Gio (offsets u32)")
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as f:
        f.write(MAGIC + struct.pack("<B3xII", VERSION, count, 0))
        f.write(records)
        for _, _, _, path in ordered:
            with Path(path).open("rb") as src:
                shutil.copyfileobj(src, f)
    return offset


def read_directory(data: bytes) -> list[tuple[int, int, int, int, int]]:
    """Répertoire d'une archive : liste de (z, x, y, offset, length)."""
    if data[:4] != MAGIC:
        raise ValueError("signature WTPK absente")
    if data[4] != VERSION:
        raise ValueError(f"version WTPK inconnue : {data[4]}")
    (count,) = struct.unpack_from("<I", data, 8)
    out = []
    for i in range(count):
        z, _, x, y, _, off, ln = struct.unpack_from("<BBHHHII", data, HEADER_SIZE + RECORD_SIZE * i)
        out.append((z, x, y, off, ln))
    return out


def pack_deep(out_dir: Path, dest_dir: Path, tropics: Bounds) -> dict[str, dict[str, int]]:
    """Regroupe les tuiles profondes de `out_dir/forest/z/x/y.png` en une archive par cellule."""
    cells: dict[str, list[tuple[int, int, int, Path]]] = {}
    root = Path(out_dir) / "forest"
    for png in root.glob("*/*/*.png"):
        if not (re.fullmatch(r"\d+", png.parent.parent.name) and re.fullmatch(r"\d+", png.parent.name)
                and re.fullmatch(r"\d+", png.stem)):
            continue
        z, x, y = int(png.parent.parent.name), int(png.parent.name), int(png.stem)
        if is_deep(z, x, y, tropics):
            cx, cy = cell_of(z, x, y)
            cells.setdefault(f"{cx}_{cy}", []).append((z, x, y, png))
    fragment: dict[str, dict[str, int]] = {}
    for name in sorted(cells):
        size = write_archive(cells[name], Path(dest_dir) / f"{name}.wtpk")
        fragment[name] = {"count": len(cells[name]), "bytes": size}
    return fragment
