# Recherche de ville, « ma position » et villes de détail (lot F) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** afficher de près ~165 000 villes GeoNames (Épinal compris), permettre de chercher une ville hors ligne et d'aller à sa position, avec un vol animé de la caméra qui se termine sur le marqueur et le tooltip.

**Architecture:** l'outil `tools/build_geo.py` garde le socle Natural Earth (`places.json`, inchangé) et délègue à un nouveau module `tools/geonames.py` la production de deux jeux de fichiers statiques servis avec le site : des tuiles de villes de détail (`geo/cities/5/{x}/{y}.json`, grille de `tiler/grid.py`) et un index de recherche découpé par préfixe de 2 lettres (`geo/search/{pp}.json`). Côté navigateur, `labels/detail.ts` charge les tuiles de détail visibles sous d < 1,25 (cadrage `selectTiles` réutilisé) et `LabelsController` les fusionne au socle ; `search/` porte la normalisation (miroir Python), l'index, un petit modèle clavier et le DOM ; `render/fly.ts` anime la caméra ; `ui/locate.ts` enveloppe la géolocalisation. Aucun changement du pipeline horaire, des tuiles image, de R2 ni des paramètres d'URL existants.

**Tech Stack:** TypeScript, Vite, Vitest (environnement **node, sans DOM**), three 0.185 ; Python 3 stdlib (`zipfile`, `unicodedata`) + pytest pour `tools/` ; Cloudflare Workers Static Assets (`web/public/`).

**Spec:** `docs/superpowers/specs/2026-09-26-search-cities-design.md` — à lire avec ce plan.

## Global Constraints

- Branche `feat/search-cities` créée depuis `master` (T1) ; merge local `--no-ff` à la fin (T12), jamais de push avant T12.
- Chaque commit se termine par le trailer **littéral** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ; vérifier après chaque commit : `git log -1 --format=%B | grep -c 'Claude Opus 5.5'` doit afficher `1`. `git merge` n'accepte pas `-F -` : utiliser `-m`.
- **Langue** : toute chaîne livrée au navigateur est en anglais (textes, attributs, `console.*`, exceptions) — le garde-fou `web/tests/english.test.ts` le vérifie, y compris sur les lettres `àâçèéêëîïôùûœ«»` dans les **littéraux** TS : écrire les caractères spéciaux en échappement `\uXXXX`. Commentaires, noms de tests, commits, HISTORY restent en français. Textes anglais : **copier mot pour mot** ceux de ce plan.
- Constantes (spec) : GeoNames `cities1000` (**pop ≥ 1 000**) ; dédoublonnage **10 km** ; niveau de tuile de détail **5** ; détail actif **sous d < 1,25** ; **4** requêtes parallèles, cache **64** tuiles ; recherche dès **2** caractères, **8** résultats au plus ; `alternatenames` indexés seulement pour **pop ≥ 100 000** ; vol **1 500 ms** jusqu'à **d = 1,15** ; géolocalisation `{ enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }` ; message d'erreur de position affiché **5 s**.
- Paramètres d'URL existants inchangés (`layer`, `wind`, `labels`, `rivers`, `lon`, `lat`, `d`, `tier`) ; le vol réécrit seulement `lon`, `lat`, `d`.
- Fichiers texte en **LF**. **Aucune nouvelle dépendance** npm ni Python.
- Tests front : `cd web && npx vitest run` ; typage : `cd web && npx tsc --noEmit` ; tests Python : `.venv/Scripts/python -m pytest` depuis la racine (venv Windows).
- Vitest tourne **sans DOM** : la logique est testée en pur ; le DOM (`search/ui.ts`, câblage `main.ts`) est validé dans le navigateur (T11).
- Budgets : bundle JS ≤ **+6 Ko gzip** par rapport à 161,71 Ko ; `places.json` **identique à l'octet** ; `countries.json` et `rivers.bin` **identiques à l'octet** ; dossier `web/public/geo/` ≤ **25 Mo** et ≤ **5 000 fichiers** ; aucun fichier de `cities/` ou `search/` > **2 Mo**.
- **Ne force jamais un test au vert** : si un test du plan échoue pour une raison que le plan n'a pas prévue, arrête-toi et rapporte-le.
- La machine de l'utilisateur a peu de mémoire (1–2 Go libres) : **aucun serveur Vite ni onglet 3D sans l'accord de l'utilisateur** (T11 seulement). `TaskStop` ne tue pas le node de Vite : `netstat -ano | grep :5173` puis `taskkill //PID <pid> //F`.
- Le téléchargement GeoNames (T3) demande le réseau ; les fichiers bruts vont dans `tools/.geo-cache/` (déjà ignoré par git).

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `tests/fixtures/geo_normalize_cases.json` (créé) | cas partagés de normalisation et de préfixe, lus par pytest **et** Vitest (garantie du miroir) |
| `tools/geonames.py` (créé), `tests/test_geonames.py` (créé) | normalisation, écriture latine, lecture GeoNames, dédoublonnage, tuiles de détail, index de recherche |
| `tools/build_geo.py` (modifié), `tests/test_build_geo.py` (modifié) | téléchargement GeoNames, écriture de `cities/` et `search/`, tests des fichiers commités |
| `web/public/geo/cities/5/**`, `web/public/geo/search/*.json` (générés, commités) | données servies avec le site |
| `web/src/geo/loader.ts`, `web/tests/geo-loader.test.ts` (modifiés) | `GEO_VERSION` = empreinte de **tout** `public/geo/` |
| `web/src/search/normalize.ts` (créé), `web/tests/search-normalize.test.ts` (créé) | miroir TS de la normalisation |
| `web/src/labels/data.ts` (modifié), `web/tests/labels-data.test.ts` (modifié) | `parseDetailPlaces`, `unitVectors`, `extendLabelSet` |
| `web/src/labels/detail.ts` (créé), `web/tests/labels-detail.test.ts` (créé) | chargeur des tuiles de détail |
| `web/src/labels/controller.ts`, `web/src/geo/wiring.ts` (modifiés), `web/tests/labels-controller.test.ts`, `web/tests/geo-wiring.test.ts` (modifiés) | fusion socle + détail, câblage |
| `web/src/search/index.ts`, `web/src/search/model.ts` (créés), `web/tests/search-index.test.ts`, `web/tests/search-model.test.ts` (créés) | index de recherche et modèle clavier |
| `web/src/render/fly.ts` (créé), `web/tests/fly.test.ts` (créé) | vol animé de la caméra |
| `web/src/ui/locate.ts` (créé), `web/tests/locate.test.ts` (créé) | géolocalisation |
| `web/src/ui/tooltip.ts`, `web/src/geo/params.ts` (modifiés), `web/tests/tooltip.test.ts`, `web/tests/geo-params.test.ts` (modifiés) | nom du lieu dans le tooltip, `withView` |
| `web/src/search/ui.ts` (créé), `web/src/ui/overlay.ts`, `web/src/i18n/en.ts`, `web/src/main.ts`, `web/src/style.css`, `web/index.html` (modifiés) | interface : boutons, champ, liste, messages, crédits |

---

### Task 1 : normalisation partagée Python / TypeScript

**Files:**
- Create: `tests/fixtures/geo_normalize_cases.json`
- Create: `tools/geonames.py`
- Create: `tests/test_geonames.py`
- Create: `web/src/search/normalize.ts`
- Create: `web/tests/search-normalize.test.ts`

**Interfaces:**
- Produces (Python, `tools/geonames.py`) : `normalize(s: str) -> str`, `prefix_of(key: str) -> str`, `is_latin(s: str) -> bool`, `display_name(name: str, ascii_name: str) -> str`.
- Produces (TS, `web/src/search/normalize.ts`) : `normalizeName(s: string): string`, `prefixOf(key: string): string`.

- [ ] **Step 1 : créer la branche**

```bash
git switch -c feat/search-cities
```

- [ ] **Step 2 : écrire les cas partagés**

`tests/fixtures/geo_normalize_cases.json` :

```json
{
  "normalize": [
    ["Épinal", "epinal"],
    ["Saint-Dié-des-Vosges", "saint die des vosges"],
    ["München", "munchen"],
    ["Łódź", "lodz"],
    ["Ærøskøbing", "aeroskobing"],
    ["Straße", "strasse"],
    ["St. John's", "st john s"],
    ["  Œuf  ", "oeuf"],
    ["İzmir", "izmir"],
    ["São Paulo", "sao paulo"],
    ["Kōfu", "kofu"],
    ["Xi'an", "xi an"],
    ["Þórshöfn", "thorshofn"],
    ["北京", ""]
  ],
  "prefix": [
    ["epinal", "ep"],
    ["saint die", "sa"],
    ["s hertogenbosch", "s_"],
    ["a", "a_"],
    ["", "__"],
    ["9 de julio", "9_"]
  ]
}
```

- [ ] **Step 3 : écrire les tests Python qui échouent**

`tests/test_geonames.py` :

```python
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
    assert not gn.is_latin("北京")
    assert not gn.is_latin("Москва")
    assert not gn.is_latin("")
    assert not gn.is_latin("123")  # aucune lettre


def test_display_name_prend_le_nom_latin_sinon_ascii():
    assert gn.display_name("Épinal", "Epinal") == "Épinal"
    assert gn.display_name("北京", "Beijing") == "Beijing"
    assert gn.display_name("", "Nowhere") == "Nowhere"
```

- [ ] **Step 4 : lancer, constater l'échec**

Run: `.venv/Scripts/python -m pytest tests/test_geonames.py -q`
Expected: FAIL (`ModuleNotFoundError: No module named 'geonames'`).

- [ ] **Step 5 : implémenter**

`tools/geonames.py` :

```python
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
_LATIN_PUNCT = set(" -'’.(),/")


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
    """Au moins une lettre, et uniquement des lettres latines, chiffres, espaces et `-'’.(),/`."""
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
```

- [ ] **Step 6 : lancer, constater le succès**

Run: `.venv/Scripts/python -m pytest tests/test_geonames.py -q`
Expected: PASS.

- [ ] **Step 7 : écrire le test TS qui échoue**

`web/tests/search-normalize.test.ts` :

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeName, prefixOf } from "../src/search/normalize";

/** Mêmes cas que tests/test_geonames.py : le miroir Python/TS est garanti par ce fichier commun. */
const CASES = JSON.parse(readFileSync(join(__dirname, "..", "..", "tests", "fixtures", "geo_normalize_cases.json"), "utf8")) as {
  normalize: [string, string][];
  prefix: [string, string][];
};

describe("normalizeName — miroir de tools/geonames.py::normalize", () => {
  it.each(CASES.normalize)("%s → %s", (raw, expected) => {
    expect(normalizeName(raw)).toBe(expected);
  });
});

describe("prefixOf — miroir de tools/geonames.py::prefix_of", () => {
  it.each(CASES.prefix)("%s → %s", (key, expected) => {
    expect(prefixOf(key)).toBe(expected);
  });
});
```

- [ ] **Step 8 : lancer, constater l'échec**

Run: `cd web && npx vitest run tests/search-normalize.test.ts`
Expected: FAIL (module `../src/search/normalize` introuvable).

- [ ] **Step 9 : implémenter**

`web/src/search/normalize.ts` (les lettres spéciales en `\u` : le garde-fou de langue refuse `œ` dans un littéral) :

```ts
/**
 * Normalisation des noms de ville (spec lot F §3.5). MIROIR PYTHON : tools/geonames.py
 * (`normalize`, `prefix_of`) ; cas partagés : tests/fixtures/geo_normalize_cases.json.
 */

/** Lettres que la décomposition NFD ne ramène pas à l'ASCII : ß ø ł æ œ đ ı þ ð. */
const FOLD: Record<string, string> = {
  "ß": "ss", "ø": "o", "ł": "l", "æ": "ae", "œ": "oe",
  "đ": "d", "ı": "i", "þ": "th", "ð": "d",
};

export function normalizeName(s: string): string {
  const base = s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
  let out = "";
  for (const c of base) out += FOLD[c] ?? c;
  return out.replace(/[^a-z0-9]+/g, " ").trim();
}

/** Nom du fichier d'index : 2 premiers caractères de la clé normalisée, hors [a-z0-9] → `_`. */
export function prefixOf(key: string): string {
  let p = "";
  for (const c of key.slice(0, 2)) p += /[a-z0-9]/.test(c) ? c : "_";
  return p.padEnd(2, "_");
}
```

- [ ] **Step 10 : lancer, constater le succès, typage et garde-fou**

Run: `cd web && npx vitest run tests/search-normalize.test.ts tests/english.test.ts && npx tsc --noEmit`
Expected: PASS, `tsc` sans sortie.

