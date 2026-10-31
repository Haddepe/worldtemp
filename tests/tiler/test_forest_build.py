"""Commande `forest` du tiler : blocs Hansen -> pyramide de tuiles forêt, index, manifeste (Task 3)."""
import json
import math

import numpy as np
import pytest
from PIL import Image

from tiler import encode, forest, main
from tiler.grid import TILE_SIZE, Bounds, box_for_job, tile_bounds
from tiler.hansen import HansenReadError

BOX0 = box_for_job(0)  # lon -180..-90, lat 0..90
QUIET = lambda *_: None  # noqa: E731


class FakeHansen:
    """Forêt (couvert 80 %) à l'ouest de -135°, perte en 2010 (année 10) sur la bande lat 60..70 ; rien ailleurs."""

    def __init__(self, fail_at: int | None = None):
        self.calls = []
        self.fail_at = fail_at
        self.closed = False

    def read_block(self, bounds, width, height, factor):
        self.calls.append((bounds, width, height, factor))
        if self.fail_at is not None and len(self.calls) >= self.fail_at:
            raise HansenReadError("dalle illisible (test)")
        w, h = width * factor, height * factor
        lon = bounds.lon_min + (np.arange(w) + 0.5) * bounds.width / w
        lat = bounds.lat_max - (np.arange(h) + 0.5) * bounds.height / h
        forest_mask = np.broadcast_to(lon[None, :] < -135, (h, w))
        cover = np.where(forest_mask, 80, 0).astype(np.uint8)
        band = (lat[:, None] > 60) & (lat[:, None] < 70)
        loss = np.where(forest_mask & band, 10, 0).astype(np.uint8)
        return cover, loss

    def close(self):
        self.closed = True


def _levels_of(calls):
    """Niveau z de chaque lecture, déduit du pas en pixels (180 / (512 · 2^z) degrés)."""
    return [round(math.log2(180 / (TILE_SIZE * b.width / w))) for b, w, _, _ in calls]


def _files(root, z):
    d = root / "forest" / str(z)
    return {(int(p.parent.name), int(p.stem)) for p in d.glob("*/*.png")} if d.exists() else set()


def _index_tiles(index, z):
    cols, rows = 2 ** (z + 1), 2**z
    return {(x, y) for y in range(rows) for x in range(cols) if index.has(z, x, y)}


def _tile(root, z, x, y):
    with Image.open(root / "forest" / str(z) / str(x) / f"{y}.png") as im:
        return np.asarray(im.convert("RGB"))


def _build(tmp_path, backend, **kw):
    args = dict(min_level=1, max_level=3, max_level_outside=3, tropics=main.TROPICS, block=2, log=QUIET, factor_for=lambda z: 2)
    args.update(kw)
    return main.build_forest_box(backend, BOX0, tmp_path, **args)


# --- facteur et blocs par niveau (règles R1 et R2) ---


def test_forest_factor_follows_rule_r1():
    assert [main.forest_factor(z) for z in (8, 7, 6, 1, 0)] == [6, 11, 22, 704, 1407]
    for z in range(9):
        f = main.forest_factor(z)
        px = 180 / (TILE_SIZE * 2**z)
        assert f == math.ceil(px / 0.00025) and (f - 1) * 0.00025 < px <= f * 0.00025 + 1e-15


def test_forest_block_keeps_peak_under_3_gb():
    assert main.forest_block(8, main.forest_factor(8)) == 6
    assert main.forest_block(7, main.forest_factor(7)) == 4
    assert main.forest_block(6, main.forest_factor(6)) == 2
    for z in (6, 7, 8):
        b = main.forest_block(z, main.forest_factor(z))
        assert main.forest_peak_bytes(b, main.forest_factor(z)) <= 3e9
    # Mesure de Task 2 : bloc 8 au facteur 5 ≈ 2,3 Go ; bloc 8 au niveau 7 ≈ 11 Go.
    assert main.forest_peak_bytes(8, 5) == pytest.approx(2.3e9)
    assert main.forest_peak_bytes(8, 11) == pytest.approx(11.1e9, rel=0.01)


