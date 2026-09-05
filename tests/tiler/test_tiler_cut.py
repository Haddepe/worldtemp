import numpy as np
from PIL import Image

from tiler import cut
from tiler.grid import TILE_SIZE, Block


def _block_image(nx, ny, channels=3):
    h, w = ny * TILE_SIZE, nx * TILE_SIZE
    arr = np.zeros((h, w, channels), np.uint8)
    for iy in range(ny):
        for ix in range(nx):
            arr[iy * TILE_SIZE : (iy + 1) * TILE_SIZE, ix * TILE_SIZE : (ix + 1) * TILE_SIZE, 0] = iy * 16 + ix
    return arr


def test_cut_block_yields_absolute_tile_coordinates():
    block = Block(z=3, x0=8, y0=2, nx=2, ny=2)
    tiles = list(cut.cut_block(_block_image(2, 2), block))
    assert [(x, y) for x, y, _ in tiles] == [(8, 2), (9, 2), (8, 3), (9, 3)]
    assert all(t.shape == (TILE_SIZE, TILE_SIZE, 3) for _, _, t in tiles)
    assert tiles[3][2][0, 0, 0] == 1 * 16 + 1


def test_cut_block_rejects_wrong_size():
    block = Block(z=3, x0=0, y0=0, nx=2, ny=1)
    try:
        list(cut.cut_block(_block_image(1, 1), block))
    except ValueError as e:
        assert "512" in str(e)
    else:
        raise AssertionError("ValueError attendue")


def test_tile_path_and_writers(tmp_path):
    p = cut.tile_path(tmp_path, "map", 8, 253, 57, "png")
    assert p == tmp_path / "map" / "8" / "253" / "57.png"
    assert p.parent.is_dir()
    rgb = np.zeros((TILE_SIZE, TILE_SIZE, 3), np.uint8)
    rgb[..., 0] = 128
    cut.write_png(p, rgb)
    with Image.open(p) as im:
        assert im.mode == "RGB" and im.size == (TILE_SIZE, TILE_SIZE)
        assert im.getpixel((0, 0)) == (128, 0, 0)
    j = cut.tile_path(tmp_path, "sat", 0, 1, 0, "jpg")
    cut.write_jpeg(j, rgb)
    with Image.open(j) as im:
        assert im.format == "JPEG" and im.size == (TILE_SIZE, TILE_SIZE)