- [ ] **Step 11 : commit**

```bash
git add tests/fixtures/geo_normalize_cases.json tools/geonames.py tests/test_geonames.py web/src/search/normalize.ts web/tests/search-normalize.test.ts
git commit -m "feat(geo): normalisation des noms de ville, miroir Python/TS sur cas partagés

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Opus 5.5'
```

---

### Task 2 : lecture GeoNames, dédoublonnage, tuiles de détail, index de recherche

**Files:**
- Modify: `tools/geonames.py`
- Modify: `tests/test_geonames.py`

**Interfaces:**
- Consumes: `normalize`, `prefix_of`, `is_latin`, `display_name` (T1) ; `tiler.grid.tile_at(z, lon, lat) -> (x, y)`.
- Produces : `City` (dataclass gelée : `name, ascii, alt: tuple[str, ...], lat, lon, cc, admin1, pop`), `parse_cities(lines) -> list[City]`, `parse_admin1(lines) -> dict[str, str]`, `parse_countries(lines) -> dict[str, str]`, `match_socle(cities, socle_rows) -> dict[int, list]`, `build_detail_tiles(cities, matches) -> dict[tuple[int, int], list[list]]`, `build_search_index(cities, matches, admin1, countries) -> dict[str, list[list]]`, constantes `MIN_POP = 1000`, `ALT_KEYS_MIN_POP = 100_000`, `DEDUP_KM = 10.0`, `DETAIL_LEVEL = 5`.

- [ ] **Step 1 : écrire les tests qui échouent** (à la suite de `tests/test_geonames.py`)

```python
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
    # Épinal : clés « epinal » (nom et ascii) ; pas d'alternatenames sous 100 000 hab.
    assert index["ep"] == [["Épinal", "Grand Est", "France", 6.45, 48.17, 32_188, ["epinal"]]]
    assert "sp" not in index
    # Munich : nom, coordonnées et population du socle ; exonymes latins indexés (≥ 100 000 hab.),
    # chaque fichier ne portant que les clés de son préfixe ; l'alternatename cyrillique est ignoré.
    assert index["mu"] == [["Munich", "Bavaria", "Germany", 11.58, 48.14, 1_275_000, ["munich", "munchen"]]]
    assert index["mo"] == [["Munich", "Bavaria", "Germany", 11.58, 48.14, 1_275_000, ["monaco di baviera"]]]


def test_build_search_index_trie_par_population_decroissante():
    a = gn_line(1, "Saint-Dié-des-Vosges", "Saint-Die-des-Vosges", [], 48.28, 6.95, "FR", "44", 19_000)
    b = gn_line(2, "Saintes", "Saintes", [], 45.74, -0.63, "FR", "75", 25_000)
    index = gn.build_search_index(gn.parse_cities([a, b]), {}, {}, {"FR": "France"})
    assert [e[0] for e in index["sa"]] == ["Saintes", "Saint-Dié-des-Vosges"]
    assert index["sa"][1][1] == ""  # région inconnue → vide
```

- [ ] **Step 2 : lancer, constater l'échec**

Run: `.venv/Scripts/python -m pytest tests/test_geonames.py -q`
Expected: FAIL (`AttributeError: module 'geonames' has no attribute 'parse_cities'`).

- [ ] **Step 3 : implémenter** (ajouts à `tools/geonames.py`)

En tête, après `import unicodedata` :

```python
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tiler.grid import tile_at  # noqa: E402  (même grille que web/src/tiles/grid.ts)

MIN_POP = 1000
# Sous ce seuil, les alternatenames ne sont pas indexés : ils gonfleraient l'index de dizaines de Mo
# pour des noms de villages rarement cherchés ; au-dessus, ils portent les exonymes (« munchen »).
ALT_KEYS_MIN_POP = 100_000
DEDUP_KM = 10.0
DETAIL_LEVEL = 5
EARTH_KM = 6371.0
```

Puis, en fin de fichier :

```python
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
    """cities1000.txt : colonnes 1 name, 2 asciiname, 3 alternatenames, 4 lat, 5 lon, 8 pays, 10 admin1, 14 pop."""
    out = []
    for line in lines:
        f = line.rstrip("\n").split("\t")
        if len(f) < 15:
            continue
        pop = int(f[14] or 0)
        if pop < MIN_POP:
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


def _keys(c: City, socle_name: str | None) -> list[str]:
    raw = [c.name, c.ascii]
    if socle_name:
        raw.append(socle_name)
    if c.pop >= ALT_KEYS_MIN_POP:
        raw.extend(c.alt)
    keys: list[str] = []
    for r in raw:
        if not r or not is_latin(r):
            continue
        k = normalize(r)
        if k and k not in keys:
            keys.append(k)
    return keys


def build_search_index(cities: list[City], matches: dict[int, list], admin1: dict[str, str],
                       countries: dict[str, str]) -> dict[str, list[list]]:
    """Préfixe → entrées `[name, region, country, lon, lat, pop, [clés de ce préfixe]]` (spec §3.5)."""
    files: dict[str, list[list]] = {}
    for i, c in enumerate(cities):
        s = matches.get(i)
        name = s[2] if s else display_name(c.name, c.ascii)
        if not name:
            continue
        lon, lat, pop = (s[0], s[1], s[3]) if s else (round(c.lon, 2), round(c.lat, 2), c.pop)
        region = admin1.get(f"{c.cc}.{c.admin1}", "")
        country = countries.get(c.cc, "")
        by_prefix: dict[str, list[str]] = {}
        for k in _keys(c, s[2] if s else None):
            by_prefix.setdefault(prefix_of(k), []).append(k)
        for p, ks in by_prefix.items():
            files.setdefault(p, []).append([name, region, country, lon, lat, pop, ks])
    for rows in files.values():
        rows.sort(key=lambda r: (-r[5], r[0]))
    return files
```

- [ ] **Step 4 : lancer, constater le succès**

Run: `.venv/Scripts/python -m pytest tests/test_geonames.py -q`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add tools/geonames.py tests/test_geonames.py
git commit -m "feat(geo): GeoNames — dédoublonnage avec le socle, tuiles de détail, index de recherche

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Opus 5.5'
```

---

### Task 3 : génération et publication des fichiers `geo/`

**Files:**
- Modify: `tools/build_geo.py`
- Modify: `tests/test_build_geo.py`
- Generate: `web/public/geo/cities/5/**`, `web/public/geo/search/*.json`
- Modify: `web/src/geo/loader.ts:9-14` (`GEO_VERSION`)
- Modify: `web/tests/geo-loader.test.ts:58-70`

**Interfaces:**
- Consumes: tout `tools/geonames.py` (T1, T2).
- Produces : fichiers `geo/cities/5/{x}/{y}.json` = `{"version": 1, "places": [[lon, lat, name, pop], …]}` et `geo/search/{pp}.json` = `{"version": 1, "entries": [[name, region, country, lon, lat, pop, [keys]], …]}` ; `GEO_VERSION` recalculé sur **tout** `web/public/geo/`.

- [ ] **Step 1 : écrire les tests des fichiers commités qui échouent** (à la fin de `tests/test_build_geo.py` ; ajouter `import geonames as gn  # noqa: E402` sous `import build_geo as bg`)

```python
def test_fichiers_commites_villes_de_detail():
    files = sorted((GEO / "cities" / "5").glob("*/*.json"))
    assert 500 <= len(files) <= 2048
    total = 0
    for path in files:
        raw = path.read_bytes()
        assert len(raw) <= 2_000_000 and b"\r" not in raw
        rows = json.loads(raw)["places"]
        assert rows and all(len(r) == 4 and r[3] >= 1000 for r in rows)
        assert rows == sorted(rows, key=lambda r: (-r[3], r[2]))
        total += len(rows)
    assert 100_000 <= total <= 250_000
    epinal = json.loads((GEO / "cities" / "5" / "33" / "7.json").read_bytes())["places"]
    assert any(r[2] == "Épinal" for r in epinal)


def test_fichiers_commites_index_de_recherche():
    files = sorted((GEO / "search").glob("*.json"))
    assert 200 <= len(files) <= 1300
    for path in files:
        raw = path.read_bytes()
        assert len(raw) <= 2_000_000 and b"\r" not in raw
        prefix = path.stem
        for e in json.loads(raw)["entries"]:
            assert len(e) == 7 and e[6] and all(gn.prefix_of(k) == prefix for k in e[6])
    ep = json.loads((GEO / "search" / "ep.json").read_bytes())["entries"]
    epinal = next(e for e in ep if e[0] == "Épinal")
    assert epinal[1:3] == ["Grand Est", "France"]
    mu = json.loads((GEO / "search" / "mu.json").read_bytes())["entries"]
    munich = next(e for e in mu if e[0] == "Munich")
    assert "munchen" in munich[6]


def test_dossier_geo_dans_le_budget():
    paths = [p for p in GEO.rglob("*") if p.is_file()]
    assert len(paths) <= 5000
    assert sum(p.stat().st_size for p in paths) <= 25_000_000
```

- [ ] **Step 2 : lancer, constater l'échec**

Run: `.venv/Scripts/python -m pytest tests/test_build_geo.py -q -k "detail or recherche or budget"`
Expected: FAIL (`assert 0 >= 500` : aucun fichier encore).

- [ ] **Step 3 : implémenter la génération** (`tools/build_geo.py`)

Docstring du module : remplacer les lignes 1-7 par :

```python
"""Natural Earth + GeoNames → web/public/geo/ (spec repères §2, §5 ; spec lot F §3).

    python tools/build_geo.py

Stdlib seule. Télécharge dans tools/.geo-cache/ (git-ignoré) trois GeoJSON Natural Earth figés sur
NE_TAG et trois fichiers GeoNames (non versionnés côté GeoNames : le cache fait foi tant qu'il
n'est pas effacé) ; écrit places.json, countries.json, rivers.bin, cities/5/{x}/{y}.json et
search/{pp}.json — déterministes à cache égal, commités, servis avec le site.
"""
```

Imports : ajouter `import shutil` et `import zipfile` (ordre alphabétique avec les autres), puis `import geonames as gn` après les imports stdlib (le script est lancé depuis `tools/`, qui est dans `sys.path`).

Après `SOURCES = {…}` :

```python
GEONAMES_URL = "https://download.geonames.org/export/dump/"
GEONAMES = {"cities": "cities1000.zip", "admin1": "admin1CodesASCII.txt", "countries": "countryInfo.txt"}
```

Remplacer `_load` par un téléchargement factorisé :

```python
def _download(url: str, path: Path) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return
    print(f"téléchargement {url}…")
    # Téléchargement atomique (M7) : écrire vers un fichier temporaire puis le renommer vers
    # le chemin final, pour qu'un téléchargement interrompu ne laisse jamais de cache corrompu
    # à supprimer à la main.
    part = path.with_suffix(path.suffix + ".part")
    urllib.request.urlretrieve(url, part)
    part.replace(path)


def _load(key: str) -> list[dict]:
    path = CACHE / f"{NE_TAG}-{SOURCES[key]}"
    _download(BASE_URL + SOURCES[key], path)
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def _geonames_lines(key: str) -> list[str]:
    path = CACHE / f"geonames-{GEONAMES[key]}"
    _download(GEONAMES_URL + GEONAMES[key], path)
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            return z.read("cities1000.txt").decode("utf-8").splitlines(keepends=True)
    return path.read_text(encoding="utf-8").splitlines(keepends=True)


def _write_tree(root: Path, files: dict[str, bytes]) -> None:
    """Remplace entièrement `root` : une ville disparue de GeoNames ne laisse pas de fichier orphelin."""
    if root.exists():
        shutil.rmtree(root)
    for rel, data in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
```

Dans `main()`, après l'écriture de `rivers.bin` et avant le `print` :

```python
    cities = gn.parse_cities(_geonames_lines("cities"))
    matches = gn.match_socle(cities, places)
    tiles = gn.build_detail_tiles(cities, matches)
    index = gn.build_search_index(cities, matches, gn.parse_admin1(_geonames_lines("admin1")),
                                  gn.parse_countries(_geonames_lines("countries")))
    _write_tree(OUT / "cities", {f"{gn.DETAIL_LEVEL}/{x}/{y}.json": dump_json({"version": 1, "places": rows})
                                 for (x, y), rows in tiles.items()})
    _write_tree(OUT / "search", {f"{p}.json": dump_json({"version": 1, "entries": rows}) for p, rows in index.items()})
    print(f"GeoNames : {len(cities)} villes, {len(matches)} rattachées au socle, {len(tiles)} tuiles de détail, "
          f"{len(index)} fichiers d'index")
