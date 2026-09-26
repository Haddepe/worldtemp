"""GeoNames → villes de détail et index de recherche (spec lot F §3). Stdlib seule.

MIROIR TS de la normalisation : web/src/search/normalize.ts. Les deux sont testés avec les
mêmes cas (tests/fixtures/geo_normalize_cases.json) : modifier l'un impose de modifier l'autre.
"""

from __future__ import annotations

import re
import unicodedata

import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tiler.grid import tile_at  # noqa: E402  (même grille que web/src/tiles/grid.ts)

MIN_POP = 1000
# Sections de lieu habité (arrondissements, quartiers : « Paris 15 Vaugirard », « Lyon 03 ») :
# écartées, elles encombraient la recherche et les étiquettes (validation navigateur T11, V2).
EXCLUDED_CODES = frozenset({"PPLX"})
# Sous ce seuil, les alternatenames ne sont pas indexés : ils gonfleraient l'index de dizaines de Mo
# pour des noms de villages rarement cherchés ; au-dessus, ils portent les exonymes (« munchen »).
ALT_KEYS_MIN_POP = 100_000
DEDUP_KM = 10.0
DETAIL_LEVEL = 5
EARTH_KM = 6371.0

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


@dataclass(frozen=True)
class City:
    name: str
    ascii: str
    alt: tuple[str, ...]
    lat: float
    lon: float
    cc: str
    admin1: str
    pop: int


def parse_cities(lines: Iterable[str]) -> list[City]:
    """cities1000.txt : colonnes 1 name, 2 asciiname, 3 alternatenames, 4 lat, 5 lon, 7 feature code, 8 pays,
    10 admin1, 14 pop. Les lignes de code EXCLUDED_CODES (PPLX) sont écartées."""
    out = []
    for line in lines:
        f = line.rstrip("\n").split("\t")
        if len(f) < 15:
            continue
        pop = int(f[14] or 0)
        if pop < MIN_POP or f[7] in EXCLUDED_CODES:
            continue
        alt = tuple(a for a in f[3].split(",") if a)
        out.append(City(f[1], f[2], alt, float(f[4]), float(f[5]), f[8], f[10], pop))
    return out


def parse_admin1(lines: Iterable[str]) -> dict[str, str]:
    """admin1CodesASCII.txt : `CC.code`, nom, nom ASCII, geonameid → {`CC.code`: nom ASCII}."""
    out = {}
    for line in lines:
        f = line.rstrip("\n").split("\t")
        if len(f) >= 3:
            out[f[0]] = f[2]
    return out


def parse_countries(lines: Iterable[str]) -> dict[str, str]:
    """countryInfo.txt : lignes `#` ignorées ; colonne 0 ISO, colonne 4 nom anglais."""
    out = {}
    for line in lines:
        if line.startswith("#"):
            continue
        f = line.rstrip("\n").split("\t")
        if len(f) >= 5:
            out[f[0]] = f[4]
    return out


def _km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_KM * math.asin(min(1.0, math.sqrt(h)))


def _names(c: City) -> set[str]:
    return {normalize(n) for n in (c.name, c.ascii, *c.alt) if n}


def match_socle(cities: list[City], socle_rows: list[list]) -> dict[int, list]:
    """Index de ville GeoNames → ligne du socle `[lon, lat, name, pop, cap]` représentant le même lieu
    (spec §3.3) : nom normalisé du socle parmi les noms de la ville, à moins de DEDUP_KM ; le plus proche."""
    buckets: dict[tuple[int, int], list[list]] = {}
    for row in socle_rows:
        buckets.setdefault((math.floor(row[1]), math.floor(row[0])), []).append(row)
    out = {}
    for i, c in enumerate(cities):
        names = _names(c)
        best, best_km = None, DEDUP_KM
        cy, cx = math.floor(c.lat), math.floor(c.lon)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for row in buckets.get((cy + dy, cx + dx), ()):
                    if normalize(row[2]) not in names:
                        continue
                    km = _km(c.lon, c.lat, row[0], row[1])
                    if km < best_km:
                        best, best_km = row, km
        if best is not None:
            out[i] = best
    return out


def build_detail_tiles(cities: list[City], matches: dict[int, list]) -> dict[tuple[int, int], list[list]]:
    """Villes sans équivalent dans le socle, rangées par tuile du niveau DETAIL_LEVEL (spec §3.4)."""
    tiles: dict[tuple[int, int], list[list]] = {}
    for i, c in enumerate(cities):
        if i in matches:
            continue
        name = display_name(c.name, c.ascii)
        if not name:
            continue
        tiles.setdefault(tile_at(DETAIL_LEVEL, c.lon, c.lat), []).append([round(c.lon, 2), round(c.lat, 2), name, c.pop])
    for rows in tiles.values():
        rows.sort(key=lambda r: (-r[3], r[2]))
    return tiles


def _norm_keys(raw: Iterable[str], exclude: Iterable[str] = ()) -> list[str]:
    """Clés normalisées des noms latins, sans doublon, dans l'ordre, hors `exclude`."""
    keys: list[str] = []
    skip = set(exclude)
    for r in raw:
        if not r or not is_latin(r):
            continue
        k = normalize(r)
        if k and k not in keys and k not in skip:
            keys.append(k)
    return keys


def _keys(c: City, socle_name: str | None) -> tuple[list[str], list[str]]:
    """(clés primaires : nom, asciiname, nom du socle ; clés alternatives : alternatenames si
    pop ≥ ALT_KEYS_MIN_POP, moins les primaires). Le front classe les primaires d'abord (spec §3.5) :
    sinon « paris of the north » ferait passer Varsovie devant Paris (Texas)."""
    primary = _norm_keys([c.name, c.ascii, socle_name or ""])
    alt = _norm_keys(c.alt, primary) if c.pop >= ALT_KEYS_MIN_POP else []
    return primary, alt


def build_search_index(cities: list[City], matches: dict[int, list], admin1: dict[str, str],
                       countries: dict[str, str]) -> dict[str, list[list]]:
    """Préfixe → entrées `[name, region, country, lon, lat, pop, [clés primaires de ce préfixe],
    [clés alternatives de ce préfixe]]` (spec §3.5). Une ligne du socle ne produit qu'une entrée :
    celle de la ville GeoNames la plus peuplée qui lui est rattachée."""
    kept: dict[int, int] = {}  # id(ligne du socle) → index de la ville GeoNames retenue
    for i, s in matches.items():
        j = kept.get(id(s))
        if j is None or (cities[i].pop, -i) > (cities[j].pop, -j):
            kept[id(s)] = i
    files: dict[str, list[list]] = {}
    for i, c in enumerate(cities):
        s = matches.get(i)
        if s is not None and kept[id(s)] != i:
            continue
        name = s[2] if s else display_name(c.name, c.ascii)
        if not name:
            continue
        lon, lat, pop = (s[0], s[1], s[3]) if s else (round(c.lon, 2), round(c.lat, 2), c.pop)
        region = admin1.get(f"{c.cc}.{c.admin1}", "")
        country = countries.get(c.cc, "")
        primary, alt = _keys(c, s[2] if s else None)
        by_prefix: dict[str, tuple[list[str], list[str]]] = {}
        for slot, ks in ((0, primary), (1, alt)):
            for k in ks:
                by_prefix.setdefault(prefix_of(k), ([], []))[slot].append(k)
        for p, (pk, ak) in by_prefix.items():
            files.setdefault(p, []).append([name, region, country, lon, lat, pop, pk, ak])
    for rows in files.values():
        rows.sort(key=lambda r: (-r[5], r[0]))
    return files
