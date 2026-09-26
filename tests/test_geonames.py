"""Tests de tools/geonames.py (spec lot F §3). Aucun accès réseau."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import geonames as gn  # noqa: E402

CASES = json.loads((ROOT / "tests" / "fixtures" / "geo_normalize_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("raw,expected", CASES["normalize"])
def test_normalize_cas_partages(raw, expected):
    assert gn.normalize(raw) == expected


@pytest.mark.parametrize("key,expected", CASES["prefix"])
def test_prefix_of_cas_partages(key, expected):
    assert gn.prefix_of(key) == expected


def test_is_latin():
    assert gn.is_latin("Épinal")
    assert gn.is_latin("Saint-Dié-des-Vosges")
    assert gn.is_latin("St. John's (Old Town)")
    assert gn.is_latin("Kōfu")
    assert gn.is_latin("L\u2019Isle-sur-la-Sorgue")  # apostrophe typographique U+2019
    assert not gn.is_latin("北京")
    assert not gn.is_latin("Москва")
    assert not gn.is_latin("")
    assert not gn.is_latin("123")  # aucune lettre


def test_display_name_prend_le_nom_latin_sinon_ascii():
    assert gn.display_name("Épinal", "Epinal") == "Épinal"
    assert gn.display_name("北京", "Beijing") == "Beijing"
    assert gn.display_name("", "Nowhere") == "Nowhere"


def gn_line(gid, name, ascii_name, alt, lat, lon, cc, admin1, pop):
    """Une ligne de cities1000.txt (19 colonnes TSV, seules celles lues par le module sont remplies)."""
    cols = [str(gid), name, ascii_name, ",".join(alt), str(lat), str(lon), "P", "PPL", cc, "", admin1,
            "", "", "", str(pop), "", "0", "Europe/Paris", "2024-01-01"]
    return "\t".join(cols) + "\n"


EPINAL = gn_line(3020035, "Épinal", "Epinal", ["Epinal", "Spinal"], 48.17264, 6.44976, "FR", "44", 32_188)
MUNICH = gn_line(2867714, "Munich", "Munich", ["München", "Monaco di Baviera", "Мюнхен"], 48.13743, 11.57549, "DE", "02", 1_260_391)
VILLAGE = gn_line(1, "Petitbourg", "Petitbourg", [], 48.0, 6.0, "FR", "44", 900)
BEIJING = gn_line(1816670, "北京", "Beijing", [], 39.9042, 116.4074, "CN", "22", 18_960_744)
SOCLE = [[11.58, 48.14, "Munich", 1_275_000, 0], [2.35, 48.86, "Paris", 11_000_000, 1]]


def test_parse_cities_filtre_la_population_et_lit_les_colonnes():
    cities = gn.parse_cities([EPINAL, VILLAGE, "ligne tronquée\n"])
    assert len(cities) == 1
    c = cities[0]
    assert (c.name, c.ascii, c.alt, c.cc, c.admin1, c.pop) == ("Épinal", "Epinal", ("Epinal", "Spinal"), "FR", "44", 32_188)
    assert (c.lat, c.lon) == (48.17264, 6.44976)


def test_parse_admin1_et_countries():
    assert gn.parse_admin1(["FR.44\tGrand Est\tGrand Est\t11071622\n"]) == {"FR.44": "Grand Est"}
    lines = ["# ISO\tISO3\n", "FR\tFRA\t250\tFR\tFrance\tParis\t547030\t67000000\tEU\n"]
    assert gn.parse_countries(lines) == {"FR": "France"}


def test_match_socle_par_nom_normalise_et_distance():
    cities = gn.parse_cities([MUNICH, EPINAL])
    matches = gn.match_socle(cities, SOCLE)
    assert matches == {0: SOCLE[0]}  # Munich ↔ socle ; Épinal n'a pas d'équivalent


def test_match_socle_refuse_au_dela_de_10_km():
    loin = [[11.80, 48.14, "Munich", 1_275_000, 0]]  # ~17 km à l'est
    assert gn.match_socle(gn.parse_cities([MUNICH]), loin) == {}


def test_match_socle_refuse_un_nom_different():
    autre = [[11.58, 48.14, "Augsburg", 300_000, 0]]
    assert gn.match_socle(gn.parse_cities([MUNICH]), autre) == {}


def test_build_detail_tiles_ecarte_les_doublons_et_range_par_tuile():
    cities = gn.parse_cities([MUNICH, EPINAL, BEIJING])
    tiles = gn.build_detail_tiles(cities, gn.match_socle(cities, SOCLE))
    # Épinal (6,45 ; 48,17) au niveau 5 : cases de 5,625° → x = 33, y = 7.
    assert tiles[(33, 7)] == [[6.45, 48.17, "Épinal", 32_188]]
    assert all(row[2] != "Munich" for rows in tiles.values() for row in rows)
    beijing = [row for rows in tiles.values() for row in rows if row[3] == 18_960_744]
    assert beijing == [[116.41, 39.9, "Beijing", 18_960_744]]  # nom non latin → asciiname


def test_build_detail_tiles_trie_par_population_puis_nom():
    a = gn_line(1, "Bbb", "Bbb", [], 48.1, 6.1, "FR", "44", 5000)
    b = gn_line(2, "Aaa", "Aaa", [], 48.2, 6.2, "FR", "44", 5000)
    c = gn_line(3, "Ccc", "Ccc", [], 48.3, 6.3, "FR", "44", 9000)
    tiles = gn.build_detail_tiles(gn.parse_cities([a, b, c]), {})
    assert [r[2] for r in tiles[(33, 7)]] == ["Ccc", "Aaa", "Bbb"]


def test_build_search_index():
    cities = gn.parse_cities([MUNICH, EPINAL])
    matches = gn.match_socle(cities, SOCLE)
    admin1 = {"FR.44": "Grand Est", "DE.02": "Bavaria"}
    countries = {"FR": "France", "DE": "Germany"}
    index = gn.build_search_index(cities, matches, admin1, countries)
    # Épinal : clé primaire « epinal » (nom et ascii) ; pas d'alternatenames sous 100 000 hab.
    assert index["ep"] == [["Épinal", "Grand Est", "France", 6.45, 48.17, 32_188, ["epinal"], []]]
    assert "sp" not in index
    # Munich : nom, coordonnées et population du socle ; exonymes latins indexés en clés
    # alternatives (≥ 100 000 hab.), chaque fichier ne portant que les clés de son préfixe ;
    # l'alternatename cyrillique est ignoré.
    assert index["mu"] == [["Munich", "Bavaria", "Germany", 11.58, 48.14, 1_275_000, ["munich"], ["munchen"]]]
    assert index["mo"] == [["Munich", "Bavaria", "Germany", 11.58, 48.14, 1_275_000, [], ["monaco di baviera"]]]


def test_build_search_index_retire_des_alternatives_les_cles_deja_primaires():
    # « Epinal » en alternatename (≥ 100 000 hab. pour l'exemple) doublonne la clé primaire.
    grande = gn_line(9, "Épinal", "Epinal", ["Epinal", "Spinal"], 48.17, 6.45, "FR", "44", 150_000)
    index = gn.build_search_index(gn.parse_cities([grande]), {}, {}, {})
    assert index["ep"][0][6:] == [["epinal"], []]
    assert index["sp"][0][6:] == [[], ["spinal"]]


def test_build_search_index_une_seule_entree_par_ligne_du_socle():
    # Deux lignes GeoNames rattachées à la même ligne du socle (cas Hong Kong, Bristol) :
    # une seule entrée, celle de la ville GeoNames la plus peuplée (sa région, ses clés).
    petite = gn_line(2, "München-Nord", "Muenchen-Nord", ["Munich"], 48.15, 11.57, "DE", "09", 200_000)
    cities = gn.parse_cities([petite, MUNICH])
    matches = gn.match_socle(cities, SOCLE)
    assert len(matches) == 2 and matches[0] is matches[1]
    index = gn.build_search_index(cities, matches, {"DE.02": "Bavaria", "DE.09": "X"}, {"DE": "Germany"})
    assert [e[:3] for rows in index.values() for e in rows] == [
        ["Munich", "Bavaria", "Germany"], ["Munich", "Bavaria", "Germany"]]  # fichiers « mu » et « mo »
    assert index["mu"] == [["Munich", "Bavaria", "Germany", 11.58, 48.14, 1_275_000, ["munich"], ["munchen"]]]


def test_build_search_index_trie_par_population_decroissante():
    a = gn_line(1, "Saint-Dié-des-Vosges", "Saint-Die-des-Vosges", [], 48.28, 6.95, "FR", "44", 19_000)
    b = gn_line(2, "Saintes", "Saintes", [], 45.74, -0.63, "FR", "75", 25_000)
    index = gn.build_search_index(gn.parse_cities([a, b]), {}, {}, {"FR": "France"})
    assert [e[0] for e in index["sa"]] == ["Saintes", "Saint-Dié-des-Vosges"]
    assert index["sa"][1][1] == ""  # région inconnue → vide