```

- [ ] **Step 4 : générer** (réseau ; ~10 Mo téléchargés une fois)

Run: `cd tools && ../.venv/Scripts/python build_geo.py && cd .. && git status --short web/public/geo | head && git diff --stat web/public/geo/places.json web/public/geo/countries.json web/public/geo/rivers.bin`
Expected : la ligne « GeoNames : … » ; **aucune** différence sur `places.json`, `countries.json`, `rivers.bin` (budget : identiques à l'octet) ; de nouveaux dossiers `cities/` et `search/`. Noter les nombres affichés pour le rapport.

Si le volume dépasse le budget (test `test_dossier_geo_dans_le_budget`), **s'arrêter et rapporter** les chiffres (nombre de fichiers, taille totale, plus gros fichier) : ne pas changer les seuils sans accord.

- [ ] **Step 5 : lancer les tests Python**

Run: `.venv/Scripts/python -m pytest -q`
Expected: PASS (tous, dont les trois nouveaux tests de fichiers commités).

- [ ] **Step 6 : étendre l'empreinte `GEO_VERSION` à tout le dossier** — test d'abord

Dans `web/tests/geo-loader.test.ts`, remplacer le `describe("GEO_VERSION …")` par :

```ts
describe("GEO_VERSION — invalide le cache navigateur d'un jour des fichiers geo/", () => {
  it("vaut l'empreinte FNV-1a de tout public/geo/ : à relever après chaque `tools/build_geo.py`", () => {
    // Sans cela, un visiteur déjà venu garde l'ancienne copie pendant 24 h (noms restés en
    // français après le passage du site à l'anglais, 2026-09-19). Depuis le lot F, l'empreinte
    // couvre aussi cities/ et search/ : chemins relatifs triés, puis octets de chaque fichier.
    const root = join(__dirname, "..", "public", "geo");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
    const files = walk(root).map((p) => relative(root, p).replaceAll("\\", "/")).sort();
    let h = 0x811c9dc5;
    const feed = (bytes: Uint8Array) => {
      for (const byte of bytes) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
    };
    for (const rel of files) {
      feed(new TextEncoder().encode(rel));
      feed(readFileSync(join(root, rel)));
    }
    expect(GEO_VERSION).toBe(h.toString(16).padStart(8, "0"));
  });
});
```

Ajouter `readdirSync` à l'import `node:fs` et `relative` à l'import `node:path` en tête du fichier.

Run: `cd web && npx vitest run tests/geo-loader.test.ts`
Expected: FAIL sur `GEO_VERSION` ; le message donne la valeur attendue (`expected '6977d45f' to be '<nouvelle valeur>'`).

- [ ] **Step 7 : relever la valeur**

Dans `web/src/geo/loader.ts`, remplacer `"6977d45f"` par la valeur donnée par le test, et la fin du commentaire au-dessus par : `Empreinte FNV-1a de tout public/geo/ (chemins triés puis octets) : geo-loader.test.ts échoue, en donnant la bonne valeur, dès que les données changent.`

Run: `cd web && npx vitest run tests/geo-loader.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8 : commit** (données comprises)

```bash
git add tools/build_geo.py tests/test_build_geo.py web/public/geo web/src/geo/loader.ts web/tests/geo-loader.test.ts
git commit -m "feat(geo): villes GeoNames > 1 000 hab. — tuiles de détail et index de recherche générés

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Opus 5.5'
```

---

### Task 4 : données des étiquettes de détail (`labels/data.ts`)

**Files:**
- Modify: `web/src/labels/data.ts`
- Modify: `web/tests/labels-data.test.ts`

**Interfaces:**
- Produces : `parseDetailPlaces(json: unknown): Place[]` (lignes de 4 champs, `capital: false`) ; `unitVectors(places: readonly { lon: number; lat: number }[]): Float32Array` ; `interface DetailBatch { places: readonly Place[]; unit: Float32Array }` ; `extendLabelSet(base: LabelSet, extra: DetailBatch): LabelSet` ; `itemKey(item: LabelItem): string`.

