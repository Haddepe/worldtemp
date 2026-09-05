"""Test réel de l'adaptateur GDAL : tourne sur Actions (gdal-bin installé), sauté sans GDAL (Windows)."""
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from tiler import gdal_adapter
from tiler.grid import Bounds

HAS_GDAL = shutil.which("gdalwarp") is not None and shutil.which("ogr2ogr") is not None
pytestmark = pytest.mark.skipif(not HAS_GDAL, reason="GDAL absent (attendu sous Windows ; testé sur Actions)")


@pytest.fixture
def dem_tif(tmp_path):
    """Cône de 64×64 sur la boîte lon 0..2, lat 0..2 (EPSG:4326), via PNG + world file + gdal_translate.

    Le cône culmine à 25 500 m sur un rayon d'environ 1° (~111 km, -scale 0 255 0 25500),
    soit des pentes de l'ordre de 25 à 45 % : nettement ombrées par gdaldem hillshade, sans
    exagération verticale (-z), tout en laissant le coin de la boîte plat.
    """
    yy, xx = np.mgrid[0:64, 0:64]
    cone = np.clip(255 - np.hypot(xx - 32, yy - 32) * 8, 0, 255).astype(np.uint8)
    png = tmp_path / "dem.png"
    Image.fromarray(cone, "L").save(png)
    (tmp_path / "dem.pgw").write_text("0.03125\n0\n0\n-0.03125\n0.015625\n1.984375\n", encoding="utf-8")
    out = tmp_path / "dem.tif"
    subprocess.run(["gdal_translate", "-q", "-a_srs", "EPSG:4326", "-ot", "Float32",
                    "-scale", "0", "255", "0", "25500", str(png), str(out)], check=True)
    return out


@pytest.fixture
def land_geojson(tmp_path):
    p = tmp_path / "land.geojson"
    p.write_text(json.dumps({
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {}, "geometry": {
            "type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 2], [0, 2], [0, 0]]]}}],
    }), encoding="utf-8")
    return p


def test_extract_gebco_tile_by_pattern(tmp_path):
    z = tmp_path / "gebco.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("gebco_2026_n90.0_s0.0_w-180.0_e-90.0.tif", b"A")
        zf.writestr("gebco_2026_n0.0_s-90.0_w90.0_e180.0.tif", b"B")
    out = gdal_adapter.extract_gebco_tile(z, "*n0.0_s-90.0_w90.0_e180.0*.tif", tmp_path / "dem")
    assert out.read_bytes() == b"B"
    with pytest.raises(FileNotFoundError):
        gdal_adapter.extract_gebco_tile(z, "*n45.0*.tif", tmp_path / "dem")


def test_clip_vector_keeps_only_features_in_bounds(tmp_path, land_geojson):
    out = gdal_adapter.clip_vector(land_geojson, Bounds(0, 2, 0, 2), tmp_path / "clip.geojson", margin=0)
    assert json.loads(out.read_text(encoding="utf-8"))["features"]
    empty = gdal_adapter.clip_vector(land_geojson, Bounds(10, 12, 10, 12), tmp_path / "empty.geojson", margin=0)
    assert json.loads(empty.read_text(encoding="utf-8"))["features"] == []


def test_backend_hillshade_land_mask_and_ocean_only(tmp_path, dem_tif, land_geojson):
    backend = gdal_adapter.GdalBackend(dem_tif, land_geojson, tmp_path / "work")
    shade = backend.hillshade(Bounds(0, 2, 0, 2), 64, 64)
    assert shade.shape == (64, 64) and shade.dtype == np.uint8
    assert shade.min() < 120 and shade.max() > 136          # pentes vers et contre la lumière
    assert abs(int(shade[2, 2]) - 128) <= 3                  # coin plat ≈ 128
    land = backend.land_mask(Bounds(0, 2, 0, 2), 64, 64)
    assert land.shape == (64, 64) and land[32, 8] == 255 and land[32, 56] == 0
    assert backend.land_mask(Bounds(0, 2, 0, 2), 64, 32).shape == (32, 64)
    assert not backend.ocean_only(Bounds(0, 2, 0, 2))
    assert backend.ocean_only(Bounds(1.5, 2, 0, 2))
