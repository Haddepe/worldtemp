import json

import numpy as np
import pytest

from tiler import encode


def test_index_set_has_count():
    idx = encode.TileIndex(max_level=2)
    assert not idx.has(2, 3, 1)
    idx.set(2, 3, 1)
    assert idx.has(2, 3, 1)
    assert idx.count(2) == 1
    assert idx.count(0) == 0


def test_index_bytes_layout_is_lsb_first_y_major():
    idx = encode.TileIndex(max_level=1)
    idx.set(0, 1, 0)          # niveau 0 : 2 tuiles → bit 1
    idx.set(1, 0, 1)          # niveau 1 : 4×2 → i = 1·4 + 0 = 4 → bit 4
    data = idx.to_bytes()
    assert data[:4] == b"WTIX"
    assert data[4] == 1 and data[5] == 1
    assert data[6] == 0b00000010
    assert data[7] == 0b00010000
    assert len(data) == 8


def test_index_round_trip_and_size_at_level_8():
    idx = encode.TileIndex(max_level=8)
    idx.set(8, 253, 57)
    idx.set(8, 511, 255)
    back = encode.TileIndex.from_bytes(idx.to_bytes())
    assert back.max_level == 8
    assert back.has(8, 253, 57) and back.has(8, 511, 255) and not back.has(8, 0, 0)
    assert len(idx.to_bytes()) == 6 + sum(-(-2 ** (z + 1) * 2**z // 8) for z in range(9))


def test_index_rejects_bad_magic():
    with pytest.raises(ValueError):
        encode.TileIndex.from_bytes(b"NOPE\x01\x00")


def test_index_merge_is_bitwise_or():
    a = encode.TileIndex(max_level=1)
    b = encode.TileIndex(max_level=1)
    a.set(1, 0, 0)
    b.set(1, 3, 1)
    a.merge(b)
    assert a.has(1, 0, 0) and a.has(1, 3, 1)
    with pytest.raises(ValueError):
        a.merge(encode.TileIndex(max_level=2))


def test_compose_channels_and_ocean_detection():
    shade = np.full((4, 4), 128, np.uint8)
    land = np.zeros((4, 4), np.uint8)
    border = np.zeros((4, 4), np.uint8)
    rgb = encode.compose_channels(shade, land, border)
    assert rgb.shape == (4, 4, 3) and rgb.dtype == np.uint8
    assert encode.is_ocean_tile(rgb)
    land[1, 2] = 200
    assert not encode.is_ocean_tile(encode.compose_channels(shade, land, border))
    border[0, 0] = 1
    land[:] = 0
    assert not encode.is_ocean_tile(encode.compose_channels(shade, land, border))


def test_write_manifest(tmp_path):
    p = tmp_path / "manifest.json"
    encode.write_manifest(p, version="v1", generated_at="2026-09-06T14:00:00Z", sat_max=5, map_max=8)
    m = json.loads(p.read_text(encoding="utf-8"))
    assert m["schema_version"] == 1 and m["tile_size"] == 512
    assert m["sets"]["sat"] == {"ext": "jpg", "max_level": 5}
    assert m["sets"]["map"] == {"ext": "png", "max_level": 8, "index": "index.bin"}
    assert m["generated_at"] == "2026-09-06T14:00:00Z" and m["version"] == "v1"
    assert "OpenStreetMap" in " ".join(m["sources"])