- [ ] **Step 1 : écrire les tests qui échouent** (à la fin de `web/tests/labels-data.test.ts` ; ajouter à l'import de `../src/labels/data` : `extendLabelSet, itemKey, parseDetailPlaces, unitVectors`)

```ts
describe("parseDetailPlaces — tuiles geo/cities/ (spec lot F §3.4)", () => {
  it("lit des lignes de 4 champs, sans drapeau capitale", () => {
    expect(parseDetailPlaces({ version: 1, places: [[6.45, 48.17, "Épinal", 32188]] })).toEqual([
      { lon: 6.45, lat: 48.17, name: "Épinal", pop: 32188, capital: false },
    ]);
  });
  it("rejette une ligne de 5 champs et une population non numérique", () => {
    expect(() => parseDetailPlaces({ version: 1, places: [[6.45, 48.17, "X", 1, 0]] })).toThrowError(GeoDataError);
    expect(() => parseDetailPlaces({ version: 1, places: [[6.45, 48.17, "X", "1"]] })).toThrowError(GeoDataError);
  });
});

describe("extendLabelSet — socle + villes de détail", () => {
  const base = buildLabelSet(
    [
      { lon: 2.35, lat: 48.86, name: "Paris", pop: 11_000_000, capital: true },
      { lon: 4.84, lat: 45.77, name: "Lyon", pop: 1_700_000, capital: false },
      { lon: 1, lat: 1, name: "Smallville", pop: 5_000, capital: false },
    ],
    [{ lon: 2, lat: 46, name: "France", rank: 2 }],
  );
  const extraPlaces = [
    { lon: 6.45, lat: 48.17, name: "Epinal", pop: 32_188, capital: false },
    { lon: 6, lat: 48, name: "Village", pop: 1_000, capital: false },
  ];
  const extra = { places: extraPlaces, unit: unitVectors(extraPlaces) };

  it("intercale les villes de détail par population, sans passer devant pays ni capitales", () => {
    const set = extendLabelSet(base, extra);
    expect(set.items.map((i) => i.name)).toEqual(["France", "Paris", "Lyon", "Epinal", "Smallville", "Village"]);
    expect(set.items.map((i) => i.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("vecteurs unité cohérents avec chaque item", () => {
    const set = extendLabelSet(base, extra);
    for (const it of set.items) {
      const expected = unitVectors([it]);
      expect(Array.from(set.unit.subarray(it.id * 3, it.id * 3 + 3))).toEqual(Array.from(expected));
    }
  });
  it("aucun détail : renvoie le socle tel quel", () => {
    expect(extendLabelSet(base, { places: [], unit: new Float32Array(0) })).toBe(base);
  });
  it("itemKey distingue le type, le nom et la position", () => {
    const set = extendLabelSet(base, extra);
    const keys = set.items.map(itemKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(itemKey(set.items[3]!)).toBe("city|Epinal|6.45|48.17");
  });
});
```

(Si `GeoDataError` et `buildLabelSet` ne sont pas déjà importés dans ce fichier de test, les ajouter à l'import.)

- [ ] **Step 2 : lancer, constater l'échec**

Run: `cd web && npx vitest run tests/labels-data.test.ts`
Expected: FAIL (`parseDetailPlaces` non exporté).

- [ ] **Step 3 : implémenter** (ajouts à la fin de `web/src/labels/data.ts`)

```ts
/** Tuile de villes de détail `geo/cities/5/{x}/{y}.json` (spec lot F §3.4) : `[lon, lat, name, pop]`. */
export function parseDetailPlaces(json: unknown): Place[] {
  return rows(json, "places", 4).map((r) => {
    const pop = r[3];
    if (typeof pop !== "number" || !Number.isFinite(pop)) throw new GeoDataError("places: invalid population");
    return { ...lonLatName(r, "places"), pop, capital: false };
  });
}

export function unitVectors(places: readonly { lon: number; lat: number }[]): Float32Array {
  const unit = new Float32Array(places.length * 3);
  const v = new THREE.Vector3();
  places.forEach((p, i) => {
    lonLatToVec3(p.lon, p.lat, v);
    unit[i * 3] = v.x;
    unit[i * 3 + 1] = v.y;
    unit[i * 3 + 2] = v.z;
  });
  return unit;
}

/** Villes de détail visibles, triées par population décroissante, avec leurs vecteurs unité. */
export interface DetailBatch {
  places: readonly Place[];
  unit: Float32Array;
}

/**
 * Socle + villes de détail (spec lot F §4.2). L'ordre des items est l'ordre de priorité de la
 * sélection : une ville de détail passe devant une ville ordinaire du socle moins peuplée, jamais
 * devant un pays ni une capitale (le socle garde son ordre propre, F7).
 */
export function extendLabelSet(base: LabelSet, extra: DetailBatch): LabelSet {
  if (extra.places.length === 0) return base;
  const items: LabelItem[] = [];
  const unit = new Float32Array((base.items.length + extra.places.length) * 3);
  const push = (item: Omit<LabelItem, "id">, src: Float32Array, k: number): void => {
    const id = items.length;
    items.push({ ...item, id });
    unit.set(src.subarray(k * 3, k * 3 + 3), id * 3);
  };
  let j = 0;
  const pushExtra = (): void => {
    const p = extra.places[j]!;
    push({ kind: "city", name: p.name, lon: p.lon, lat: p.lat, pop: p.pop, capital: false, rank: 0 }, extra.unit, j);
    j++;
  };
  for (const b of base.items) {
    while (j < extra.places.length && b.kind === "city" && !b.capital && extra.places[j]!.pop > b.pop) pushExtra();
    push(b, base.unit, b.id);
  }
  while (j < extra.places.length) pushExtra();
  return { items, unit };
}

/** Identité stable d'un item d'un `LabelSet` à l'autre (les ids changent à chaque fusion). */
export function itemKey(item: LabelItem): string {
  return `${item.kind}|${item.name}|${item.lon}|${item.lat}`;
}
```

- [ ] **Step 4 : lancer, constater le succès**

Run: `cd web && npx vitest run tests/labels-data.test.ts tests/english.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add web/src/labels/data.ts web/tests/labels-data.test.ts
git commit -m "feat(labels): tuiles de détail — lecture, vecteurs unité, fusion au socle par population

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Opus 5.5'
```

---

### Task 5 : chargeur des tuiles de détail (`labels/detail.ts`)

**Files:**
- Create: `web/src/labels/detail.ts`
- Create: `web/tests/labels-detail.test.ts`

**Interfaces:**
- Consumes: `parseDetailPlaces`, `unitVectors`, `DetailBatch`, `Place` (T4) ; `selectTiles`, `ViewState` (`tiles/lod.ts`) ; `tileKey`, `tileAt`, `TileId` (`tiles/grid.ts`) ; `GEO_VERSION` (`geo/loader.ts`).
- Produces : constantes `DETAIL_LEVEL = 5`, `DETAIL_MAX_D = 1.25`, `DETAIL_CONCURRENCY = 4`, `DETAIL_CACHE = 64`, `DETAIL_RETRY_MS = 2000` ; `detailTiles(view: ViewState, enabled: boolean): TileId[]` ; `interface DetailDeps { fetchJson(url: string, signal: AbortSignal): Promise<unknown | null>; now?: () => number }` ; `class DetailLabels { constructor(base: string, deps: DetailDeps, onChange: () => void); readonly version: number (getter); update(view: ViewState, enabled: boolean): void; current(): DetailBatch }`.

- [ ] **Step 1 : écrire les tests qui échouent**

`web/tests/labels-detail.test.ts` :

```ts
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { GEO_VERSION } from "../src/geo/loader";
import { DETAIL_CACHE, DETAIL_CONCURRENCY, DetailLabels, detailTiles } from "../src/labels/detail";
import { tileAt } from "../src/tiles/grid";
import { viewStateFrom } from "../src/tiles/lod";
import { lonLatToVec3 } from "../src/tiles/patch";

/** Caméra au-dessus de (lon, lat) à la distance d, viewport 1280 × 800. */
function view(lon: number, lat: number, d: number) {
  const camera = new THREE.PerspectiveCamera(45, 1280 / 800, 0.01, 100);
  camera.position.copy(lonLatToVec3(lon, lat).multiplyScalar(d));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return viewStateFrom(camera, 800);
}

const EPINAL_TILE = tileAt(5, 6.45, 48.17);
const tile = (rows: unknown[][]) => ({ version: 1, places: rows });

/** Réseau factice : chaque URL demandée reste en attente jusqu'à `resolve(url, …)` ou `reject(url)`. */
function fakeNet() {
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void; signal: AbortSignal }>();
  const fetchJson = vi.fn((url: string, signal: AbortSignal) =>
    new Promise<unknown>((resolve, reject) => pending.set(url, { resolve, reject, signal })),
  );
  const urlOf = (t: { z: number; x: number; y: number }) => `/geo/cities/${t.z}/${t.x}/${t.y}.json?v=${GEO_VERSION}`;
  return { fetchJson, pending, urlOf };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("detailTiles — quelles tuiles de détail pour une vue (spec lot F §4.1)", () => {
  it("de loin (d ≥ 1,25) : aucune", () => {
    expect(detailTiles(view(6.45, 48.17, 1.3), true)).toEqual([]);
  });
  it("étiquettes éteintes : aucune", () => {
    expect(detailTiles(view(6.45, 48.17, 1.1), false)).toEqual([]);
  });
  it("de près : tuiles de niveau 5 autour du centre, dont celle d'Épinal", () => {
    const tiles = detailTiles(view(6.45, 48.17, 1.1), true);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThan(40);
    expect(tiles.every((t) => t.z === 5)).toBe(true);
    expect(tiles).toContainEqual(EPINAL_TILE);
  });
});

describe("DetailLabels — chargement, cache, annulation", () => {
  it("charge au plus DETAIL_CONCURRENCY tuiles à la fois, avec la version dans l'URL", () => {
    const net = fakeNet();
    const detail = new DetailLabels("/geo", net, () => {});
    detail.update(view(6.45, 48.17, 1.1), true);
    expect(net.fetchJson).toHaveBeenCalledTimes(Math.min(DETAIL_CONCURRENCY, detailTiles(view(6.45, 48.17, 1.1), true).length));
    expect(net.fetchJson.mock.calls.every(([url]) => url.startsWith("/geo/cities/5/") && url.endsWith(`.json?v=${GEO_VERSION}`))).toBe(true);
  });

  it("une tuile arrivée : onChange, version incrémentée, villes dans current()", async () => {
    const net = fakeNet();
    const onChange = vi.fn();
    const detail = new DetailLabels("/geo", net, onChange);
    const v = view(6.45, 48.17, 1.05);
    detail.update(v, true);
    const url = net.urlOf(EPINAL_TILE);
    // la tuile d'Épinal peut attendre son tour : on libère les autres jusqu'à ce qu'elle parte
    for (let i = 0; i < 20 && !net.pending.has(url); i++) {
      for (const [u, p] of net.pending) if (u !== url) { p.resolve(null); net.pending.delete(u); }
      await flush();
    }
    const before = detail.version;
    net.pending.get(url)!.resolve(tile([[6.45, 48.17, "Epinal", 32188], [6.4, 48.2, "Golbey", 8000]]));
    await flush();
    expect(onChange).toHaveBeenCalled();
    expect(detail.version).toBeGreaterThan(before);
    const batch = detail.current();
    expect(batch.places.map((p) => p.name)).toEqual(expect.arrayContaining(["Epinal", "Golbey"]));
    expect(batch.unit.length).toBe(batch.places.length * 3);
    const pops = batch.places.map((p) => p.pop);
    expect(pops).toEqual([...pops].sort((a, b) => b - a));
  });

  it("404 (null) = tuile vide mémorisée : pas de second téléchargement", async () => {
    const net = fakeNet();
    const detail = new DetailLabels("/geo", net, () => {});
    const v = view(6.45, 48.17, 1.05);
    detail.update(v, true);
    const first = [...net.pending.keys()];
    for (const u of first) net.pending.get(u)!.resolve(null);
    net.pending.clear();
    await flush();
    const calls = net.fetchJson.mock.calls.length;
    detail.update(view(6.46, 48.17, 1.05), true);
    const again = net.fetchJson.mock.calls.slice(calls).map(([u]) => u);
    for (const u of first) expect(again).not.toContain(u);
  });

  it("une tuile sortie de la vue en cours de chargement est annulée", () => {
    const net = fakeNet();
    const detail = new DetailLabels("/geo", net, () => {});
    detail.update(view(6.45, 48.17, 1.1), true);
    const signals = [...net.pending.values()].map((p) => p.signal);
    detail.update(view(6.45, 48.17, 2), true); // de loin : plus aucune tuile voulue
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it("échec réseau : réessai seulement après un mouvement et DETAIL_RETRY_MS", async () => {
    const net = fakeNet();
    let t = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const detail = new DetailLabels("/geo", { fetchJson: net.fetchJson, now: () => t }, () => {});
    const v = view(6.45, 48.17, 1.05);
    detail.update(v, true);
    const [url, p] = [...net.pending.entries()][0]!;
    net.pending.clear();
    p.reject(new Error("HTTP 500"));
    await flush();
    const count = () => net.fetchJson.mock.calls.filter(([u]) => u === url).length;
    detail.update(v, true); // pas bougé
    expect(count()).toBe(1);
    detail.update(view(6.46, 48.17, 1.05), true); // bougé, mais trop tôt
    expect(count()).toBe(1);
    t = 2500;
    detail.update(view(6.47, 48.17, 1.05), true);
    expect(count()).toBe(2);
    warn.mockRestore();
  });

  it("cache LRU borné à DETAIL_CACHE tuiles hors vue", async () => {
    const net = fakeNet();
    const detail = new DetailLabels("/geo", net, () => {});
    // survol d'une bande de longitudes : chaque étape charge de nouvelles tuiles
    for (let lon = -170; lon <= 170; lon += 4) {
      detail.update(view(lon, 0, 1.1), true);
      for (const [u, p] of net.pending) { p.resolve(tile([[lon, 0, `C${lon}`, 2000]])); net.pending.delete(u); }
      await flush();
    }
    expect((detail as unknown as { entries: Map<string, unknown> }).entries.size).toBeLessThanOrEqual(DETAIL_CACHE + 40);
  });
});
```

- [ ] **Step 2 : lancer, constater l'échec**

Run: `cd web && npx vitest run tests/labels-detail.test.ts`
Expected: FAIL (module `../src/labels/detail` introuvable).

- [ ] **Step 3 : implémenter**

`web/src/labels/detail.ts` :

```ts
/**
 * Villes de détail (spec lot F §4.1) : tuiles GeoNames `geo/cities/5/{x}/{y}.json`, chargées de
 * près seulement. Réutilise la grille et le cadrage des tuiles image (`selectTiles`), pas leur
 * chargeur (lié aux textures et au budget GPU). Logique pure : le réseau et l'horloge sont injectés.
 */
import { GEO_VERSION } from "../geo/loader";
import { type TileId, tileKey } from "../tiles/grid";
import { type ViewState, selectTiles } from "../tiles/lod";
import { type DetailBatch, type Place, parseDetailPlaces, unitVectors } from "./data";

export const DETAIL_LEVEL = 5;
/** Miroir du dernier palier de CITY_TIERS (`labels/select.ts`) : toutes les villes y sont éligibles. */
export const DETAIL_MAX_D = 1.25;
export const DETAIL_CONCURRENCY = 4;
/** Tuiles prêtes gardées hors vue (LRU). */
export const DETAIL_CACHE = 64;
/** Délai minimal avant de réessayer une tuile en échec (et seulement si la caméra a bougé, dette n° 19). */
export const DETAIL_RETRY_MS = 2000;

export interface DetailDeps {
  /** JSON de l'URL ; `null` si 404 (tuile sans ville) ; rejette sur tout autre échec. */
  fetchJson(url: string, signal: AbortSignal): Promise<unknown | null>;
  now?: () => number;
}

type Entry =
  | { state: "loading"; ctrl: AbortController }
  | { state: "ready"; places: Place[] }
  | { state: "failed"; at: number };

const EMPTY: DetailBatch = { places: [], unit: new Float32Array(0) };

export function detailTiles(view: ViewState, enabled: boolean): TileId[] {
  if (!enabled || view.cameraPosition.length() >= DETAIL_MAX_D) return [];
  // Seuil nul : la descente est forcée jusqu'au niveau 5 dans tout ce qui est visible.
  return selectTiles(view, { maxLevel: DETAIL_LEVEL, k: 0 });
}

export class DetailLabels {
  private readonly entries = new Map<string, Entry>();
  private wanted: TileId[] = [];
  private lastPos = "";
  private ver = 0;
  private memo: { ver: number; batch: DetailBatch } | null = null;
  private readonly now: () => number;

  constructor(
    private readonly base: string,
    private readonly deps: DetailDeps,
    private readonly onChange: () => void,
  ) {
    this.now = deps.now ?? (() => performance.now());
  }

  /** Change dès que l'ensemble des villes visibles change. */
  get version(): number {
    return this.ver;
  }

  /** À chaque vue (`SceneHandle.onViewChange`). */
  update(view: ViewState, enabled: boolean): void {
    const pos = view.cameraPosition.toArray().join(",");
    const moved = pos !== this.lastPos;
    this.lastPos = pos;
    const before = this.readySignature();
    this.wanted = detailTiles(view, enabled);
    const keys = new Set(this.wanted.map(tileKey));
    const now = this.now();
    for (const [key, e] of this.entries) {
      if (e.state === "loading" && !keys.has(key)) {
        e.ctrl.abort();
        this.entries.delete(key);
      } else if (e.state === "failed" && moved && now - e.at >= DETAIL_RETRY_MS) {
        this.entries.delete(key);
      }
    }
    // LRU : une tuile voulue et prête repasse en fin de Map (la plus récente).
    for (const key of keys) {
      const e = this.entries.get(key);
      if (e?.state === "ready") {
        this.entries.delete(key);
        this.entries.set(key, e);
      }
    }
    this.pump();
    this.evict(keys);
    if (this.readySignature() !== before) this.ver++;
  }

  /** Villes des tuiles voulues et prêtes, par population décroissante puis nom. */
  current(): DetailBatch {
    if (this.memo?.ver === this.ver) return this.memo.batch;
    const all: Place[] = [];
    for (const t of this.wanted) {
      const e = this.entries.get(tileKey(t));
      if (e?.state === "ready") all.push(...e.places);
    }
    all.sort((a, b) => b.pop - a.pop || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const batch = all.length ? { places: all, unit: unitVectors(all) } : EMPTY;
    this.memo = { ver: this.ver, batch };
    return batch;
  }

  private readySignature(): string {
    return this.wanted
      .map(tileKey)
      .filter((k) => this.entries.get(k)?.state === "ready")
      .join(";");
  }

  private pump(): void {
    let loading = 0;
    for (const e of this.entries.values()) if (e.state === "loading") loading++;
    for (const t of this.wanted) {
      if (loading >= DETAIL_CONCURRENCY) return;
      const key = tileKey(t);
      if (this.entries.has(key)) continue;
      const ctrl = new AbortController();
      this.entries.set(key, { state: "loading", ctrl });
      loading++;
      void this.load(t, key, ctrl);
    }
  }

  private async load(t: TileId, key: string, ctrl: AbortController): Promise<void> {
    let next: Entry;
    try {
      const json = await this.deps.fetchJson(`${this.base}/cities/${t.z}/${t.x}/${t.y}.json?v=${GEO_VERSION}`, ctrl.signal);
      next = { state: "ready", places: json === null ? [] : parseDetailPlaces(json) };
    } catch (e) {
      if (ctrl.signal.aborted) return;
      console.warn(`[worldtemp] city tile ${key} unavailable:`, e);
      next = { state: "failed", at: this.now() };
    }
    const cur = this.entries.get(key);
    if (cur?.state !== "loading" || cur.ctrl !== ctrl) return; // annulée ou remplacée entre-temps
    this.entries.delete(key);
    this.entries.set(key, next);
    this.pump();
    if (next.state === "ready" && this.wanted.some((w) => tileKey(w) === key)) {
      this.ver++;
      this.onChange();
    }
  }

  /** Garde au plus DETAIL_CACHE tuiles terminées hors vue, les plus anciennes partent d'abord. */
  private evict(keys: ReadonlySet<string>): void {
    let idle = 0;
    for (const [key, e] of this.entries) if (e.state !== "loading" && !keys.has(key)) idle++;
    for (const [key, e] of this.entries) {
      if (idle <= DETAIL_CACHE) return;
      if (e.state === "loading" || keys.has(key)) continue;
      this.entries.delete(key);
      idle--;
    }
  }
}
```

- [ ] **Step 4 : lancer, constater le succès**

Run: `cd web && npx vitest run tests/labels-detail.test.ts tests/english.test.ts && npx tsc --noEmit`
Expected: PASS. Si le test « de près : tuiles … » renvoie plus de 40 tuiles, **rapporter le nombre** (le plan a estimé ~15 à d = 1,1) au lieu de relever la borne.

- [ ] **Step 5 : commit**

```bash
git add web/src/labels/detail.ts web/tests/labels-detail.test.ts
git commit -m "feat(labels): chargeur des tuiles de villes de détail (niveau 5, sous d < 1,25)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Opus 5.5'
```

---

### Task 6 : fusion dans `LabelsController` et câblage

**Files:**
- Modify: `web/src/labels/controller.ts`
- Modify: `web/src/geo/wiring.ts`
- Modify: `web/tests/labels-controller.test.ts`
- Modify: `web/tests/geo-wiring.test.ts`

**Interfaces:**
- Consumes: `extendLabelSet`, `itemKey`, `DetailBatch` (T4) ; `DetailLabels` (T5).
- Produces : `LabelsControllerDeps.detail?: { readonly version: number; current(): DetailBatch }` ; `LabelsController.isEnabled(): boolean` ; `wireGeo` rappelle `deps.scene.requestRender()` après chaque `setEnabled` (pour qu'une vue parte et que le détail soit demandé sans mouvement de caméra).

- [ ] **Step 1 : permettre au banc de test d'injecter le détail**

Dans `web/tests/labels-controller.test.ts`, la fabrique `rig` (ligne 10) devient `function rig(d = 1.3, detail?: LabelsControllerDeps["detail"]) {` et ses deps du `LabelsController` reçoivent `detail,` (après `obstacles: () => obstacles,`). Imports : `LabelsControllerDeps` (type) depuis `../src/labels/controller`, `unitVectors` et le type `Place` depuis `../src/labels/data`.

- [ ] **Step 2 : écrire les tests qui échouent**

À la fin de `web/tests/labels-controller.test.ts` (la caméra de `rig` regarde (2 ; 47) ; à d = 1,1 le champ couvre environ ± 2° autour) :

```ts
describe("LabelsController — villes de détail (spec lot F §4.2)", () => {
  const fakeDetail = () => {
    const d = { version: 0, places: [] as Place[], current: () => ({ places: d.places, unit: unitVectors(d.places) }) };
    return d;
  };

  it("les villes de détail entrent dans la sélection quand leur version change", () => {
    const detail = fakeDetail();
    const r = rig(1.1, detail);
    r.ctl.setData(buildLabelSet([{ lon: 2, lat: 47, name: "Base", pop: 40_000, capital: false }], []));
    r.ctl.setEnabled(true);
    expect(r.last().map((v) => v.name)).toEqual(["Base"]);
    detail.places = [{ lon: 2.8, lat: 47.4, name: "Epinal", pop: 32_188, capital: false }];
    detail.version = 1;
    r.ctl.relayout();
    expect(r.last().map((v) => v.name).sort()).toEqual(["Base", "Epinal"]);
  });

  it("une étiquette déjà affichée le reste après une fusion (stabilité par itemKey, pas par id)", () => {
    const detail = fakeDetail();
    const r = rig(1.1, detail);
    r.ctl.setData(buildLabelSet([{ lon: 2, lat: 47, name: "Base", pop: 40_000, capital: false }], []));
    r.ctl.setEnabled(true);
    // Plus peuplée et quasi superposée : sans stabilité, elle passerait devant et masquerait « Base ».
    detail.places = [{ lon: 2.001, lat: 47, name: "Rival", pop: 50_000, capital: false }];
    detail.version = 1;
    r.ctl.relayout();
    expect(r.last().map((v) => v.name)).toEqual(["Base"]);
  });

  it("isEnabled reflète setEnabled", () => {
    const r = rig(3);
    expect(r.ctl.isEnabled()).toBe(false);
    r.ctl.setEnabled(true);
    expect(r.ctl.isEnabled()).toBe(true);
  });
});
```

Dans `web/tests/geo-wiring.test.ts`, dans le `describe("wireGeo — étiquettes …")` :

```ts
  it("après chaque activation, une vue est demandée (villes de détail sans attendre un mouvement)", async () => {
    const h = harness();
    wireGeo(h.deps).start();
    await flush();
    const enabled = h.labels.setEnabled.mock.invocationCallOrder.at(-1)!;
    const rendered = h.deps.scene.requestRender.mock.invocationCallOrder.at(-1)!;
    expect(rendered).toBeGreaterThan(enabled);
  });
```

- [ ] **Step 3 : lancer, constater l'échec**

Run: `cd web && npx vitest run tests/labels-controller.test.ts tests/geo-wiring.test.ts`
Expected: FAIL (`detail` ignoré, `isEnabled` inexistant, `requestRender` non appelé).

- [ ] **Step 4 : implémenter dans `web/src/labels/controller.ts`**

Imports : remplacer `import type { LabelSet } from "./data";` par `import { extendLabelSet, itemKey, type DetailBatch, type LabelSet } from "./data";`.

Dans `LabelsControllerDeps`, ajouter :

```ts
  /** Villes de détail visibles (spec lot F §4) ; `version` change quand leur ensemble change. */
  detail?: { readonly version: number; current(): DetailBatch };
```

Champs de la classe : ajouter sous `private set: LabelSet | null = null;` :

```ts
  /** Socle (`places.json` + pays) ; `set` = socle + villes de détail, reconstruit par `syncDetail`. */
  private baseSet: LabelSet | null = null;
  private detailVer = -1;
```

`setData` devient :

```ts
  setData(set: LabelSet | null): void {
    this.baseSet = set;
    this.set = set;
    this.detailVer = -1;
    this.placed = [];
    this.values.clear();
    if (this.enabled) this.refresh();
  }
```

Ajouter la méthode publique :

```ts
  isEnabled(): boolean {
    return this.enabled;
  }
```

Ajouter la méthode privée :

```ts
  /** Refusionne socle + détail si le détail a changé. Renvoie les clés des étiquettes placées
   * avant la fusion (les ids changent), `null` si rien n'a été refusionné. */
  private syncDetail(): Set<string> | null {
    const detail = this.deps.detail;
    if (!detail || !this.baseSet || !this.set || detail.version === this.detailVer) return null;
    const old = this.set;
    const keys = new Set(this.placed.map((pl) => itemKey(old.items[pl.id]!)));
    this.detailVer = detail.version;
    this.set = extendLabelSet(this.baseSet, detail.current());
    this.placed = [];
    this.values.clear();
    return keys;
  }
```

Dans `refresh()`, remplacer le début jusqu'à la ligne `this.lastTier = tier;` par :

```ts
  private refresh(size: Size = this.deps.size()): void {
    if (!this.set) return;
    const { camera } = this.deps;
    const { width, height } = size;
    const d = camera.position.length();
    const tier = tierIndex(d);
    const sameTier = tier === this.lastTier;
    const prevIds = new Set(this.placed.map((x) => x.id));
    const prevKeys = this.syncDetail();
    const set = this.set;
    // Changement de palier : on repart de l'ordre de priorité strict (spec §3). Après une fusion,
    // les ids ont changé : les étiquettes affichées sont retrouvées par leur clé.
    let shown = new Set<number>();
    if (sameTier) {
      if (prevKeys === null) shown = prevIds;
      else for (const it of set.items) if (prevKeys.has(itemKey(it))) shown.add(it.id);
    }
    this.lastTier = tier;
```

(le reste de `refresh()` est inchangé et utilise `set` et `shown`).

- [ ] **Step 5 : implémenter dans `web/src/geo/wiring.ts`**

Dans `applyLabels`, remplacer la dernière ligne `deps.labels.setEnabled(labelsOn); // …` par :

```ts
    deps.labels.setEnabled(labelsOn); // `labelsOn` relu après l'attente : il a pu basculer pendant le chargement
    deps.scene.requestRender(); // une vue part : les villes de détail sont demandées sans attendre un mouvement
```

Dans `setupGeo`, avant `const labels = new LabelsController({` :

```ts
  const detail = new DetailLabels(
    base,
    {
      async fetchJson(url, signal) {
        const r = await fetch(url, { signal });
        if (r.status === 404) return null; // tuile sans ville (océan) : pas un échec
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
        return r.json() as Promise<unknown>;
      },
    },
    () => labels.relayout(),
  );
```

Ajouter `detail,` aux deps du `LabelsController`, et remplacer `scene.onViewChange(() => labels.onView());` par :

```ts
  scene.onViewChange((view) => {
    detail.update(view, labels.isEnabled());
    labels.onView();
  });
```

Ajouter l'import `import { DetailLabels } from "../labels/detail";` ; ajouter `detail` à l'objet du crochet de validation `__worldtempGeo` (`{ labels, rivers: wiring.rivers, detail }`).

- [ ] **Step 6 : lancer toute la suite front**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: PASS (tous).

- [ ] **Step 7 : commit**

```bash
git add web/src/labels/controller.ts web/src/geo/wiring.ts web/tests/labels-controller.test.ts web/tests/geo-wiring.test.ts
git commit -m "feat(labels): villes de détail fusionnées à la sélection des étiquettes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Opus 5.5'
```

---

### Task 7 : index de recherche et modèle clavier (`search/index.ts`, `search/model.ts`)

**Files:**
- Create: `web/src/search/index.ts`
- Create: `web/src/search/model.ts`
- Create: `web/tests/search-index.test.ts`
- Create: `web/tests/search-model.test.ts`

**Interfaces:**
- Consumes: `normalizeName`, `prefixOf` (T1) ; `GEO_VERSION` ; `GeoDataError` (`labels/data.ts`).
- Produces (`search/index.ts`) : `MIN_CHARS = 2`, `MAX_RESULTS = 8` ; `interface SearchResult { name: string; region: string; country: string; lon: number; lat: number; pop: number }` ; `parseSearchFile(json: unknown): { result: SearchResult; keys: string[] }[]` ; `resultLabel(r: SearchResult): string` ; `class CitySearch { constructor(base: string, fetchJson: (url: string) => Promise<unknown | null>); query(text: string): Promise<SearchResult[]> }`.
- Produces (`search/model.ts`) : `type SearchAction = { type: "none" } | { type: "choose"; result: SearchResult } | { type: "close" }` ; `class SearchModel { results: readonly SearchResult[]; active: number; begin(): number; accept(ticket: number, results: readonly SearchResult[]): boolean; key(key: string): SearchAction }`.

- [ ] **Step 1 : écrire les tests qui échouent**

`web/tests/search-index.test.ts` :

```ts
import { describe, expect, it, vi } from "vitest";
import { GEO_VERSION } from "../src/geo/loader";
import { GeoDataError } from "../src/labels/data";
import { CitySearch, MAX_RESULTS, parseSearchFile, resultLabel } from "../src/search/index";

const EP = {
  version: 1,
  entries: [
    ["Épinal", "Grand Est", "France", 6.45, 48.17, 32188, ["epinal"]],
    ["Epila", "Aragon", "Spain", -1.28, 41.6, 4500, ["epila"]],
    ["Epe", "Gelderland", "Netherlands", 5.98, 52.35, 3000, ["epe"]],
  ],
};

describe("parseSearchFile", () => {
  it("lit les entrées", () => {
    expect(parseSearchFile(EP)[0]).toEqual({
      result: { name: "Épinal", region: "Grand Est", country: "France", lon: 6.45, lat: 48.17, pop: 32188 },
      keys: ["epinal"],
    });
  });
  it("rejette une version inconnue ou une entrée mal formée", () => {
    expect(() => parseSearchFile({ version: 2, entries: [] })).toThrowError(GeoDataError);
    expect(() => parseSearchFile({ version: 1, entries: [["X", "", "", 0, 0, 1]] })).toThrowError(GeoDataError);
    expect(() => parseSearchFile({ version: 1, entries: [["X", "", "", 0, 0, 1, "x"]] })).toThrowError(GeoDataError);
  });
});

describe("resultLabel", () => {
  it("nom — région, pays ; région vide omise ; les deux vides → nom seul", () => {
    const r = { name: "Épinal", region: "Grand Est", country: "France", lon: 0, lat: 0, pop: 0 };
    expect(resultLabel(r)).toBe("Épinal — Grand Est, France");
    expect(resultLabel({ ...r, region: "" })).toBe("Épinal — France");
    expect(resultLabel({ ...r, region: "", country: "" })).toBe("Épinal");
  });
});

describe("CitySearch", () => {
  it("moins de 2 caractères normalisés : aucun fichier demandé", async () => {
    const fetchJson = vi.fn();
    const s = new CitySearch("/geo", fetchJson);
    expect(await s.query("É")).toEqual([]);
    expect(await s.query("  ")).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalled();
  });
  it("demande le fichier du préfixe normalisé, filtre par début de clé, garde l'ordre du fichier", async () => {
    const fetchJson = vi.fn(async () => EP);
    const s = new CitySearch("/geo", fetchJson);
    expect((await s.query("ÉPI")).map((r) => r.name)).toEqual(["Épinal", "Epila"]);
    expect(fetchJson).toHaveBeenCalledWith(`/geo/search/ep.json?v=${GEO_VERSION}`);
  });
  it("un fichier n'est téléchargé qu'une fois", async () => {
    const fetchJson = vi.fn(async () => EP);
    const s = new CitySearch("/geo", fetchJson);
    await s.query("ep");
    await s.query("epi");
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
  it("404 (null) : aucun résultat", async () => {
    const s = new CitySearch("/geo", async () => null);
    expect(await s.query("zz")).toEqual([]);
  });
  it("échec réseau : rejette, puis retente à la requête suivante", async () => {
    const fetchJson = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(EP);
    const s = new CitySearch("/geo", fetchJson);
    await expect(s.query("ep")).rejects.toThrowError("offline");
    expect((await s.query("ep")).length).toBe(3);
  });
  it(`au plus ${MAX_RESULTS} résultats`, async () => {
    const many = { version: 1, entries: Array.from({ length: 20 }, (_, i) => [`Ep${i}`, "", "", 0, 0, 1000 - i, [`ep${i}`]]) };
    const s = new CitySearch("/geo", async () => many);
    expect(await s.query("ep")).toHaveLength(MAX_RESULTS);
  });
});
```

`web/tests/search-model.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { SearchModel } from "../src/search/model";

const r = (name: string) => ({ name, region: "", country: "", lon: 0, lat: 0, pop: 0 });

describe("SearchModel — clavier et requêtes périmées (spec lot F §5.2)", () => {
  it("de nouveaux résultats activent le premier ; aucun résultat → -1", () => {
    const m = new SearchModel();
    expect(m.accept(m.begin(), [r("A"), r("B")])).toBe(true);
    expect(m.active).toBe(0);
    m.accept(m.begin(), []);
    expect(m.active).toBe(-1);
  });
  it("une réponse périmée est ignorée", () => {
    const m = new SearchModel();
    const old = m.begin();
    const fresh = m.begin();
    expect(m.accept(fresh, [r("New")])).toBe(true);
    expect(m.accept(old, [r("Old")])).toBe(false);
    expect(m.results.map((x) => x.name)).toEqual(["New"]);
  });
  it("flèches : circulent dans la liste", () => {
    const m = new SearchModel();
    m.accept(m.begin(), [r("A"), r("B"), r("C")]);
    m.key("ArrowDown");
    expect(m.active).toBe(1);
    m.key("ArrowUp");
    m.key("ArrowUp");
    expect(m.active).toBe(2);
    m.key("ArrowDown");
    expect(m.active).toBe(0);
  });
  it("Entrée choisit l'actif ; sans résultat, rien", () => {
    const m = new SearchModel();
    expect(m.key("Enter")).toEqual({ type: "none" });
    m.accept(m.begin(), [r("A"), r("B")]);
    m.key("ArrowDown");
    expect(m.key("Enter")).toEqual({ type: "choose", result: r("B") });
  });
  it("Échap ferme ; une autre touche ne fait rien", () => {
    const m = new SearchModel();
    expect(m.key("Escape")).toEqual({ type: "close" });
    expect(m.key("a")).toEqual({ type: "none" });
  });
});
```

- [ ] **Step 2 : lancer, constater l'échec**

Run: `cd web && npx vitest run tests/search-index.test.ts tests/search-model.test.ts`
Expected: FAIL (modules introuvables).

- [ ] **Step 3 : implémenter**

`web/src/search/index.ts` :

```ts
/**
 * Recherche de ville hors ligne (spec lot F §5.2) : index `geo/search/{pp}.json` découpé par les
 * deux premiers caractères normalisés ; chaque fichier est téléchargé une fois par session.
 */
import { GEO_VERSION } from "../geo/loader";
import { GeoDataError } from "../labels/data";
import { normalizeName, prefixOf } from "./normalize";

export const MIN_CHARS = 2;
export const MAX_RESULTS = 8;

export interface SearchResult {
  name: string;
  region: string;
  country: string;
  lon: number;
  lat: number;
  pop: number;
}

interface Entry {
  result: SearchResult;
  keys: string[];
}

export function parseSearchFile(json: unknown): Entry[] {
  if (typeof json !== "object" || json === null) throw new GeoDataError("search: expected an object");
  const doc = json as Record<string, unknown>;
  if (doc.version !== 1) throw new GeoDataError(`search: unknown version ${String(doc.version)}`);
  if (!Array.isArray(doc.entries)) throw new GeoDataError("search: expected an array");
  return doc.entries.map((e: unknown) => {
    if (!Array.isArray(e) || e.length !== 7) throw new GeoDataError("search: expected rows of 7 fields");
    const [name, region, country, lon, lat, pop, keys] = e as unknown[];
    if (typeof name !== "string" || typeof region !== "string" || typeof country !== "string") throw new GeoDataError("search: invalid text field");
    if (typeof lon !== "number" || typeof lat !== "number" || typeof pop !== "number") throw new GeoDataError("search: invalid number field");
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string")) throw new GeoDataError("search: invalid keys");
    return { result: { name, region, country, lon, lat, pop }, keys: keys as string[] };
  });
}

/** « Épinal — Grand Est, France » ; région ou pays vides omis. */
export function resultLabel(r: SearchResult): string {
  const where = [r.region, r.country].filter(Boolean).join(", ");
  return where ? `${r.name} — ${where}` : r.name;
}

export class CitySearch {
  private readonly files = new Map<string, Promise<Entry[]>>();

  /** `fetchJson` : `null` si 404 (aucune ville pour ce préfixe) ; rejette sur tout autre échec. */
  constructor(
    private readonly base: string,
    private readonly fetchJson: (url: string) => Promise<unknown | null>,
  ) {}

  async query(text: string): Promise<SearchResult[]> {
    const q = normalizeName(text);
    if (q.length < MIN_CHARS) return [];
    const out: SearchResult[] = [];
    for (const e of await this.file(prefixOf(q))) {
      if (!e.keys.some((k) => k.startsWith(q))) continue;
      out.push(e.result);
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }

  private file(prefix: string): Promise<Entry[]> {
    let p = this.files.get(prefix);
    if (!p) {
      p = this.fetchJson(`${this.base}/search/${prefix}.json?v=${GEO_VERSION}`).then((j) => (j === null ? [] : parseSearchFile(j)));
      this.files.set(prefix, p);
      // Un échec réseau n'est pas mémorisé : la frappe suivante retente.
      p.catch(() => {
        if (this.files.get(prefix) === p) this.files.delete(prefix);
      });
    }
    return p;
  }
}
```

`web/src/search/model.ts` :

```ts
/** État de la liste de résultats (spec lot F §5.2) : élément actif, clavier, requêtes périmées. Logique pure. */
import type { SearchResult } from "./index";

export type SearchAction = { type: "none" } | { type: "choose"; result: SearchResult } | { type: "close" };

const NONE: SearchAction = { type: "none" };

export class SearchModel {
  results: readonly SearchResult[] = [];
  active = -1;
  private ticket = 0;

  /** Avant chaque requête ; toute requête antérieure devient périmée. */
  begin(): number {
    return ++this.ticket;
  }

  /** Pose les résultats si `ticket` est la dernière requête ; renvoie `false` sinon. */
  accept(ticket: number, results: readonly SearchResult[]): boolean {
    if (ticket !== this.ticket) return false;
    this.results = results;
    this.active = results.length ? 0 : -1;
    return true;
  }

  key(key: string): SearchAction {
    const n = this.results.length;
    switch (key) {
      case "ArrowDown":
        if (n) this.active = (this.active + 1) % n;
        return NONE;
      case "ArrowUp":
        if (n) this.active = (this.active - 1 + n) % n;
        return NONE;
      case "Enter":
        return this.active >= 0 ? { type: "choose", result: this.results[this.active]! } : NONE;
      case "Escape":
        return { type: "close" };
      default:
        return NONE;
    }
  }
}
```

- [ ] **Step 4 : lancer, constater le succès**

Run: `cd web && npx vitest run tests/search-index.test.ts tests/search-model.test.ts tests/english.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add web/src/search/index.ts web/src/search/model.ts web/tests/search-index.test.ts web/tests/search-model.test.ts
git commit -m "feat(search): index de recherche par préfixe et modèle clavier de la liste

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Opus 5.5'
```

---

### Task 8 : vol animé de la caméra (`render/fly.ts`)

**Files:**
- Create: `web/src/render/fly.ts`
- Create: `web/tests/fly.test.ts`

**Interfaces:**
- Consumes: `lonLatToVec3` (`tiles/patch.ts`).
- Produces : `FLY_MS = 1500`, `FLY_DISTANCE = 1.15` ; `easeInOut(t: number): number` ; `flyPosition(from: THREE.Vector3, toDir: THREE.Vector3, toD: number, t: number, out: THREE.Vector3): THREE.Vector3` ; `interface FlightDeps { camera: { position: THREE.Vector3; lookAt(x: number, y: number, z: number): void }; controls: { enableDamping: boolean; update(): boolean }; onFrame(cb: (nowMs: number) => boolean): () => void; requestRender(): void; reducedMotion(): boolean }` ; `class Flight { constructor(deps: FlightDeps); readonly active: boolean; start(lon: number, lat: number, distance: number, onArrive: () => void): void; cancel(): void }`.

- [ ] **Step 1 : écrire les tests qui échouent**

`web/tests/fly.test.ts` :

```ts
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { FLY_MS, Flight, easeInOut, flyPosition } from "../src/render/fly";
import { lonLatToVec3 } from "../src/tiles/patch";

describe("easeInOut", () => {
  it("0 → 0, 0,5 → 0,5, 1 → 1, borné hors de [0, 1]", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });
});

describe("flyPosition", () => {
  const from = lonLatToVec3(0, 0).multiplyScalar(3);
  const to = lonLatToVec3(6.45, 48.17);

  it("t = 0 : position de départ ; t = 1 : au-dessus de la cible à la distance voulue", () => {
    const out = new THREE.Vector3();
    expect(flyPosition(from, to, 1.15, 0, out).distanceTo(from)).toBeLessThan(1e-9);
    flyPosition(from, to, 1.15, 1, out);
    expect(out.length()).toBeCloseTo(1.15, 9);
    expect(out.clone().normalize().distanceTo(to)).toBeLessThan(1e-9);
  });
  it("antipodes : trajectoire définie, qui monte en chemin sans dépasser 4", () => {
    const start = lonLatToVec3(0, 0).multiplyScalar(1.2);
    const target = lonLatToVec3(180, 0);
    const out = new THREE.Vector3();
    flyPosition(start, target, 1.15, 0.5, out);
    expect(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z)).toBe(true);
    expect(out.length()).toBeGreaterThan(1.5);
    expect(out.length()).toBeLessThanOrEqual(4);
    flyPosition(start, target, 1.15, 1, out);
    expect(out.clone().normalize().distanceTo(target)).toBeLessThan(1e-6);
  });
});

function fakeDeps(reduced = false) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 3);
  let frame: ((now: number) => boolean) | null = null;
  const unsubscribe = vi.fn(() => {
    frame = null;
  });
  const deps = {
    camera,
    controls: { enableDamping: true, update: vi.fn(() => false) },
    onFrame: vi.fn((cb: (now: number) => boolean) => {
      frame = cb;
      return unsubscribe;
    }),
    requestRender: vi.fn(),
    reducedMotion: () => reduced,
  };
  return { deps, tick: (now: number) => frame?.(now), unsubscribe, hasFrame: () => frame !== null };
}

describe("Flight", () => {
  it("anime sur FLY_MS puis arrive une fois, rend l'amortissement et se désinscrit", () => {
    const f = fakeDeps();
    const flight = new Flight(f.deps);
    const arrive = vi.fn();
    flight.start(6.45, 48.17, 1.15, arrive);
    expect(flight.active).toBe(true);
    expect(f.deps.controls.enableDamping).toBe(false);
    expect(f.tick(1000)).toBe(true);
    f.tick(1000 + FLY_MS / 2);
    expect(arrive).not.toHaveBeenCalled();
    f.tick(1000 + FLY_MS);
    expect(arrive).toHaveBeenCalledTimes(1);
    expect(f.deps.camera.position.length()).toBeCloseTo(1.15, 6);
    expect(flight.active).toBe(false);
    expect(f.unsubscribe).toHaveBeenCalled();
    expect(f.deps.controls.enableDamping).toBe(true);
  });
  it("cancel : s'arrête en place, sans arrivée", () => {
    const f = fakeDeps();
    const flight = new Flight(f.deps);
    const arrive = vi.fn();
    flight.start(6.45, 48.17, 1.15, arrive);
    f.tick(0);
    f.tick(FLY_MS / 3);
    const here = f.deps.camera.position.clone();
    flight.cancel();
    expect(f.hasFrame()).toBe(false);
    expect(arrive).not.toHaveBeenCalled();
    expect(f.deps.camera.position.equals(here)).toBe(true);
    expect(f.deps.controls.enableDamping).toBe(true);
  });
  it("un nouveau départ annule le vol en cours", () => {
    const f = fakeDeps();
    const flight = new Flight(f.deps);
    const first = vi.fn();
    flight.start(0, 0, 1.15, first);
    flight.start(10, 10, 1.15, vi.fn());
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    f.tick(0);
    f.tick(FLY_MS);
    expect(first).not.toHaveBeenCalled();
  });
  it("prefers-reduced-motion : saut direct, arrivée immédiate, aucune animation", () => {
    const f = fakeDeps(true);
    const flight = new Flight(f.deps);
    const arrive = vi.fn();
    flight.start(6.45, 48.17, 1.15, arrive);
    expect(f.deps.onFrame).not.toHaveBeenCalled();
    expect(arrive).toHaveBeenCalledTimes(1);
    expect(f.deps.camera.position.clone().normalize().distanceTo(lonLatToVec3(6.45, 48.17))).toBeLessThan(1e-9);
    expect(f.deps.requestRender).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : lancer, constater l'échec**

Run: `cd web && npx vitest run tests/fly.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : implémenter**

`web/src/render/fly.ts` :

```ts
/**
 * Vol animé de la caméra vers un lieu (spec lot F §5.3) : direction interpolée sur l'arc de sphère,
 * distance interpolée avec une montée proportionnelle à l'angle parcouru, accélération puis
 * freinage. Le vol passe par `SceneHandle.onFrame` ; toute interaction l'annule (câblage `main.ts`).
 */
import * as THREE from "three";
import { lonLatToVec3 } from "../tiles/patch";

export const FLY_MS = 1500;
export const FLY_DISTANCE = 1.15;
/** Miroir de MAX_DISTANCE (`render/scene.ts`), recopié pour ne pas tirer OrbitControls dans les tests. */
const MAX_D = 4;
/** Montée ajoutée au milieu d'un vol aux antipodes (proportionnelle à l'angle parcouru). */
const HUMP = 1;

export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const axis = new THREE.Vector3();
const q = new THREE.Quaternion();

export function flyPosition(from: THREE.Vector3, toDir: THREE.Vector3, toD: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  const e = easeInOut(t);
  const d0 = from.length();
  a.copy(from).divideScalar(d0);
  b.copy(toDir).normalize();
  const omega = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
  axis.crossVectors(a, b);
  // Antipodes (ou départ déjà au-dessus de la cible) : n'importe quel axe perpendiculaire convient.
  if (axis.lengthSq() < 1e-18) axis.crossVectors(a, Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
  q.setFromAxisAngle(axis.normalize(), omega * e);
  const d = Math.min(MAX_D, d0 + (toD - d0) * e + HUMP * (omega / Math.PI) * Math.sin(Math.PI * e));
  return out.copy(a).applyQuaternion(q).multiplyScalar(d);
}

export interface FlightDeps {
  camera: { position: THREE.Vector3; lookAt(x: number, y: number, z: number): void };
  controls: { enableDamping: boolean; update(): boolean };
  onFrame(cb: (nowMs: number) => boolean): () => void;
  requestRender(): void;
  reducedMotion(): boolean;
}

export class Flight {
  private unsub: (() => void) | null = null;
  private damping = true;

  constructor(private readonly deps: FlightDeps) {}

  get active(): boolean {
    return this.unsub !== null;
  }

  start(lon: number, lat: number, distance: number, onArrive: () => void): void {
    this.cancel();
    const { camera, controls } = this.deps;
    const toDir = lonLatToVec3(lon, lat);
    if (this.deps.reducedMotion()) {
      camera.position.copy(toDir).multiplyScalar(distance);
      camera.lookAt(0, 0, 0);
      controls.update();
      this.deps.requestRender();
      onArrive();
      return;
    }
    // Sans amortissement pendant le vol : l'inertie d'un glisser précédent est purgée tout de suite
    // et `controls.update()` de la boucle ne tire plus la caméra hors de la trajectoire.
    this.damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    const from = camera.position.clone();
    let t0: number | null = null;
    this.unsub = this.deps.onFrame((now) => {
      t0 ??= now;
      const t = Math.min(1, (now - t0) / FLY_MS);
      flyPosition(from, toDir, distance, t, camera.position);
      camera.lookAt(0, 0, 0);
      if (t >= 1) {
        this.finish();
        onArrive();
      }
      return true;
    });
    this.deps.requestRender();
  }

  cancel(): void {
    if (this.unsub) this.finish();
  }

  private finish(): void {
    this.unsub?.();
    this.unsub = null;
    this.deps.controls.enableDamping = this.damping;
    this.deps.controls.update();
  }
}
```

- [ ] **Step 4 : lancer, constater le succès**

Run: `cd web && npx vitest run tests/fly.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add web/src/render/fly.ts web/tests/fly.test.ts
git commit -m "feat(render): vol animé de la caméra vers un lieu, interruptible, reduced-motion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Opus 5.5'
```

---

### Task 9 : géolocalisation, nom dans le tooltip, URL de vue

**Files:**
- Create: `web/src/ui/locate.ts`
- Create: `web/tests/locate.test.ts`
- Modify: `web/src/ui/tooltip.ts`
- Modify: `web/tests/tooltip.test.ts`
- Modify: `web/src/geo/params.ts`
- Modify: `web/tests/geo-params.test.ts`

**Interfaces:**
- Produces : `LOCATE_OPTIONS: PositionOptions` ; `locate(geo: Pick<Geolocation, "getCurrentPosition"> | undefined): Promise<{ lon: number; lat: number }>` ; `Reading.name?: string` ; `tooltipText(name: string | undefined, values: readonly string[]): string | null` ; `withView(search: string, lon: number, lat: number, d: number): string`.

- [ ] **Step 1 : écrire les tests qui échouent**

`web/tests/locate.test.ts` :

```ts
import { describe, expect, it, vi } from "vitest";
import { LOCATE_OPTIONS, locate } from "../src/ui/locate";

describe("locate — géolocalisation du navigateur (spec lot F §5.4)", () => {
  it("succès : lon/lat, avec les options de la spec", async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { longitude: 6.45, latitude: 48.17 } } as GeolocationPosition));
    await expect(locate({ getCurrentPosition })).resolves.toEqual({ lon: 6.45, lat: 48.17 });
    expect(getCurrentPosition.mock.calls[0]![2]).toEqual({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 });
    expect(LOCATE_OPTIONS.timeout).toBe(10_000);
  });
  it("refus ou délai : rejet", async () => {
    const getCurrentPosition = vi.fn((_ok: PositionCallback, err?: PositionErrorCallback | null) => err?.({ code: 1 } as GeolocationPositionError));
    await expect(locate({ getCurrentPosition })).rejects.toThrowError("geolocation error 1");
  });
  it("API absente : rejet", async () => {
    await expect(locate(undefined)).rejects.toThrowError("geolocation unsupported");
  });
});
```

Dans `web/tests/tooltip.test.ts` (ajouter `tooltipText` à l'import de `../src/ui/tooltip`) :

```ts
describe("tooltipText — nom du lieu au-dessus des valeurs (spec lot F §5.3)", () => {
  it("nom puis valeurs, une par ligne", () => {
    expect(tooltipText("Paris", ["12 °C", "Wind 10 km/h"])).toBe("Paris\n12 °C\nWind 10 km/h");
  });
  it("sans nom : valeurs seules ; sans valeur : nom seul ; rien : null", () => {
    expect(tooltipText(undefined, ["12 °C"])).toBe("12 °C");
    expect(tooltipText("Paris", [])).toBe("Paris");
    expect(tooltipText(undefined, [])).toBeNull();
  });
});
```

Dans `web/tests/geo-params.test.ts` (ajouter `withView` à l'import de `../src/geo/params`) :

```ts
describe("withView — URL partageable après un vol", () => {
  it("réécrit lon, lat (2 décimales) et d (3 décimales), garde le reste", () => {
    expect(withView("?layer=temp&lon=1&d=3", 6.44976, 48.17264, 1.15)).toBe("?layer=temp&lon=6.45&d=1.150&lat=48.17");
  });
});
```

- [ ] **Step 2 : lancer, constater l'échec**

Run: `cd web && npx vitest run tests/locate.test.ts tests/tooltip.test.ts tests/geo-params.test.ts`
Expected: FAIL.

- [ ] **Step 3 : implémenter**

`web/src/ui/locate.ts` :

```ts
/** « Ma position » (spec lot F §5.4) : la position reste dans le navigateur, ni envoyée ni stockée. */
export const LOCATE_OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 };

export function locate(geo: Pick<Geolocation, "getCurrentPosition"> | undefined): Promise<{ lon: number; lat: number }> {
  return new Promise((resolve, reject) => {
    if (!geo) {
      reject(new Error("geolocation unsupported"));
      return;
    }
    geo.getCurrentPosition(
      (p) => resolve({ lon: p.coords.longitude, lat: p.coords.latitude }),
      (e) => reject(new Error(`geolocation error ${e.code}`)),
      LOCATE_OPTIONS,
    );
  });
}
```

`web/src/geo/params.ts`, à la fin :

```ts
/** Réécrit `lon`, `lat`, `d` (vue partageable après un vol, spec lot F §5.3). Résultat préfixé par `?`. */
export function withView(search: string, lon: number, lat: number, d: number): string {
  const p = new URLSearchParams(search);
  p.set("lon", lon.toFixed(2));
  p.set("lat", lat.toFixed(2));
  p.set("d", d.toFixed(3));
  return `?${p.toString()}`;
}
```

`web/src/ui/tooltip.ts` :
- dans `interface Reading`, ajouter `/** Nom du lieu (recherche), affiché au-dessus des valeurs. */ name?: string;` ;
- avant `export function placeTooltip`, ajouter :

```ts
/** Texte du tooltip : nom du lieu (s'il y en a un) puis une valeur par ligne ; `null` = rien à montrer. */
export function tooltipText(name: string | undefined, values: readonly string[]): string | null {
  const lines = name ? [name, ...values] : [...values];
  return lines.length ? lines.join("\n") : null;
}
```

- remplacer `refreshText` par :

```ts
  const refreshText = () => {
    if (!reading) return;
    const values: string[] = [];
    if (data) values.push(formatReading(data.def, sampleValue(data.pixels, data.grid, data.encoding, reading.lon, reading.lat)));
    if (wind) {
      sampleUV(wind, reading.lon, reading.lat, windSample);
      values.push(formatWind(windSample.u, windSample.v));
    }
    const text = tooltipText(reading.name, values);
    if (text !== null) tip.textContent = text;
  };
```

- dans `update`, remplacer la garde `if (!reading || (!data && !wind)) {` par `if (!reading || (!data && !wind && !reading.name)) {`.

- [ ] **Step 4 : lancer, constater le succès**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: PASS (toute la suite).

- [ ] **Step 5 : commit**

```bash
git add web/src/ui/locate.ts web/tests/locate.test.ts web/src/ui/tooltip.ts web/tests/tooltip.test.ts web/src/geo/params.ts web/tests/geo-params.test.ts
git commit -m "feat(ui): géolocalisation, nom du lieu dans le tooltip, URL de vue après un vol

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Opus 5.5'
```

---

### Task 10 : interface — boutons, champ de recherche, câblage, crédits

**Files:**
- Create: `web/src/search/ui.ts`
- Modify: `web/index.html`
- Modify: `web/src/style.css`
- Modify: `web/src/i18n/en.ts`
- Modify: `web/src/ui/overlay.ts`
- Modify: `web/src/main.ts`
- Modify: `web/tests/seo.test.ts` (si une assertion sur les sources ou l'attribution l'exige)

**Interfaces:**
- Consumes: `CitySearch`, `resultLabel`, `MIN_CHARS`, `SearchResult` (T7) ; `SearchModel` (T7) ; `normalizeName` (T1) ; `Flight`, `FLY_DISTANCE` (T8) ; `locate` (T9) ; `withView` (T9) ; `Reading.name` (T9).
- Produces : `createSearchUi(deps: SearchUiDeps): { open(): void; close(): void }` ; `Overlay.notifyLayout(): void` ; `STRINGS.search = { noMatches: "No matches", unavailable: "Search unavailable" }` ; `STRINGS.status.locationUnavailable = "Location unavailable"`.

- [ ] **Step 1 : textes anglais** — dans `web/src/i18n/en.ts`, ajouter `locationUnavailable: "Location unavailable",` à la fin de `status`, et après `legend` :

```ts
  search: {
    noMatches: "No matches",
    unavailable: "Search unavailable",
  },
```

- [ ] **Step 2 : `index.html`**

Dans `#banner`, juste avant `<button id="about-open" …>` :

```html
        <button id="search-open" type="button" aria-label="Search for a city" aria-expanded="false" aria-controls="search">🔍</button>
        <button id="locate" type="button" aria-label="Go to my location">📍</button>
```

Juste après `</header>` (avant `<div id="status" …>`) :

```html
      <div id="search" class="panel" hidden>
        <input id="search-input" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="search-results" aria-label="City name" placeholder="Search a city" autocomplete="off" spellcheck="false" />
        <ul id="search-results" role="listbox" aria-label="Cities"></ul>
        <p id="search-message" role="status" hidden></p>
      </div>
```

Dans `#attribution`, ajouter ` · GeoNames` après `Natural Earth`.

Dans le panneau About :
- liste « Layers », après l'élément `<li><strong>Labels</strong> …</li>` :

```html
          <li><strong>Search</strong> and <strong>My location</strong> — find any town of more than 1,000 inhabitants, or fly to where you are.</li>
```

- paragraphe « Sources & credits » : ajouter ` · GeoNames (CC BY 4.0)` après `Natural Earth` (avant le point final).
- paragraphe « Privacy » : ajouter à la fin ` The “My location” button uses your device's location only in your browser: it is never sent or stored.`

- [ ] **Step 3 : style** (`web/src/style.css`)

Remplacer le sélecteur `#about-open {` par `#about-open, #search-open, #locate {` (même bloc de règles). Ajouter après ce bloc :

```css
#search { grid-column: 1 / -1; justify-self: center; width: min(100%, 24rem); box-sizing: border-box; }
#search-input {
  width: 100%; box-sizing: border-box; min-height: 2.5rem; padding: 0.5rem;
  font: inherit; color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 0.375rem;
}
#search-results { list-style: none; margin: 0.25rem 0 0; padding: 0; max-height: 50vh; overflow-y: auto; }
#search-results li { min-height: 2.5rem; box-sizing: border-box; padding: 0.5rem; border-radius: 0.25rem; cursor: pointer; }
#search-results li[aria-selected="true"], #search-results li:hover { background: rgba(255, 255, 255, 0.15); }
#search-message { margin: 0.25rem 0 0; opacity: 0.8; }
```

- [ ] **Step 4 : `Overlay.notifyLayout`** (`web/src/ui/overlay.ts`)

Dans l'interface `Overlay`, sous `onLayoutChange` : `/** Un panneau a changé de taille hors du bouton de repli (champ de recherche). */ notifyLayout(): void;`. Dans l'objet renvoyé par `createOverlay`, après `onLayoutChange(cb) {…},` :

```ts
    notifyLayout() {
      for (const cb of layoutListeners) cb();
    },
```

- [ ] **Step 5 : `web/src/search/ui.ts`**

```ts
/**
 * Recherche de ville (spec lot F §5.2) : DOM du champ dépliable sous le bandeau. La logique
 * (index, clavier, requêtes périmées) vit dans `index.ts` et `model.ts`, testés sans DOM.
 */
import { STRINGS } from "../i18n";
import { type CitySearch, MIN_CHARS, type SearchResult, resultLabel } from "./index";
import { SearchModel } from "./model";
import { normalizeName } from "./normalize";

export interface SearchUiDeps {
  openButton: HTMLButtonElement;
  panel: HTMLElement;
  input: HTMLInputElement;
  list: HTMLElement;
  message: HTMLElement;
  search: Pick<CitySearch, "query">;
  onChoose(result: SearchResult): void;
  /** Le panneau s'ouvre ou se ferme : les étiquettes doivent l'éviter. */
  onLayoutChange(): void;
}

export function createSearchUi(d: SearchUiDeps): { open(): void; close(): void } {
  const model = new SearchModel();

  const setMessage = (text: string | null): void => {
    d.message.textContent = text ?? "";
    d.message.hidden = text === null;
  };

  const render = (): void => {
    d.list.replaceChildren(
      ...model.results.map((r, i) => {
        const li = document.createElement("li");
        li.id = `search-option-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(i === model.active));
        li.textContent = resultLabel(r);
        li.addEventListener("mousedown", (e) => e.preventDefault()); // garder le focus dans le champ
        li.addEventListener("click", () => choose(r));
        return li;
      }),
    );
    d.input.setAttribute("aria-expanded", String(model.results.length > 0));
    if (model.active >= 0) d.input.setAttribute("aria-activedescendant", `search-option-${model.active}`);
    else d.input.removeAttribute("aria-activedescendant");
  };

  const open = (): void => {
    d.panel.hidden = false;
    d.openButton.setAttribute("aria-expanded", "true");
    d.input.focus();
    d.input.select();
    d.onLayoutChange();
  };

  const close = (): void => {
    model.accept(model.begin(), []); // périme toute requête en vol
    render();
    setMessage(null);
    d.panel.hidden = true;
    d.openButton.setAttribute("aria-expanded", "false");
    d.onLayoutChange();
  };

  const choose = (r: SearchResult): void => {
    close();
    d.input.blur();
    d.onChoose(r);
  };

  d.openButton.addEventListener("click", () => (d.panel.hidden ? open() : close()));

  d.input.addEventListener("input", async () => {
    const ticket = model.begin();
    let results: SearchResult[] = [];
    let failed = false;
    try {
      results = await d.search.query(d.input.value);
    } catch (e) {
      console.warn("[worldtemp] search unavailable:", e);
      failed = true;
    }
    if (!model.accept(ticket, results)) return;
    render();
    const enough = normalizeName(d.input.value).length >= MIN_CHARS;
    setMessage(failed ? STRINGS.search.unavailable : enough && results.length === 0 ? STRINGS.search.noMatches : null);
  });

  d.input.addEventListener("keydown", (e) => {
    const action = model.key(e.key);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      render();
    } else if (action.type === "choose") {
      e.preventDefault();
      choose(action.result);
    } else if (action.type === "close") {
      e.preventDefault();
      close();
      d.openButton.focus();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (document.querySelector("dialog[open]")) return; // panneau About ouvert
    e.preventDefault();
    open();
  });

  return { open, close };
}
```

- [ ] **Step 6 : câblage dans `web/src/main.ts`**

Imports à ajouter :

```ts
import { withView } from "./geo/params";
import { FLY_DISTANCE, Flight } from "./render/fly";
import { CitySearch } from "./search/index";
import { createSearchUi } from "./search/ui";
import { locate } from "./ui/locate";
```

Après la déclaration de `let windNotice: string | null = null;`, ajouter :

```ts
  /** Retour d'une action de l'utilisateur (« Location unavailable »), prioritaire, effacé après 5 s. */
  let userNotice: string | null = null;
  let userNoticeTimer: ReturnType<typeof setTimeout> | undefined;
