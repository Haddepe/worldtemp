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
        place("Monaco", 36_000, 7.4246, 43.7314, cla="Admin-0 capital"),
    ]
    # Berne (capitale, 400 000) reste parmi les grandes capitales (major) ; Monaco (capitale,
    # 36 000 < MAJOR_CAPITAL_POP) descend au rang d'une ville ordinaire et se classe par
    # population, derrière Aaa/Lyon (1 700 000) — sans perdre son `cap == 1` (F7).
    assert bg.build_places(feats) == [
        [2.35, 48.86, "Paris", 11_000_000, 1],
        [7.45, 46.95, "Berne", 400_000, 1],
        [121.47, 31.23, "Shanghai", 24_000_000, 0],
        [0.0, 0.0, "Aaa", 1_700_000, 0],
        [4.84, 45.77, "Lyon", 1_700_000, 0],
        [7.42, 43.73, "Monaco", 36_000, 1],
    ]


def test_build_places_ecarte_sans_nom_et_population_nulle_hors_capitale():
    feats = [
        place("", 5000, 1, 1),
        place("Vide", 0, 2, 2),
        place("Capitale vide", 0, 3, 3, cla="Admin-0 capital"),
        place("Minuscules", 10, 4, 4, upper=False),
    ]
    # « Capitale vide » (pop 0) est gardée (une capitale n'est jamais écartée pour population
    # nulle) mais, n'étant pas une grande capitale, se classe par population comme une ville
    # ordinaire : elle passe après « Minuscules » (pop 10) plutôt qu'en tête (F7).
    assert [p[2] for p in bg.build_places(feats)] == ["Minuscules", "Capitale vide"]


def test_build_places_name_fr_vide_replie_sur_name():
    assert bg.build_places([place("London", 9_000_000, -0.13, 51.51, name_fr="")])[0][2] == "London"


def country(name, rank, lon, lat, pop_est=None, name_fr=None):
    p = {"NAME": name, "LABEL_X": lon, "LABEL_Y": lat, "LABELRANK": rank}
    if name_fr is not None:
        p["NAME_FR"] = name_fr
    if pop_est is not None:
        p["POP_EST"] = pop_est
    return {"properties": p}


def test_build_countries_point_d_etiquette_rang_et_tri():
    feats = [
        country("Germany", 2, 9.678, 50.961, pop_est=8e7, name_fr="Allemagne"),
        country("France", 2, 2.552, 46.696, pop_est=6.7e7, name_fr="France"),
        country("Russia", 1, 44.69, 58.25, pop_est=1.4e8, name_fr="Russie"),
        {"properties": {"NAME": "Sans point", "LABELRANK": 3}},
    ]
    assert bg.build_countries(feats) == [
        [44.69, 58.25, "Russie", 1],
        [9.68, 50.96, "Allemagne", 2],
        [2.55, 46.7, "France", 2],
    ]


def test_country_rank_majore_le_rang_des_micro_etats():
    assert bg.country_rank({"labelrank": 6, "pop_est": 38_964}) == 8
    assert bg.country_rank({"labelrank": 6, "pop_est": 4_067_500}) == 6
    assert bg.country_rank({"labelrank": 6}) == 6
    assert bg.country_rank({}) == 9


def test_build_countries_ecarte_les_rangs_jamais_affichables():
    """Au-delà de MAX_COUNTRY_RANK, aucun palier du front n'affiche le pays : ligne morte (dette n° 41)."""
    feats = [
        country("Monaco", 6, 7.42, 43.73, pop_est=38_964, name_fr="Monaco"),
        country("Croatia", 6, 16.0, 45.1, pop_est=4_067_500, name_fr="Croatie"),
        country("Malta", 5, 14.4, 35.9, pop_est=150_000, name_fr="Malte"),
    ]
    assert [(r[2], r[3]) for r in bg.build_countries(feats)] == [("Croatie", 6), ("Malte", 7)]


def test_build_countries_ne_majore_pas_un_vrai_pays_de_rang_6():
    feats = [country("Croatia", 6, 16.0, 45.1, pop_est=4_067_500, name_fr="Croatie")]
    assert bg.build_countries(feats)[0][3] == 6


