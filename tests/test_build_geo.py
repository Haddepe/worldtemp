"""Tests de tools/build_geo.py (spec repères §2, §5). Aucun accès réseau."""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

import build_geo as bg  # noqa: E402


def place(name, pop, lon, lat, cla="Populated place", name_fr=None, upper=True):
    p = {"NAME": name, "POP_MAX": pop, "FEATURECLA": cla}
    if name_fr is not None:
        p["NAME_FR"] = name_fr
    if not upper:
        p = {k.lower(): v for k, v in p.items()}
    return {"properties": p, "geometry": {"type": "Point", "coordinates": [lon, lat]}}


def test_props_ignore_la_casse_des_cles():
    assert bg.props({"properties": {"NAME_FR": "Paris", "pop_max": 3}}) == {"name_fr": "Paris", "pop_max": 3}


def test_build_places_trie_capitales_puis_population_puis_nom():
    feats = [
        place("Lyon", 1_700_000, 4.8351, 45.7678),
        place("Paris", 11_000_000, 2.3522, 48.8566, cla="Admin-0 capital"),
        place("Shanghai", 24_000_000, 121.4737, 31.2304),
        place("Bern", 400_000, 7.4474, 46.948, cla="Admin-0 capital", name_fr="Berne"),
        place("Aaa", 1_700_000, 0, 0),
    ]
    assert bg.build_places(feats) == [
        [2.35, 48.86, "Paris", 11_000_000, 1],
        [7.45, 46.95, "Berne", 400_000, 1],
        [121.47, 31.23, "Shanghai", 24_000_000, 0],
        [0.0, 0.0, "Aaa", 1_700_000, 0],
        [4.84, 45.77, "Lyon", 1_700_000, 0],
    ]


def test_build_places_ecarte_sans_nom_et_population_nulle_hors_capitale():
    feats = [
        place("", 5000, 1, 1),
        place("Vide", 0, 2, 2),
        place("Capitale vide", 0, 3, 3, cla="Admin-0 capital"),
        place("Minuscules", 10, 4, 4, upper=False),
    ]
    assert [p[2] for p in bg.build_places(feats)] == ["Capitale vide", "Minuscules"]


def test_build_places_name_fr_vide_replie_sur_name():
    assert bg.build_places([place("London", 9_000_000, -0.13, 51.51, name_fr="")])[0][2] == "London"


def test_build_countries_point_d_etiquette_rang_et_tri():
    feats = [
        {"properties": {"NAME": "Germany", "NAME_FR": "Allemagne", "LABEL_X": 9.678, "LABEL_Y": 50.961, "LABELRANK": 2}},
        {"properties": {"NAME": "France", "NAME_FR": "France", "LABEL_X": 2.552, "LABEL_Y": 46.696, "LABELRANK": 2}},
        {"properties": {"NAME": "Russia", "NAME_FR": "Russie", "LABEL_X": 44.69, "LABEL_Y": 58.25, "LABELRANK": 1}},
        {"properties": {"NAME": "Sans point", "LABELRANK": 3}},
    ]
    assert bg.build_countries(feats) == [
        [44.69, 58.25, "Russie", 1],
        [9.68, 50.96, "Allemagne", 2],
        [2.55, 46.7, "France", 2],
    ]


def test_simplify_retire_les_points_alignes_et_garde_les_coudes():
    line = [(0, 0), (1, 0.001), (2, 0), (2, 1), (2, 2)]
    assert bg.simplify(line, 0.02) == [(0, 0), (2, 0), (2, 2)]
    assert bg.simplify([(0, 0), (1, 1)], 0.02) == [(0, 0), (1, 1)]


def river(rank, coords, multi=False, key="scalerank"):
    geom = {"type": "MultiLineString", "coordinates": coords} if multi else {"type": "LineString", "coordinates": coords}
    return {"properties": {key: rank}, "geometry": geom}


def test_river_lines_quantifie_trie_par_rang_et_eclate_les_multilignes():
    feats = [
        river(6, [[2.0, 48.0], [2.5, 48.5]]),
        river(1, [[[30.0, 0.0], [31.0, 10.0]], [[31.0, 10.0], [31.2, 30.0]]], multi=True, key="SCALERANK"),
        river(3, [[5.0, 5.0], [5.001, 5.001]]),  # un seul point après quantification : écartée
    ]
    assert bg.river_lines(feats, 0.02) == [
        (1, [(3000, 0), (3100, 1000)]),
        (1, [(3100, 1000), (3120, 3000)]),
        (6, [(200, 4800), (250, 4850)]),
    ]


def test_segment_count_subdivise_au_dela_de_deux_degres():
    assert bg.segment_count([(1, [(0, 0), (100, 0)])]) == 1      # 1°
    assert bg.segment_count([(1, [(0, 0), (500, 0)])]) == 3      # 5° → 3 morceaux
    assert bg.segment_count([(1, [(0, 0), (100, 0), (100, 100)])]) == 2


def test_fit_budget_releve_la_tolerance_jusqu_a_tenir():
    zigzag = [[x * 0.1, 0.05 * (x % 2)] for x in range(200)]
    lines, tol = bg.fit_budget([river(2, zigzag)], budget=20, tol=0.02)
    assert bg.segment_count(lines) <= 20
    assert tol > 0.02


def test_encode_decode_rivers_aller_retour_et_entete():
    lines = [(1, [(3000, 0), (3100, 1000)]), (6, [(-200, 4800), (250, -4850), (18000, 9000)])]
    data = bg.encode_rivers(lines)
    assert data[:4] == b"WTRV"
    assert struct.unpack_from("<HI", data, 4) == (1, 2)
    assert len(data) == 10 + (4 + 2 * 4) + (4 + 3 * 4)
    assert bg.decode_rivers(data) == lines


def test_decode_rivers_refuse_un_mauvais_magic():
    with pytest.raises(ValueError):
        bg.decode_rivers(b"XXXX" + bytes(6))


def test_dump_json_est_compact_utf8_et_finit_par_un_saut_de_ligne():
    out = bg.dump_json({"version": 1, "places": [[2.35, 48.86, "Orléans", 1, 0]]})
    assert out == '{"version":1,"places":[[2.35,48.86,"Orléans",1,0]]}\n'.encode("utf-8")
    assert json.loads(out)["places"][0][2] == "Orléans"