```

Dans `refreshBanner`, préfixer **les deux** chaînes de `ui.setStatus(` par `userNotice ??` (avant `layerNotice ??`).

Juste après la définition de `refreshBanner` (avant `const activate = …`), ajouter :

```ts
  const flashNotice = (text: string): void => {
    userNotice = text;
    refreshBanner();
    clearTimeout(userNoticeTimer);
    userNoticeTimer = setTimeout(() => {
      userNotice = null;
      refreshBanner();
    }, 5_000);
  };

  // Recherche de ville et « ma position » (spec lot F §5) : vol, puis marqueur et tooltip au point.
  const flight = new Flight({
    camera: sceneHandle.camera,
    controls: sceneHandle.controls,
    onFrame: (cb) => sceneHandle.onFrame(cb),
    requestRender: () => sceneHandle.requestRender(),
    reducedMotion: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  // Toute interaction avec le globe reprend la main (capture : avant OrbitControls et le zoom).
  canvas.addEventListener("pointerdown", () => flight.cancel(), { capture: true });
  canvas.addEventListener("wheel", () => flight.cancel(), { capture: true, passive: true });
  const goTo = (lon: number, lat: number, name?: string): void => {
    tooltip.setReading(null, "pin");
    flight.start(lon, lat, FLY_DISTANCE, () => {
      tooltip.setReading({ lon, lat, name }, "pin");
      tooltip.update(sceneHandle.camera, canvas.clientWidth, canvas.clientHeight);
      history.replaceState(null, "", withView(location.search, lon, lat, FLY_DISTANCE));
      sceneHandle.requestRender();
    });
  };
  const geoBase = `${import.meta.env.BASE_URL}geo`;
  createSearchUi({
    openButton: byId<HTMLButtonElement>("search-open"),
    panel: byId<HTMLElement>("search"),
    input: byId<HTMLInputElement>("search-input"),
    list: byId<HTMLElement>("search-results"),
    message: byId<HTMLElement>("search-message"),
    search: new CitySearch(geoBase, async (url) => {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return r.json() as Promise<unknown>;
    }),
    onChoose: (r) => goTo(r.lon, r.lat, r.name),
    onLayoutChange: () => ui.notifyLayout(),
  });
  byId<HTMLButtonElement>("locate").addEventListener("click", () => {
    locate("geolocation" in navigator ? navigator.geolocation : undefined).then(
      ({ lon, lat }) => goTo(lon, lat),
      (e: unknown) => {
        console.warn("[worldtemp] location unavailable:", e);
        flashNotice(STRINGS.status.locationUnavailable);
      },
    );
  });
```

- [ ] **Step 7 : tests, typage, build**

Run: `cd web && npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS ; le build réussit. Si `seo.test.ts` ou `english.test.ts` échouent sur un texte ajouté, **rapporter** le texte exact avant toute modification (ne pas reformuler les textes du plan sans accord). Relever la taille gzip de `dist/assets/index-*.js` affichée par Vite : ≤ 167,71 Ko (budget +6 Ko).

- [ ] **Step 8 : commit**

```bash
git add web/src/search/ui.ts web/index.html web/src/style.css web/src/i18n/en.ts web/src/ui/overlay.ts web/src/main.ts web/tests
git commit -m "feat(ui): recherche de ville et « ma position » dans le bandeau, vol et tooltip, crédit GeoNames

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Opus 5.5'
```

---

### Task 11 : revue et validation dans le navigateur (contrôleur, **accord de l'utilisateur requis**)

- [ ] **Step 1 : revue de branche** — relecture de `git diff master...feat/search-cities` contre la spec (§3 à §7) ; corriger les écarts dans des commits séparés, trailer compris.
- [ ] **Step 2 : demander l'accord de l'utilisateur** pour lancer `npm run dev` et ouvrir un onglet (mémoire de la machine).
- [ ] **Step 3 : validation** (spec §6), en consignant chaque point :
  1. `?lon=6.45&lat=48.17&d=1.1&labels=1` : Épinal visible avec sa valeur ; aucune erreur console ; au repos, 0 draw call / pas de rendu continu.
  2. De loin (d = 3) : `__worldtempGeo.detail` sans tuile voulue, aucune requête `geo/cities/` dans l'onglet Réseau.
  3. Recherche « epi » → Épinal en tête des résultats français ; « munchen » et « munich » → Munich ; vol, marqueur, tooltip « Épinal » + valeur ; URL réécrite.
  4. Un clic sur le globe pendant le vol l'interrompt ; `/` ouvre la recherche ; Échap la ferme ; ↑/↓/Entrée.
  5. 📍 accepté puis refusé (message « Location unavailable » 5 s).
  6. Largeur 500 px : bandeau, champ, liste lisibles et utilisables.
- [ ] **Step 4 : arrêter le serveur** (`netstat -ano | grep :5173` puis `taskkill //PID <pid> //F`).

### Task 12 : merge, déploiement, HISTORY (contrôleur)

- [ ] **Step 1 :** suites complètes vertes (`.venv/Scripts/python -m pytest -q` ; `cd web && npx vitest run && npx tsc --noEmit && npm run build`).
- [ ] **Step 2 :** `git switch master && git merge --no-ff feat/search-cities -m "Merge branch 'feat/search-cities' — recherche de ville, ma position, villes de détail GeoNames" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.
- [ ] **Step 3 :** avec l'accord de l'utilisateur, `git push` (le déploiement suit la CI), puis contrôle en prod : `https://globelayers.com/geo/search/ep.json?v=<GEO_VERSION>` répond 200 ; Épinal visible et trouvable.
- [ ] **Step 4 :** HISTORY mis à jour via la skill `updating-history` (feuille de route §8 : lot F livré, R4 rayé ; dettes éventuelles ; §9 état et prochaine action : lot E).
