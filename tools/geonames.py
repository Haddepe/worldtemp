"""GeoNames → villes de détail et index de recherche (spec lot F §3). Stdlib seule.

MIROIR TS de la normalisation : web/src/search/normalize.ts. Les deux sont testés avec les
mêmes cas (tests/fixtures/geo_normalize_cases.json) : modifier l'un impose de modifier l'autre.
"""

from __future__ import annotations

import re
import unicodedata

# Lettres que la décomposition NFD ne ramène pas à l'ASCII.
_FOLD = {"ß": "ss", "ø": "o", "ł": "l", "æ": "ae", "œ": "oe", "đ": "d", "ı": "i", "þ": "th", "ð": "d"}
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_PREFIX_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789")
_LATIN_PUNCT = set(" -\u0027\u2019.(),/")


def normalize(s: str) -> str:
    """Minuscules, sans diacritiques, tout ce qui n'est pas [a-z0-9] → une espace, bords rognés."""
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = "".join(_FOLD.get(c, c) for c in s)
    return _NON_ALNUM.sub(" ", s).strip()


def prefix_of(key: str) -> str:
    """Nom du fichier d'index : 2 premiers caractères de la clé normalisée, hors [a-z0-9] → `_`."""
    return "".join(c if c in _PREFIX_CHARS else "_" for c in key[:2]).ljust(2, "_")


def is_latin(s: str) -> bool:
    """Au moins une lettre, et uniquement des lettres latines, chiffres, espaces, apostrophes (U+0027, U+2019) et -.(),/."""
    has_letter = False
    for c in s:
        if c.isalpha():
            if not unicodedata.name(c, "").startswith("LATIN"):
                return False
            has_letter = True
        elif not (c.isdigit() or c in _LATIN_PUNCT):
            return False
    return has_letter


def display_name(name: str, ascii_name: str) -> str:
    """Nom GeoNames s'il est en écriture latine (« Épinal »), sinon `asciiname` (spec §3.2)."""
    return name if name and is_latin(name) else ascii_name
