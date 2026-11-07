"""Archives WTPK, catalogue et champ `deep` du manifeste (lot R5c)."""
from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest

from tiler.grid import tile_at
from tiler.main import TROPICS, main, tropical_bounds
from tiler.pack import cell_of, is_deep, pack_deep, read_directory, write_archive

FIXTURES = Path(__file__).parent / "fixtures"
TROP = tropical_bounds(TROPICS, 7)


def test_cell_of():
    assert cell_of(9, 0, 0) == (0, 0)
    assert cell_of(9, 1023, 511) == (35, 17)
    x, y = tile_at(9, -59.9, -5.1)
    assert cell_of(9, x, y) == (12, 9)


def test_is_deep():
    assert is_deep(9, 100, 256, TROP)  # lat ~ 0 : tropical, niveau 9
    assert not is_deep(8, 100, 128, TROP)  # tropical, niveau 8 : reste sur R2
    assert is_deep(8, 100, 40, TROP)  # lat ~ 69 : hors bande
    assert not is_deep(7, 10, 5, TROP)
    assert is_deep(8, 100, 64, TROP) is True  # lat 45


def _png(path: Path, payload: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return path


def test_archive_roundtrip(tmp_path):
    files = {
        (9, 5, 7): b"\x89PNG-aaaa",
        (8, 9, 2): b"\x89PNG-b",
        (9, 5, 6): b"\x89PNG-cccccc",
    }
    tiles = [(z, x, y, _png(tmp_path / f"{z}_{x}_{y}.png", d)) for (z, x, y), d in files.items()]
    dest = tmp_path / "c.wtpk"
    n = write_archive(tiles, dest)
    data = dest.read_bytes()
    assert n == len(data) == 16 + 48 + sum(len(d) for d in files.values())
    assert data[:4] == b"WTPK" and data[4] == 1 and data[5:8] == b"\0\0\0"
    assert struct.unpack_from("<I", data, 8)[0] == 3
    entries = read_directory(data)
    assert [e[:3] for e in entries] == sorted(files)
    for z, x, y, off, ln in entries:
        assert data[off:off + ln] == files[(z, x, y)]


def test_archive_too_big(tmp_path, monkeypatch):
    import tiler.pack as pack
    monkeypatch.setattr(pack, "MAX_ARCHIVE_BYTES", 20)
    p = _png(tmp_path / "a.png", b"x" * 10)
    with pytest.raises(ValueError, match="4 Gio"):
        write_archive([(9, 0, 0, p)], tmp_path / "c.wtpk")


def test_pack_deep_groups_by_cell_and_skips_r2_levels(tmp_path):
    out = tmp_path / "out"
    dest = tmp_path / "deep"
    # (z, x, y) -> contenu
    tiles = {
        (7, 10, 5): b"a",
        (8, 100, 128): b"bb",      # tropical : ignoré
        (8, 100, 40): b"ccc",      # tempéré : gardé
        (8, 101, 40): b"dddd",     # même cellule
        (9, 0, 0): b"eeeee",
        (9, 1023, 511): b"ffffff",
    }
    for (z, x, y), d in tiles.items():
        _png(out / "forest" / str(z) / str(x) / f"{y}.png", d)
    frag = pack_deep(out, dest, TROP)
    c1 = "{}_{}".format(*cell_of(8, 100, 40))
    assert frag == {
        c1: {"count": 2, "bytes": len(dest.joinpath(c1 + ".wtpk").read_bytes())},
        "0_0": {"count": 1, "bytes": 16 + 16 + 5},
        "35_17": {"count": 1, "bytes": 16 + 16 + 6},
    }
    assert c1 not in ("0_0", "35_17")
    assert sorted(p.name for p in dest.iterdir()) == sorted(n + ".wtpk" for n in frag)
    assert [e[:3] for e in read_directory((dest / (c1 + ".wtpk")).read_bytes())] == [(8, 100, 40), (8, 101, 40)]


def test_merge_catalog_rejects_duplicate_cell(tmp_path):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    a.write_text(json.dumps({"1_1": {"count": 1, "bytes": 5}}))
    b.write_text(json.dumps({"1_1": {"count": 2, "bytes": 9}}))
    with pytest.raises(SystemExit):
        main(["merge-deep-catalog", "--fragments", str(a), str(b), "--out", str(tmp_path / "c.json")])
    b.write_text(json.dumps({"2_2": {"count": 2, "bytes": 9}}))
    out = tmp_path / "c.json"
    assert main(["merge-deep-catalog", "--fragments", str(a), str(b), "--out", str(out)]) == 0
    assert json.loads(out.read_text()) == {
        "format": "wtpk1",
        "cells": {"1_1": {"count": 1, "bytes": 5}, "2_2": {"count": 2, "bytes": 9}},
    }


def test_add_deep_manifest_keeps_fields(tmp_path):
    src = FIXTURES / "r2-forest-manifest.json"
    out = tmp_path / "m.json"
    url = "https://huggingface.co/datasets/o/r/resolve/abc/v1.12"
    assert main(["add-deep-manifest", "--manifest", str(src), "--base-url", url, "--max-level", "9", "--out", str(out)]) == 0
    old = json.loads(src.read_text(encoding="utf-8"))
    new = json.loads(out.read_text(encoding="utf-8"))
    assert {k: v for k, v in new.items() if k != "deep"} == old
    assert new["deep"] == {"base_url": url, "max_level": 9, "catalog": "catalog.json", "format": "wtpk1"}
    with pytest.raises(SystemExit):
        main(["add-deep-manifest", "--manifest", str(src), "--base-url", url, "--max-level", "8", "--out", str(out)])
