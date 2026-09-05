import numpy as np
from PIL import Image

from tiler import sat
from tiler.grid import TILE_SIZE


def _quadrants(w=720, h=360):
    arr = np.zeros((h, w, 3), np.uint8)
    arr[: h // 2, : w // 2] = (255, 0, 0)     # NW rouge
    arr[: h // 2, w // 2 :] = (0, 255, 0)     # NE vert
    arr[h // 2 :, : w // 2] = (0, 0, 255)     # SW bleu
    arr[h // 2 :, w // 2 :] = (255, 255, 0)   # SE jaune
    return Image.fromarray(arr, "RGB")


def test_sat_tile_level_1_maps_quadrants():
    src = _quadrants()
    nw = sat.sat_tile(src, 1, 0, 0)
    assert nw.shape == (TILE_SIZE, TILE_SIZE, 3)
    assert tuple(nw[256, 256]) == (255, 0, 0)
    assert tuple(sat.sat_tile(src, 1, 2, 0)[256, 256]) == (0, 255, 0)
    assert tuple(sat.sat_tile(src, 1, 1, 1)[256, 256]) == (0, 0, 255)
    assert tuple(sat.sat_tile(src, 1, 3, 1)[256, 256]) == (255, 255, 0)


def test_sat_tile_level_0_covers_a_hemisphere():
    west = sat.sat_tile(_quadrants(), 0, 0, 0)
    assert tuple(west[100, 256]) == (255, 0, 0) and tuple(west[400, 256]) == (0, 0, 255)


def test_iter_sat_tiles_counts():
    tiles = list(sat.iter_sat_tiles(2))
    assert len(tiles) == 2 + 8 + 32
    assert tiles[0] == (0, 0, 0) and tiles[-1] == (2, 7, 3)


def test_open_source_forces_rgb(tmp_path):
    p = tmp_path / "src.png"
    Image.new("P", (8, 4)).save(p)
    assert sat.open_source(p).mode == "RGB"