def test_build_countries_pop_est_absente_ne_penalise_pas():
    feats = [country("Kosovo", 6, 20.9, 42.6, name_fr="Kosovo")]
    assert bg.build_countries(feats)[0][3] == 6


def test_build_countries_tri_tient_compte_du_rang_majore():
    feats = [
        country("Luxembourg", 6, 6.13, 49.75, pop_est=619_896, name_fr="Luxembourg"),
        country("Malta", 5, 14.4, 35.9, pop_est=150_000, name_fr="Malte"),
    ]
    assert [r[2] for r in bg.build_countries(feats)] == ["Luxembourg", "Malte"]


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


def test_fit_budget_abandonne_si_le_budget_est_intenable():
    """Une ligne garde toujours au moins un segment : sans plafond d'itérations, boucle infinie (dette n° 41)."""
    with pytest.raises(RuntimeError, match="budget"):
        bg.fit_budget([river(2, [[0, 0], [1, 1]])], budget=0)


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


GEO = Path(__file__).resolve().parent.parent / "web" / "public" / "geo"


def test_fichiers_commites_places():
    raw = (GEO / "places.json").read_bytes()
    assert len(raw) <= 300_000 and b"\r" not in raw
    doc = json.loads(raw)
    assert doc["version"] == 1
    rows = doc["places"]
    assert 5000 <= len(rows) <= 8000
    assert all(len(r) == 5 and -180 <= r[0] <= 180 and -90 <= r[1] <= 90 and r[2] and r[4] in (0, 1) for r in rows)
    # Tri (F7) : « major » = grande capitale (cap == 1 et pop ≥ 100 000) d'abord, puis pop
    # décroissante, puis nom — une petite capitale (Monaco…) se classe parmi les villes.
    major = lambda r: 1 if r[4] == 1 and r[3] >= 100_000 else 0  # noqa: E731
    assert rows == sorted(rows, key=lambda r: (-major(r), -r[3], r[2]))
    names = {r[2] for r in rows}
    assert {"Paris", "Tokyo", "Lyon", "Marseille"} <= names
    paris = next(r for r in rows if r[2] == "Paris")
    assert paris[4] == 1 and abs(paris[0] - 2.35) < 0.2 and abs(paris[1] - 48.86) < 0.2
    marseille_idx = next(i for i, r in enumerate(rows) if r[2] == "Marseille")
    monaco_idx, monaco = next((i, r) for i, r in enumerate(rows) if r[2] == "Monaco")
    assert marseille_idx < monaco_idx  # Marseille (1,4 M) ne doit plus être masquée par Monaco
    assert monaco[4] == 1  # Monaco reste une capitale (toujours éligible), juste mal classée


def test_fichiers_commites_countries():
    raw = (GEO / "countries.json").read_bytes()
    assert len(raw) <= 15_000 and b"\r" not in raw
    rows = json.loads(raw)["countries"]
    assert 150 <= len(rows) <= 260
    assert rows == sorted(rows, key=lambda r: (r[3], r[2]))
    assert {"France", "Japon", "Brésil"} <= {r[2] for r in rows}
    by_name = {r[2]: r[3] for r in rows}
    for micro in ("Monaco", "Andorre", "Cité du Vatican"):
        assert micro not in by_name  # rang majoré au-delà de MAX_COUNTRY_RANK : jamais affichable, non écrit
    assert max(by_name.values()) <= bg.MAX_COUNTRY_RANK
    for real in ("Croatie", "Luxembourg"):
        assert by_name[real] == 6


def test_fichiers_commites_rivers():
    raw = (GEO / "rivers.bin").read_bytes()
    assert len(raw) <= 400_000
    lines = bg.decode_rivers(raw)
    assert len(lines) > 200
    assert [l[0] for l in lines] == sorted(l[0] for l in lines)
    assert all(len(pts) >= 2 and all(abs(x) <= 18000 and abs(y) <= 9000 for x, y in pts) for _, pts in lines)
    # Budget relevé à 50 000 le 2026-09-18 (F6, validation navigateur : 0,045° était anguleux
    # sous d ≈ 1,2). Borne basse : preuve que la tolérance fine (0,02°) est bien committée, pas
    # l'ancienne (0,045° ne produisait que 22 046 segments).
    assert 40_000 < bg.segment_count(lines) <= 50_000