def test_default_tropics_contain_the_three_page_regions():
    t = main.TROPICS
    assert t == Bounds(-180, 180, -30, 30)
    for lon, lat in [(-60, -8), (-63, -11), (-52, -4), (112, 0), (101, 0), (22, 0)]:  # Amazonie, Rondônia, Pará, Bornéo, Sumatra, Congo
        assert t.lon_min < lon < t.lon_max and t.lat_min < lat < t.lat_max


# --- construction d'une boîte ---


def test_build_forest_box_writes_tiles_index_and_skips_empty_blocks(tmp_path):
    fake = FakeHansen()
    index = _build(tmp_path, fake)
    # Hansen n'est lu qu'au niveau le plus fin, au facteur demandé, bloc de 2 x 2 tuiles.
    assert set(_levels_of(fake.calls)) == {3} and len(fake.calls) == 4
    assert all(f == 2 and (w, h) == (2 * TILE_SIZE, 2 * TILE_SIZE) for _, w, h, f in fake.calls)
    # Forêt à l'ouest de -135° : tuiles x = 0, 1 au niveau 3 (22,5°) ; blocs vides (x >= 2) non écrits.
    assert _files(tmp_path, 3) == {(x, y) for x in (0, 1) for y in range(4)}
    assert not (tmp_path / "forest" / "3" / "2").exists()
    assert _files(tmp_path, 2) == {(0, 0), (0, 1)}
    assert _files(tmp_path, 1) == {(0, 0)}
    assert not (tmp_path / "forest" / "0").exists()  # niveau 0 : assemblé par merge-forest-index
    for z in (1, 2, 3):
        assert _index_tiles(index, z) == _files(tmp_path, z)
    assert index.max_level == 3
    assert (tmp_path / "index-partial.bin").read_bytes() == index.to_bytes()
    # Canaux : couvert 80, année 10 sur la bande 60..70 N, part 255 (tout perdu) ; rien hors forêt.
    t = _tile(tmp_path, 3, 0, 1)  # lat 67,5..45 : la bande 60..70 couvre le haut
    assert t[10, 10].tolist() == [80, 10, 255]
    assert t[-10, 10].tolist() == [80, 0, 0]
    # Niveau 2 réduit 2x2 depuis le niveau 3 : même contenu à la moitié de la résolution.
    t2 = _tile(tmp_path, 2, 0, 0)  # lat 90..45, lon -180..-135
    assert t2[300, 10].tolist() == [80, 10, 255]  # lat ≈ 63,6
    assert t2[10, 10].tolist() == [80, 0, 0]


def test_reduction_matches_aggregate_of_children(tmp_path):
    _build(tmp_path, FakeHansen())
    big = np.zeros((2 * TILE_SIZE, 2 * TILE_SIZE, 3), np.uint8)
    for dy in (0, 1):
        for dx in (0, 1):
            if (dx, dy) in _files(tmp_path, 3):
                big[dy * TILE_SIZE : (dy + 1) * TILE_SIZE, dx * TILE_SIZE : (dx + 1) * TILE_SIZE] = _tile(tmp_path, 3, dx, dy)
    c, y, s = forest.aggregate(big[..., 0], big[..., 1], 2, big[..., 2])
    assert np.array_equal(_tile(tmp_path, 2, 0, 0), forest.encode_tile(c, y, s))


def test_levels_above_max_level_outside_only_in_tropics(tmp_path):
    fake = FakeHansen()
    tropics = Bounds(-180, -160, 60, 70)  # niveau 2 (45°) : seule la tuile (0, 0) est tropicale
    index = _build(tmp_path, fake, max_level=3, max_level_outside=2, tropics=tropics, block=1)
    levels = _levels_of(fake.calls)
    # Niveau 3 lu seulement sous la tuile tropicale (0, 0) du niveau 2 : enfants x, y ∈ {0, 1}.
    l3 = [b for (b, *_), z in zip(fake.calls, levels) if z == 3]
    assert len(l3) == 4 and all(b.lon_max <= -135 and b.lat_min >= 45 for b in l3)
    assert _files(tmp_path, 3) == {(0, 0), (0, 1), (1, 0), (1, 1)}
    assert _index_tiles(index, 3) == _files(tmp_path, 3)
    # Niveau 2 : la tuile tropicale est réduite (pas lue) ; les autres sont lues dans Hansen.
    l2 = [b for (b, *_), z in zip(fake.calls, levels) if z == 2]
    assert tile_bounds(2, 0, 0) not in l2 and len(l2) == 3
    assert _files(tmp_path, 2) == {(0, 0), (0, 1)}
    assert set(levels) == {2, 3}


