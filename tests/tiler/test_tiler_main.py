import json

import numpy as np
from PIL import Image

from tiler import encode, main
from tiler.grid import TILE_SIZE, box_for_job


class FakeBackend:
    """Terre = moitié ouest de chaque bloc situé à l'ouest de −90° ; ombrage = dégradé horizontal."""

    def hillshade(self, bounds, width, height):
        return np.tile(np.linspace(64, 192, width).astype(np.uint8), (height, 1))

    def land_mask(self, bounds, width, height):
        m = np.zeros((height, width), np.uint8)
        if bounds.lon_min < -90:
            m[:, : width // 2] = 255
        return m

    def ocean_only(self, bounds):
        return bounds.lon_min >= -90


def test_build_map_box_writes_only_land_tiles_and_index(tmp_path):
    index = main.build_map_box(FakeBackend(), box_for_job(0), lines=[], out_dir=tmp_path, min_level=1, max_level=1, log=lambda *_: None)
    assert not (tmp_path / "map" / "0").exists()               # le niveau 0 est assemblé par merge-index
    assert index.has(1, 0, 0) and not index.has(1, 1, 0)
    assert not (tmp_path / "map" / "1" / "1").exists()
    assert (tmp_path / "index-partial.bin").read_bytes() == index.to_bytes()
    with Image.open(tmp_path / "map" / "1" / "0" / "0.png") as im:
        r, g, b = im.getpixel((10, 10))
        assert g == 255 and b == 0 and 64 <= r <= 192
        r2, g2, _ = im.getpixel((TILE_SIZE - 10, 10))
        assert g2 == 0 and r2 == 128                  # mer plate : R forcé à 128 hors terre


def test_build_map_box_keeps_border_only_tiles(tmp_path):
    lines = [[(0.0, 45.0), (10.0, 45.0)]]           # boîte 2 (lon 0..90) : océan pour le faux backend
    index = main.build_map_box(FakeBackend(), box_for_job(2), lines=lines, out_dir=tmp_path, min_level=1, max_level=1, log=lambda *_: None)
    assert index.has(1, 2, 0)
    with Image.open(tmp_path / "map" / "1" / "2" / "0.png") as im:
        assert np.asarray(im)[..., 2].max() == 255


def test_build_sat_and_merge_index(tmp_path):
    src = Image.new("RGB", (720, 360), (10, 20, 30))
    assert main.build_sat(src, tmp_path, max_level=1, log=lambda *_: None) == 10
    assert (tmp_path / "sat" / "1" / "3" / "1.jpg").exists()
    a = encode.TileIndex(1); a.set(1, 0, 0)
    b = encode.TileIndex(1); b.set(1, 3, 1)
    pa, pb = tmp_path / "a.bin", tmp_path / "b.bin"
    pa.write_bytes(a.to_bytes()); pb.write_bytes(b.to_bytes())
    out = main.merge_indexes([pa, pb], tmp_path, version="v1", generated_at="2026-09-06T14:00:00Z", sat_max=1, map_max=1, level1_dir=tmp_path)
    merged = encode.TileIndex.from_bytes(out.read_bytes())
    assert merged.has(1, 0, 0) and merged.has(1, 3, 1)
    assert not merged.has(0, 0, 0)                               # aucune tuile map/1 sur disque → niveau 0 océan
    m = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert m["sets"]["map"]["max_level"] == 1 and m["version"] == "v1"


def test_build_level0_from_level1_tiles(tmp_path):
    src = tmp_path / "map" / "1" / "2" / "1.png"
    src.parent.mkdir(parents=True)
    tile = np.zeros((TILE_SIZE, TILE_SIZE, 3), np.uint8)
    tile[..., 0] = 128
    tile[..., 1] = 255
    Image.fromarray(tile, "RGB").save(src)
    index = encode.TileIndex(1)
    written = main.build_level0(tmp_path, tmp_path / "out", index)
    assert written == 1 and index.has(0, 1, 0) and not index.has(0, 0, 0)
    with Image.open(tmp_path / "out" / "map" / "0" / "1" / "0.png") as im:
        assert im.getpixel((100, 400)) == (128, 255, 0)      # tuile (2,1) = quart sud-ouest de la tuile (1,0)
        assert im.getpixel((400, 100)) == (128, 0, 0)        # quart nord-est absent → océan plat


def test_cli_merge_index(tmp_path):
    a = encode.TileIndex(0); a.set(0, 1, 0)
    p = tmp_path / "a.bin"; p.write_bytes(a.to_bytes())
    rc = main.main(["merge-index", "--inputs", str(p), "--out-dir", str(tmp_path), "--version", "v9", "--sat-max", "0", "--map-max", "0"])
    assert rc == 0
    assert (tmp_path / "index.bin").exists() and (tmp_path / "manifest.json").exists()
