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
    assert gn.is_latin("L'Isle-sur-la-Sorgue")
    assert not gn.is_latin("北京")
    assert not gn.is_latin("Москва")
    assert not gn.is_latin("")
    assert not gn.is_latin("123")  # aucune lettre


def test_display_name_prend_le_nom_latin_sinon_ascii():
    assert gn.display_name("Épinal", "Epinal") == "Épinal"
    assert gn.display_name("北京", "Beijing") == "Beijing"
    assert gn.display_name("", "Nowhere") == "Nowhere"