def test_tropical_tiles_are_snapped_to_the_outside_grid():
    # Bande tropicale -30..30 au niveau 7 (1,40625°) : tuiles débordant la bande incluses entières.
    x0, x1, y0, y1 = main.tropical_tiles(Bounds(-180, 180, -30, 30), 7)
    s = 180 / 2**7
    assert (x0, x1) == (0, 255)
    assert 90 - y0 * s > 30 > 90 - (y0 + 1) * s and 90 - (y1 + 1) * s < -30 < 90 - y1 * s
    # Bord exactement sur la grille : la tuile voisine n'est pas incluse.
    assert main.tropical_tiles(Bounds(-180, -135, 45, 90), 2) == (0, 0, 0, 0)


def test_max_level_outside_must_not_exceed_max_level(tmp_path):
    with pytest.raises(ValueError):
        _build(tmp_path, FakeHansen(), max_level=2, max_level_outside=3)
    with pytest.raises(ValueError):
        _build(tmp_path, FakeHansen(), min_level=0)


def test_backend_error_fails_the_build_without_index(tmp_path):
    with pytest.raises(HansenReadError):
        _build(tmp_path, FakeHansen(fail_at=2))
    assert not (tmp_path / "index-partial.bin").exists()


def test_sample_reads_one_block_in_k_and_reports_sizes(tmp_path):
    fake = FakeHansen()
    sizes = {}
    index = _build(tmp_path, fake, block=1, sample=2, sizes=sizes)
    assert len(fake.calls) == 8  # 16 blocs au niveau 3, un sur deux
    assert all(int(round((b.lon_min + 180) / 22.5)) % 2 == 0 for b, *_ in fake.calls)  # rang pair (y majeur, 4 par rangée)
    assert set(sizes) == {1, 2, 3}
    for z in (1, 2, 3):
        on_disk = sum(p.stat().st_size for p in (tmp_path / "forest" / str(z)).glob("*/*.png"))
        assert sizes[z] == on_disk > 0
    assert _index_tiles(index, 3) == {(0, y) for y in range(4)}


# --- CLI ---


@pytest.fixture
def fake_cli(monkeypatch):
    import tiler.hansen as hansen_mod

    made = []

    def factory(work_dir, **kw):
        made.append(FakeHansen())
        return made[-1]

    monkeypatch.setattr(hansen_mod, "HansenBackend", factory)
    monkeypatch.setattr(main, "forest_factor", lambda z: 2)
    return made


def test_cli_forest_builds_a_box(tmp_path, fake_cli, capsys):
    rc = main.main(["forest", "--box", "0", "--out", str(tmp_path / "out"), "--work", str(tmp_path / "work"),
                    "--min-level", "1", "--max-level", "2", "--max-level-outside", "2", "--tropics=-180,180,-30,30"])
    assert rc == 0
    assert fake_cli[0].closed
    assert (tmp_path / "out" / "forest" / "2" / "0" / "0.png").exists()
    assert (tmp_path / "out" / "index-partial.bin").exists()
    assert "boîte 0" in capsys.readouterr().out


def test_cli_forest_sample_prints_estimate(tmp_path, fake_cli, capsys):
    rc = main.main(["forest", "--box", "0", "--out", str(tmp_path / "out"), "--work", str(tmp_path / "work"),
                    "--min-level", "1", "--max-level", "2", "--max-level-outside", "2", "--block", "1", "--sample", "2"])
    assert rc == 0
    out = capsys.readouterr().out
    assert len(fake_cli[0].calls) == 2  # 4 blocs au niveau 2, un sur deux
    assert "niveau 2" in out and "niveau 1" in out and "extrapolé" in out
    line = next(l for l in out.splitlines() if l.startswith("échantillon niveau 2"))
    measured = sum(p.stat().st_size for p in (tmp_path / "out" / "forest" / "2").glob("*/*.png"))
    assert f"{measured} octets" in line and f"{measured * 2} octets extrapolés" in line


