from pathlib import Path

import numpy as np

from tiler import borders
from tiler.grid import Bounds

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "tiler" / "borders.geojson"


def test_load_geojson_lines_flattens_multilinestrings():
    lines = borders.load_geojson_lines(FIXTURE)
    assert len(lines) == 3
    assert lines[0] == [(0.0, 5.0), (10.0, 5.0)]
    assert lines[2] == [(50.0, 50.0), (60.0, 60.0)]


def test_lines_in_bounds_filters_by_bbox():
    lines = borders.load_geojson_lines(FIXTURE)
    kept = borders.lines_in_bounds(lines, Bounds(0, 10, 0, 10))
    assert len(kept) == 2
    assert borders.lines_in_bounds(lines, Bounds(-40, -30, -40, -30)) == []


def test_rasterize_horizontal_line_is_antialiased_and_where_expected():
    img = borders.rasterize_lines([[(0.0, 5.0), (10.0, 5.0)]], Bounds(0, 10, 0, 10), 100, 100)
    assert img.shape == (100, 100) and img.dtype == np.uint8
    # lat 5 → milieu de l'image (ligne 50, v=0 en haut = lat_max)
    assert img[50, 50] == 255 or img[49, 50] == 255
    assert img[10, 50] == 0 and img[90, 50] == 0
    # trait ≈ 1,5 px : la colonne 50 a entre 1 et 4 pixels non nuls, dont des valeurs intermédiaires
    col = img[:, 50]
    assert 1 <= int((col > 0).sum()) <= 4
    assert img.max() == 255


def test_rasterize_empty_lines_is_all_zero():
    img = borders.rasterize_lines([], Bounds(0, 10, 0, 10), 32, 32)
    assert not img.any()
