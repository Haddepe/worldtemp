"""Appels GDAL isolés (spec tuiles §3). Seul module du package qui exécute des programmes externes.

Testé réellement sur Actions (`gdal-bin`), sauté sous Windows — même approche que pipeline/grib_adapter.py.
"""
from __future__ import annotations

import fnmatch
import subprocess
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

from .grid import Bounds

Image.MAX_IMAGE_PIXELS = None


def _run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def extract_gebco_tile(zip_path: Path, pattern: str, out_dir: Path) -> Path:
    """Extrait la seule dalle dont le nom correspond au motif glob (grid.gebco_pattern)."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if fnmatch.fnmatch(Path(n).name, pattern)]
        if len(names) != 1:
            raise FileNotFoundError(f"{len(names)} dalle(s) pour {pattern} dans {zip_path}")
        target = out_dir / Path(names[0]).name
        with zf.open(names[0]) as src, open(target, "wb") as dst:
            while chunk := src.read(1 << 20):
                dst.write(chunk)
    return target


def _fmt(path: Path) -> str:
    return {"geojson": "GeoJSON", "json": "GeoJSON", "shp": "ESRI Shapefile"}[Path(path).suffix.lstrip(".").lower()]


def clip_vector(src: Path, bounds: Bounds, out: Path, margin: float = 1.0) -> Path:
    """Découpe un jeu vectoriel à la boîte (+ marge en degrés) avec ogr2ogr."""
    out = Path(out)
    _run([
        "ogr2ogr", "-q", "-overwrite", "-f", _fmt(out),
        "-clipsrc", str(bounds.lon_min - margin), str(bounds.lat_min - margin),
        str(bounds.lon_max + margin), str(bounds.lat_max + margin),
        str(out), str(src),
    ])
    return out


def read_gray(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert("L"), dtype=np.uint8)


class GdalBackend:
    """Relief et masque terre pour un bloc (spec §3). Sorties uint8 (height, width)."""

    def __init__(self, dem_tif: Path, land_vector: Path, work_dir: Path) -> None:
        self.dem = Path(dem_tif)
        self.land = Path(land_vector)
        self.work = Path(work_dir)
        self.work.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _te(b: Bounds) -> list[str]:
        return ["-te", str(b.lon_min), str(b.lat_min), str(b.lon_max), str(b.lat_max)]

    def hillshade(self, bounds: Bounds, width: int, height: int) -> np.ndarray:
        dem = self.work / "dem_block.tif"
        shade = self.work / "shade_block.tif"
        _run(["gdalwarp", "-q", "-overwrite", *self._te(bounds), "-ts", str(width), str(height),
              "-r", "cubic", "-ot", "Float32", str(self.dem), str(dem)])
        # -alt 30 : un terrain plat vaut 255·sin(30°) = 127,5 → 128 (spec §2). -s 111120 : degrés → mètres.
        _run(["gdaldem", "hillshade", "-q", "-az", "315", "-alt", "30", "-s", "111120",
              "-compute_edges", str(dem), str(shade)])
        return read_gray(shade)

    def land_mask(self, bounds: Bounds, width: int, height: int) -> np.ndarray:
        raw = self.work / "land_block.tif"
        if raw.exists():
            raw.unlink()
        _run(["gdal_rasterize", "-q", "-burn", "255", "-ot", "Byte", "-init", "0", *self._te(bounds),
              "-ts", str(width * 2), str(height * 2), str(self.land), str(raw)])
        with Image.open(raw) as im:
            return np.asarray(im.convert("L").reduce(2), dtype=np.uint8)

    def ocean_only(self, bounds: Bounds) -> bool:
        return not self.land_mask(bounds, 64, 64).any()