def test_cli_forest_backend_error_fails(tmp_path, monkeypatch):
    import tiler.hansen as hansen_mod

    made = []
    monkeypatch.setattr(hansen_mod, "HansenBackend", lambda work_dir, **kw: made.append(FakeHansen(fail_at=1)) or made[-1])
    monkeypatch.setattr(main, "forest_factor", lambda z: 2)
    with pytest.raises(HansenReadError):
        main.main(["forest", "--box", "0", "--out", str(tmp_path / "out"), "--work", str(tmp_path / "work"),
                   "--max-level", "2", "--max-level-outside", "2"])
    assert made[0].closed  # dalles nettoyées même en cas d'échec
    assert not (tmp_path / "out" / "index-partial.bin").exists()


def test_parse_tropics():
    assert main.parse_bounds("-180,180,-30,30") == Bounds(-180, 180, -30, 30)
    with pytest.raises(ValueError):
        main.parse_bounds("1,2,3")
    with pytest.raises(ValueError):
        main.parse_bounds("10,0,-30,30")


# --- fusion, niveau 0, manifeste ---


def test_merge_forest_index_assembles_level0_and_writes_manifest(tmp_path):
    out_box = tmp_path / "box0"
    index = _build(out_box, FakeHansen())
    part = out_box / "index-partial.bin"
    other = encode.TileIndex(3); other.set(3, 10, 2)
    p2 = tmp_path / "b.bin"; p2.write_bytes(other.to_bytes())
    out_dir = tmp_path / "final"
    res = main.merge_forest_indexes([part, p2], out_dir, version="v1.12", generated_at="2026-10-31T12:00:00Z",
                                    max_level=3, max_level_outside=3, tropics=main.TROPICS, level1_dir=out_box)
    merged = encode.TileIndex.from_bytes(res.read_bytes())
    assert merged.has(3, 10, 2) and merged.has(3, 0, 0) and merged.has(1, 0, 0)
    # Niveau 0 : tuile ouest assemblée (2x2 depuis forest/1), tuile est vide donc absente.
    assert merged.has(0, 0, 0) and not merged.has(0, 1, 0)
    t0 = _tile(out_dir, 0, 0, 0)
    assert t0[..., 0].max() == 80 and set(np.unique(t0[..., 0])) <= {0, 80}
    assert not (out_dir / "forest" / "0" / "1").exists()
    m = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    for key in ("schema_version", "version", "tile_size", "max_level", "max_level_outside", "tropics",
                "channels", "threshold", "source", "license", "generated_at"):
        assert key in m, key
    assert m["version"] == "v1.12" and m["tile_size"] == TILE_SIZE and m["max_level"] == 3
    assert m["max_level_outside"] == 3 and m["threshold"] == forest.FOREST_THRESHOLD == 30
    assert m["tropics"] == {"lon_min": -180, "lon_max": 180, "lat_min": -30, "lat_max": 30}
    assert m["channels"] == {"cover": 0, "year": 1, "share": 2}
    assert m["license"] == "CC BY 4.0" and "Hansen" in m["source"] and "v1.12" in m["source"]
    assert m["generated_at"] == "2026-10-31T12:00:00Z" and m["index"] == "index.bin"


def test_cli_merge_forest_index(tmp_path):
    a = encode.TileIndex(8); a.set(8, 3, 4)
    pa = tmp_path / "a.bin"; pa.write_bytes(a.to_bytes())
    rc = main.main(["merge-forest-index", "--inputs", str(pa), "--out-dir", str(tmp_path / "o"), "--version", "v1.12",
                    "--max-level", "8", "--max-level-outside", "7", "--tropics=-180,180,-25,25"])
    assert rc == 0
    m = json.loads((tmp_path / "o" / "manifest.json").read_text(encoding="utf-8"))
    assert m["max_level_outside"] == 7 and m["tropics"]["lat_min"] == -25
    assert encode.TileIndex.from_bytes((tmp_path / "o" / "index.bin").read_bytes()).has(8, 3, 4)
