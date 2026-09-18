# Repères géographiques (lot C) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** afficher sur le globe des étiquettes de villes (nom + valeur de la couche active), des noms de pays et les fleuves principaux, pilotés par deux interrupteurs.

**Architecture:** un script Python stdlib (`tools/build_geo.py`) transforme trois GeoJSON Natural Earth en trois fichiers statiques commités sous `web/public/geo/`. Côté front, les étiquettes sont des `div` positionnés par `projectToScreen`, choisis par une sélection pure (priorité, seuil de zoom, anti-chevauchement, plafond) ; les fleuves sont des quads instanciés statiques qui partagent avec le vent un fragment GLSL d'élargissement en espace écran. Aucun changement du pipeline horaire, du manifeste, des tuiles ni de R2.

**Tech Stack:** Python 3 stdlib (`urllib`, `json`, `struct`, `math`), pytest ; TypeScript, three 0.185, Vite, Vitest (environnement **node, sans DOM**).

**Spec:** `docs/superpowers/specs/2026-09-18-labels-rivers-design.md` — à lire avec ce plan.

## Global Constraints

- Branche `feat/labels-rivers` créée depuis `master` ; merge local `--no-ff` à la fin (T12), jamais de push avant T12.
- Chaque commit se termine par le trailer **littéral** `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` ; vérifier après chaque commit : `git log -1 --format=%B | grep -c 'Claude Fable 5.1'` doit afficher `1`. `git merge` n'accepte pas `-F -` : utiliser `-m`.
- Fichiers texte en **LF**. Commentaires et messages en français, dans le style du dépôt.
- Tests front : `cd web && npx vitest run` ; typage : `cd web && npx tsc --noEmit -p .` ; tests Python : `.venv/Scripts/python -m pytest` depuis la racine (venv Windows, sans eccodes ni GDAL).
- Vitest tourne **sans DOM** : tout test qui a besoin d'un bouton utilise un faux objet ; `labels/layer.ts` (DOM pur) n'a pas de test, il se valide à l'œil (T11).
- Budgets (spec §2, §5, §9) : `places.json` ≤ 300 Ko, `countries.json` ≤ 15 Ko, `rivers.bin` ≤ 400 Ko, **≤ 25 000 segments** de fleuve après subdivision, bundle ≤ **+8 Ko gzip** par rapport à 156,08 Ko, sélection d'étiquettes ≤ 2 ms.
- Toute mesure de performance se fait sur `vite build` + `vite preview`, jamais en mode dev (HISTORY §6). `TaskStop` ne tue pas le node de Vite : libérer le port par `netstat -ano | grep :4173` puis `taskkill //PID <pid> //F`.
- Seuils de zoom et plafonds sont des **constantes exportées** (`CITY_TIERS`, `COUNTRY_TIERS`, `LABEL_CAP`, `RIVER_TIERS`) : réglables en T11 sans toucher à la logique.
- Ne jamais committer `tools/.geo-cache/` (téléchargements Natural Earth).

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `tools/build_geo.py` (créé) | Natural Earth → `places.json`, `countries.json`, `rivers.bin` |
| `tests/test_build_geo.py` (créé) | logique pure du script + validité des fichiers commités |
| `web/public/geo/{places.json,countries.json,rivers.bin}` (créés) | données statiques servies avec le site |
| `web/src/ui/toggle.ts` (créé, remplace `ui/wind-toggle.ts`) | interrupteur générique |
| `web/src/geo/params.ts` (créé) | `?labels=`, `?rivers=` |
| `web/src/geo/loader.ts` (créé) | chargement unique des fichiers `geo/` |
| `web/src/labels/data.ts` (créé) | parseurs + `LabelSet` (vecteurs unité) |
| `web/src/labels/select.ts` (créé) | sélection pure |
| `web/src/labels/text.ts` (créé) | texte de valeur d'une étiquette |
| `web/src/labels/layer.ts` (créé) | DOM |
| `web/src/labels/controller.ts` (créé) | cadence, stabilité, valeurs |
| `web/src/rivers/data.ts` (créé) | parseur `rivers.bin` → segments 3D |
| `web/src/render/rivers.ts` + `shaders/rivers.{vert,frag}.glsl` (créés) | rendu des fleuves |
| `web/src/render/shaders/screen-quad.glsl` (créé) | fragment GLSL partagé vent/fleuves |
| `web/src/render/wind.ts`, `shaders/wind.vert.glsl` (modifiés) | utilisent le fragment partagé ; `renderOrder` 2 |
| `web/index.html`, `web/src/style.css`, `web/src/ui/overlay.ts`, `web/src/main.ts` (modifiés) | câblage |

---

### Task 1: `tools/build_geo.py` — logique pure

**Files:**
- Create: `tools/build_geo.py`
- Test: `tests/test_build_geo.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces (Python) : `props(feature) -> dict`, `build_places(features) -> list[list]`, `build_countries(features) -> list[list]`, `simplify(points, tol) -> list[tuple]`, `river_lines(features, tol) -> list[tuple[int, list[tuple[int,int]]]]`, `segment_count(lines) -> int`, `fit_budget(features, budget=25000, tol=0.02) -> tuple[list, float]`, `encode_rivers(lines) -> bytes`, `decode_rivers(data) -> list`, `dump_json(obj) -> bytes`, `main()`.
- Format `rivers.bin` (little-endian) : `b"WTRV"`, `u16` version = 1, `u32` nombre de lignes ; par ligne `u8` rang, `u8` 0, `u16` n, puis n × (`i16` lon, `i16` lat) en centièmes de degré ; lignes triées par rang croissant.

- [ ] **Step 1: Créer la branche**

```bash
git checkout -b feat/labels-rivers
```

- [ ] **Step 2: Écrire les tests qui échouent**

`tests/test_build_geo.py` :

```python
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
```

- [ ] **Step 3: Vérifier l'échec**

Run: `.venv/Scripts/python -m pytest tests/test_build_geo.py -q`
Expected: erreur de collecte `ModuleNotFoundError: No module named 'build_geo'` (import par `sys.path`, comme `tests/test_history_check.py` ; il n'y a pas de `tools/__init__.py` et il ne faut pas en créer).

- [ ] **Step 4: Écrire l'implémentation**

`tools/build_geo.py` :

```python
"""Natural Earth → web/public/geo/ (spec repères §2, §5).

    python tools/build_geo.py

Stdlib seule. Télécharge trois GeoJSON figés sur NE_TAG dans tools/.geo-cache/ (git-ignoré)
et écrit places.json, countries.json, rivers.bin — déterministes, commités, servis avec le site.
"""

from __future__ import annotations

import json
import math
import struct
import sys
import urllib.request
from pathlib import Path

NE_TAG = "v5.1.2"
BASE_URL = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{NE_TAG}/geojson/"
SOURCES = {
    "places": "ne_10m_populated_places.geojson",
    "countries": "ne_50m_admin_0_countries.geojson",
    "rivers": "ne_10m_rivers_lake_centerlines.geojson",
}
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".geo-cache"
OUT = ROOT / "web" / "public" / "geo"

MAGIC = b"WTRV"
VERSION = 1
SEGMENT_BUDGET = 25_000
MAX_SEGMENT_DEG = 2.0  # miroir de web/src/rivers/data.ts


def props(feature: dict) -> dict:
    """Propriétés à clés minuscules : Natural Earth mélange NAME_FR et scalerank selon les fichiers."""
    return {k.lower(): v for k, v in (feature.get("properties") or {}).items()}


def _name(p: dict) -> str:
    return (p.get("name_fr") or p.get("name") or "").strip()


def build_places(features: list[dict]) -> list[list]:
    rows = []
    for f in features:
        p = props(f)
        name = _name(p)
        cap = 1 if str(p.get("featurecla") or "").startswith("Admin-0 capital") else 0
        pop = int(p.get("pop_max") or 0)
        if not name or (pop <= 0 and not cap):
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        rows.append([round(lon, 2), round(lat, 2), name, pop, cap])
    rows.sort(key=lambda r: (-r[4], -r[3], r[2]))
    return rows


def build_countries(features: list[dict]) -> list[list]:
    rows = []
    for f in features:
        p = props(f)
        name = _name(p)
        if not name or p.get("label_x") is None or p.get("label_y") is None:
            continue
        rows.append([round(p["label_x"], 2), round(p["label_y"], 2), name, int(p.get("labelrank") or 9)])
    rows.sort(key=lambda r: (r[3], r[2]))
    return rows


def simplify(points: list[tuple], tol: float) -> list[tuple]:
    """Douglas-Peucker itératif, distance point-segment en degrés plans."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        worst, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            dist = math.hypot(px - ax, py - ay) if norm == 0 else abs(dy * (px - ax) - dx * (py - ay)) / norm
            if dist > worst:
                worst, idx = dist, i
        if worst > tol:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [pt for pt, k in zip(points, keep) if k]


def river_lines(features: list[dict], tol: float) -> list[tuple[int, list[tuple[int, int]]]]:
    lines = []
    for f in features:
        geom = f.get("geometry") or {}
        rank = max(0, min(255, int(props(f).get("scalerank") or 0)))
        parts = geom.get("coordinates") or []
        if geom.get("type") == "LineString":
            parts = [parts]
        for part in parts:
            pts = simplify([(c[0], c[1]) for c in part], tol)
            quant: list[tuple[int, int]] = []
            for lon, lat in pts:
                q = (round(lon * 100), round(lat * 100))
                if not quant or quant[-1] != q:
                    quant.append(q)
            if len(quant) >= 2:
                lines.append((rank, quant))
    lines.sort(key=lambda l: l[0])  # tri stable : l'ordre du fichier source départage
    return lines


def _angle_deg(a: tuple[int, int], b: tuple[int, int]) -> float:
    lon1, lat1, lon2, lat2 = (math.radians(v / 100) for v in (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(h))))


def segment_count(lines) -> int:
    """Segments après subdivision à MAX_SEGMENT_DEG, comme le fera le front."""
    total = 0
    for _, pts in lines:
        for a, b in zip(pts, pts[1:]):
            total += max(1, math.ceil(_angle_deg(a, b) / MAX_SEGMENT_DEG - 1e-9))
    return total


def fit_budget(features, budget: int = SEGMENT_BUDGET, tol: float = 0.02):
    lines = river_lines(features, tol)
    while segment_count(lines) > budget:
        tol *= 1.5
        lines = river_lines(features, tol)
    return lines, tol


def encode_rivers(lines) -> bytes:
    out = bytearray(MAGIC + struct.pack("<HI", VERSION, len(lines)))
    for rank, pts in lines:
        out += struct.pack("<BBH", rank, 0, len(pts))
        for lon, lat in pts:
            out += struct.pack("<hh", lon, lat)
    return bytes(out)


def decode_rivers(data: bytes):
    if data[:4] != MAGIC:
        raise ValueError("magic WTRV attendu")
    version, count = struct.unpack_from("<HI", data, 4)
    if version != VERSION:
        raise ValueError(f"version {version} inconnue")
    off, lines = 10, []
    for _ in range(count):
        rank, _pad, n = struct.unpack_from("<BBH", data, off)
        off += 4
        pts = [struct.unpack_from("<hh", data, off + 4 * i) for i in range(n)]
        off += 4 * n
        lines.append((rank, pts))
    if off != len(data):
        raise ValueError("taille incohérente")
    return lines


def dump_json(obj) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def _load(key: str) -> list[dict]:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{NE_TAG}-{SOURCES[key]}"
    if not path.exists():
        print(f"téléchargement {SOURCES[key]} ({NE_TAG})…")
        urllib.request.urlretrieve(BASE_URL + SOURCES[key], path)
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    places = build_places(_load("places"))
    countries = build_countries(_load("countries"))
    lines, tol = fit_budget(_load("rivers"))
    (OUT / "places.json").write_bytes(dump_json({"version": 1, "places": places}))
    (OUT / "countries.json").write_bytes(dump_json({"version": 1, "countries": countries}))
    (OUT / "rivers.bin").write_bytes(encode_rivers(lines))
    print(f"{len(places)} villes, {len(countries)} pays, {len(lines)} lignes de fleuve, "
          f"{segment_count(lines)} segments (tolérance {tol:.4f}°)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Ajouter à `.gitignore`, sous le bloc « Données et textures générées » :

```
tools/.geo-cache/
```

- [ ] **Step 5: Vérifier le succès**

Run: `.venv/Scripts/python -m pytest tests/test_build_geo.py -q`
Expected: `12 passed`. Puis `.venv/Scripts/python -m pytest -q` : aucun test existant cassé.

- [ ] **Step 6: Commit**

```bash
git add tools/build_geo.py tests/test_build_geo.py .gitignore
git commit -m "feat(geo): script Natural Earth -> villes, pays, fleuves (logique pure)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 2: Générer et committer `web/public/geo/`

**Files:**
- Create: `web/public/geo/places.json`, `web/public/geo/countries.json`, `web/public/geo/rivers.bin`
- Modify: `tests/test_build_geo.py`

**Interfaces:**
- Consumes: `tools/build_geo.py` (T1), accès réseau à `raw.githubusercontent.com`.
- Produces: les trois fichiers, formes de la spec §2 : `{"version":1,"places":[[lon,lat,"nom",pop,cap],…]}`, `{"version":1,"countries":[[lon,lat,"nom",rang],…]}`, `rivers.bin` (format T1).

- [ ] **Step 1: Écrire les tests de validité (ils échouent : fichiers absents)**

Ajouter à la fin de `tests/test_build_geo.py` :

```python
GEO = Path(__file__).resolve().parent.parent / "web" / "public" / "geo"


def test_fichiers_commites_places():
    raw = (GEO / "places.json").read_bytes()
    assert len(raw) <= 300_000 and b"\r" not in raw
    doc = json.loads(raw)
    assert doc["version"] == 1
    rows = doc["places"]
    assert 5000 <= len(rows) <= 8000
    assert all(len(r) == 5 and -180 <= r[0] <= 180 and -90 <= r[1] <= 90 and r[2] and r[4] in (0, 1) for r in rows)
    assert rows == sorted(rows, key=lambda r: (-r[4], -r[3], r[2]))
    names = {r[2] for r in rows}
    assert {"Paris", "Tokyo", "Lyon", "Marseille"} <= names
    paris = next(r for r in rows if r[2] == "Paris")
    assert paris[4] == 1 and abs(paris[0] - 2.35) < 0.2 and abs(paris[1] - 48.86) < 0.2


def test_fichiers_commites_countries():
    raw = (GEO / "countries.json").read_bytes()
    assert len(raw) <= 15_000 and b"\r" not in raw
    rows = json.loads(raw)["countries"]
    assert 150 <= len(rows) <= 260
    assert rows == sorted(rows, key=lambda r: (r[3], r[2]))
    assert {"France", "Japon", "Brésil"} <= {r[2] for r in rows}


def test_fichiers_commites_rivers():
    raw = (GEO / "rivers.bin").read_bytes()
    assert len(raw) <= 400_000
    lines = bg.decode_rivers(raw)
    assert len(lines) > 200
    assert [l[0] for l in lines] == sorted(l[0] for l in lines)
    assert all(len(pts) >= 2 and all(abs(x) <= 18000 and abs(y) <= 9000 for x, y in pts) for _, pts in lines)
    assert bg.segment_count(lines) <= 25_000
```

Run: `.venv/Scripts/python -m pytest tests/test_build_geo.py -q` → 3 échecs `FileNotFoundError`.

- [ ] **Step 2: Lancer le script**

Run: `.venv/Scripts/python tools/build_geo.py`
Expected: une ligne du type `7xxx villes, 2xx pays, N lignes de fleuve, ≤ 25000 segments (tolérance …)`.
Si un téléchargement renvoie 404 : le tag `v5.1.2` n'existe pas ; lister les tags (`gh api repos/nvkelso/natural-earth-vector/tags --jq '.[].name' | head`), prendre le plus récent `v5.x`, mettre à jour `NE_TAG` **et** la spec §2, relancer.
Si `countries.json` manque de pays (test < 150) : les propriétés `LABEL_X/LABEL_Y` sont absentes du fichier 50 m ; remplacer la source par `ne_10m_admin_0_countries.geojson` dans `SOURCES` et dans la spec §2.

- [ ] **Step 3: Vérifier le succès et le déterminisme**

Run: `.venv/Scripts/python -m pytest tests/test_build_geo.py -q` → `15 passed`.
Run: `.venv/Scripts/python tools/build_geo.py && git status --short web/public/geo` deux fois de suite : la seconde exécution ne doit modifier aucun fichier (`git diff --stat` vide après `git add`).
Relever les tailles : `ls -l web/public/geo` (à reporter dans le rapport de tâche).

- [ ] **Step 4: Commit**

```bash
git add web/public/geo tests/test_build_geo.py tools/build_geo.py docs/superpowers/specs/2026-09-18-labels-rivers-design.md
git commit -m "feat(geo): données Natural Earth commitées (villes, pays, fleuves)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 3: Interrupteur générique et paramètres d'URL

**Files:**
- Create: `web/src/ui/toggle.ts`, `web/src/geo/params.ts`
- Delete: `web/src/ui/wind-toggle.ts`
- Modify: `web/src/main.ts` (import et appel de `createWindToggle`)
- Test: `web/tests/toggle.test.ts`, `web/tests/geo-params.test.ts`

**Interfaces:**
- Produces: `createToggle(button: HTMLButtonElement, onChange: (on: boolean) => void, unavailableTitle: string): Toggle` avec `Toggle = { setOn(on: boolean): void; setDisabled(disabled: boolean): void }` ; `parseFlag(search: string, name: string, fallback?: boolean): boolean` ; `withFlag(search: string, name: string, on: boolean): string`.

- [ ] **Step 1: Écrire les tests qui échouent**

`web/tests/toggle.test.ts` :

```ts
import { describe, expect, it, vi } from "vitest";
import { createToggle } from "../src/ui/toggle";

/** Faux bouton : Vitest tourne sans DOM. */
function fakeButton(title = "") {
  const attrs = new Map<string, string>();
  let click: (() => void) | null = null;
  const b = {
    disabled: false,
    title,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    addEventListener: (_: string, cb: () => void) => { click = cb; },
  };
  return { button: b as unknown as HTMLButtonElement, attrs, click: () => click?.() };
}

describe("createToggle — interrupteur générique (spec repères §6)", () => {
  it("bascule au clic, reflète aria-checked, notifie", () => {
    const f = fakeButton();
    const onChange = vi.fn();
    createToggle(f.button, onChange, "Indisponible");
    expect(f.attrs.get("aria-checked")).toBe("false");
    f.click();
    expect(f.attrs.get("aria-checked")).toBe("true");
    expect(onChange).toHaveBeenCalledWith(true);
  });
  it("setOn ne notifie pas", () => {
    const f = fakeButton();
    const onChange = vi.fn();
    createToggle(f.button, onChange, "Indisponible").setOn(true);
    expect(f.attrs.get("aria-checked")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("désactivé : ignore le clic, annonce aria-checked false, pose le titre d'indisponibilité (dette n° 38)", () => {
    const f = fakeButton();
    const onChange = vi.fn();
    const t = createToggle(f.button, onChange, "Vent indisponible");
    t.setOn(true);
    t.setDisabled(true);
    expect(f.button.disabled).toBe(true);
    expect(f.attrs.get("aria-checked")).toBe("false");
    expect(f.button.title).toBe("Vent indisponible");
    f.click();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("réactivé : retrouve l'état demandé et le titre d'origine", () => {
    const f = fakeButton("Afficher le vent");
    const t = createToggle(f.button, vi.fn(), "Vent indisponible");
    t.setOn(true);
    t.setDisabled(true);
    t.setDisabled(false);
    expect(f.attrs.get("aria-checked")).toBe("true");
    expect(f.button.title).toBe("Afficher le vent");
  });
});
```

`web/tests/geo-params.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { parseFlag, withFlag } from "../src/geo/params";

describe("parseFlag / withFlag — ?labels=, ?rivers= (spec repères §6)", () => {
  it("1 et 0 explicites, sinon le repli (actif par défaut)", () => {
    expect(parseFlag("?labels=1", "labels")).toBe(true);
    expect(parseFlag("?labels=0", "labels")).toBe(false);
    expect(parseFlag("", "labels")).toBe(true);
    expect(parseFlag("?labels=oui", "labels")).toBe(true);
    expect(parseFlag("?rivers=x", "rivers", false)).toBe(false);
  });
  it("withFlag ne réécrit que son paramètre", () => {
    expect(withFlag("?layer=temp&wind=1", "labels", false)).toBe("?layer=temp&wind=1&labels=0");
    expect(withFlag("?labels=0&d=2", "labels", true)).toBe("?labels=1&d=2");
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd web && npx vitest run tests/toggle.test.ts tests/geo-params.test.ts`
Expected: FAIL, modules `../src/ui/toggle` et `../src/geo/params` introuvables.

- [ ] **Step 3: Implémenter**

`web/src/ui/toggle.ts` :

```ts
/** Interrupteur générique (`role="switch"`) : DOM seulement ; l'état initial et l'URL viennent de l'appelant. */
export interface Toggle {
  setOn(on: boolean): void;
  setDisabled(disabled: boolean): void;
}

export function createToggle(button: HTMLButtonElement, onChange: (on: boolean) => void, unavailableTitle: string): Toggle {
  let on = false;
  const idleTitle = button.title;
  // Désactivé = annoncé éteint : un switch grisé resté `aria-checked="true"` ment aux lecteurs d'écran.
  const render = () => button.setAttribute("aria-checked", String(on && !button.disabled));
  button.addEventListener("click", () => {
    if (button.disabled) return;
    on = !on;
    render();
    onChange(on);
  });
  render();
  return {
    setOn(v) {
      on = v;
      render();
    },
    setDisabled(disabled) {
      button.disabled = disabled;
      button.title = disabled ? unavailableTitle : idleTitle;
      render();
    },
  };
}
```

`web/src/geo/params.ts` :

```ts
/** Paramètres d'URL booléens des repères (`?labels=0|1`, `?rivers=0|1`, spec repères §6). */
export function parseFlag(search: string, name: string, fallback = true): boolean {
  const raw = new URLSearchParams(search).get(name);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

/** Réécrit seulement `name` dans la query string. Résultat préfixé par `?`. */
export function withFlag(search: string, name: string, on: boolean): string {
  const p = new URLSearchParams(search);
  p.set(name, on ? "1" : "0");
  return `?${p.toString()}`;
}
```

Dans `web/src/main.ts` : remplacer `import { createWindToggle } from "./ui/wind-toggle";` par `import { createToggle } from "./ui/toggle";`, et l'appel `createWindToggle(ui.windToggle, (on) => {` par `createToggle(ui.windToggle, (on) => {` en ajoutant le troisième argument `"Vent indisponible"` à la fermeture de l'appel :

```ts
  const windToggle = createToggle(ui.windToggle, (on) => {
    windOn = on;
    history.replaceState(null, "", withWindParam(location.search, on));
    void applyWind();
  }, "Vent indisponible");
```

Supprimer le fichier : `git rm web/src/ui/wind-toggle.ts`.

- [ ] **Step 4: Vérifier le succès**

Run: `cd web && npx vitest run && npx tsc --noEmit -p .`
Expected: tous les tests passent (248 + 6), aucune erreur de typage. `grep -rn "wind-toggle" web/src` ne renvoie que des sélecteurs CSS/HTML (`#wind-toggle`), plus aucun import.

- [ ] **Step 5: Commit**

```bash
git add -A web/src web/tests
git commit -m "refactor(ui): interrupteur générique, aria-checked cohérent une fois désactivé" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 4: `labels/data.ts` — parseurs et `LabelSet`

**Files:**
- Create: `web/src/labels/data.ts`
- Test: `web/tests/labels-data.test.ts`

**Interfaces:**
- Consumes: `lonLatToVec3(lon, lat, target?)` de `web/src/tiles/patch.ts`.
- Produces:

```ts
export class GeoDataError extends Error {}
export interface Place { lon: number; lat: number; name: string; pop: number; capital: boolean }
export interface Country { lon: number; lat: number; name: string; rank: number }
export interface LabelItem { id: number; kind: "city" | "country"; name: string; lon: number; lat: number; pop: number; capital: boolean; rank: number }
export interface LabelSet { items: LabelItem[]; unit: Float32Array } // pays d'abord, puis villes, dans l'ordre des fichiers ; unit[3·id…] = vecteur unité
export function parsePlaces(json: unknown): Place[]
export function parseCountries(json: unknown): Country[]
export function buildLabelSet(places: Place[], countries: Country[]): LabelSet
```

- [ ] **Step 1: Écrire les tests qui échouent**

`web/tests/labels-data.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { GeoDataError, buildLabelSet, parseCountries, parsePlaces } from "../src/labels/data";

describe("parsePlaces / parseCountries — spec repères §2", () => {
  it("lit les lignes [lon, lat, nom, pop, cap]", () => {
    expect(parsePlaces({ version: 1, places: [[2.35, 48.86, "Paris", 11000000, 1], [4.84, 45.77, "Lyon", 1700000, 0]] })).toEqual([
      { lon: 2.35, lat: 48.86, name: "Paris", pop: 11000000, capital: true },
      { lon: 4.84, lat: 45.77, name: "Lyon", pop: 1700000, capital: false },
    ]);
  });
  it("lit les lignes [lon, lat, nom, rang]", () => {
    expect(parseCountries({ version: 1, countries: [[2.55, 46.7, "France", 2]] })).toEqual([{ lon: 2.55, lat: 46.7, name: "France", rank: 2 }]);
  });
  it.each([
    ["pas un objet", null],
    ["version inconnue", { version: 2, places: [] }],
    ["places absent", { version: 1 }],
    ["ligne trop courte", { version: 1, places: [[2.35, 48.86, "Paris"]] }],
    ["longitude hors bornes", { version: 1, places: [[181, 0, "X", 1, 0]] }],
    ["latitude non finie", { version: 1, places: [[0, Number.NaN, "X", 1, 0]] }],
    ["nom vide", { version: 1, places: [[0, 0, "", 1, 0]] }],
  ])("parsePlaces refuse : %s", (_label, json) => {
    expect(() => parsePlaces(json)).toThrowError(GeoDataError);
  });
  it("parseCountries refuse un rang non numérique", () => {
    expect(() => parseCountries({ version: 1, countries: [[0, 0, "X", "2"]] })).toThrowError(GeoDataError);
  });
});

describe("buildLabelSet", () => {
  it("pays d'abord puis villes, ids = index, vecteurs unité précalculés", () => {
    const set = buildLabelSet(
      [{ lon: 0, lat: 0, name: "Zéro", pop: 5, capital: false }],
      [{ lon: 0, lat: 90, name: "Pôle", rank: 1 }],
    );
    expect(set.items.map((i) => [i.id, i.kind, i.name])).toEqual([[0, "country", "Pôle"], [1, "city", "Zéro"]]);
    expect(set.unit.length).toBe(6);
    expect(set.unit[1]).toBeCloseTo(1, 6);                       // pôle nord : y = 1
    expect(Math.hypot(set.unit[3]!, set.unit[4]!, set.unit[5]!)).toBeCloseTo(1, 6);
    expect(set.unit[4]).toBeCloseTo(0, 6);                       // équateur : y = 0
    expect(set.items[0]).toMatchObject({ pop: 0, capital: false, rank: 1 });
    expect(set.items[1]).toMatchObject({ pop: 5, rank: 0 });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd web && npx vitest run tests/labels-data.test.ts` → FAIL, module introuvable.

- [ ] **Step 3: Implémenter**

`web/src/labels/data.ts` :

```ts
/**
 * Données des étiquettes (spec repères §2, §3) : parseurs stricts des fichiers `geo/` et
 * `LabelSet`, la liste unique parcourue par la sélection. Logique pure.
 */
import * as THREE from "three";
import { lonLatToVec3 } from "../tiles/patch";

export class GeoDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeoDataError";
  }
}

export interface Place { lon: number; lat: number; name: string; pop: number; capital: boolean }
export interface Country { lon: number; lat: number; name: string; rank: number }

export interface LabelItem {
  id: number;
  kind: "city" | "country";
  name: string;
  lon: number;
  lat: number;
  /** Villes seulement ; 0 pour un pays. */
  pop: number;
  capital: boolean;
  /** Pays seulement (LABELRANK Natural Earth, 1 = plus important) ; 0 pour une ville. */
  rank: number;
}

/** `items` : pays d'abord, puis villes, chacun dans l'ordre (de priorité) de son fichier. */
export interface LabelSet {
  items: LabelItem[];
  /** Vecteur unité de l'item `id` en `unit[3·id … 3·id+2]`. */
  unit: Float32Array;
}

function rows(json: unknown, key: string, width: number): unknown[][] {
  if (typeof json !== "object" || json === null) throw new GeoDataError(`${key} : objet attendu`);
  const doc = json as Record<string, unknown>;
  if (doc.version !== 1) throw new GeoDataError(`${key} : version ${String(doc.version)} inconnue`);
  const list = doc[key];
  if (!Array.isArray(list)) throw new GeoDataError(`${key} : tableau attendu`);
  for (const r of list) {
    if (!Array.isArray(r) || r.length !== width) throw new GeoDataError(`${key} : ligne de ${width} champs attendue`);
  }
  return list as unknown[][];
}

function lonLatName(r: unknown[], key: string): { lon: number; lat: number; name: string } {
  const [lon, lat, name] = r;
  if (typeof lon !== "number" || !Number.isFinite(lon) || Math.abs(lon) > 180) throw new GeoDataError(`${key} : longitude invalide`);
  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) throw new GeoDataError(`${key} : latitude invalide`);
  if (typeof name !== "string" || name === "") throw new GeoDataError(`${key} : nom invalide`);
  return { lon, lat, name };
}

export function parsePlaces(json: unknown): Place[] {
  return rows(json, "places", 5).map((r) => {
    const pop = r[3];
    if (typeof pop !== "number" || !Number.isFinite(pop)) throw new GeoDataError("places : population invalide");
    return { ...lonLatName(r, "places"), pop, capital: r[4] === 1 };
  });
}

export function parseCountries(json: unknown): Country[] {
  return rows(json, "countries", 4).map((r) => {
    const rank = r[3];
    if (typeof rank !== "number" || !Number.isFinite(rank)) throw new GeoDataError("countries : rang invalide");
    return { ...lonLatName(r, "countries"), rank };
  });
}

export function buildLabelSet(places: Place[], countries: Country[]): LabelSet {
  const items: LabelItem[] = [];
  for (const c of countries) items.push({ id: items.length, kind: "country", name: c.name, lon: c.lon, lat: c.lat, pop: 0, capital: false, rank: c.rank });
  for (const p of places) items.push({ id: items.length, kind: "city", name: p.name, lon: p.lon, lat: p.lat, pop: p.pop, capital: p.capital, rank: 0 });
  const unit = new Float32Array(items.length * 3);
  const v = new THREE.Vector3();
  for (const it of items) {
    lonLatToVec3(it.lon, it.lat, v);
    unit[it.id * 3] = v.x;
    unit[it.id * 3 + 1] = v.y;
    unit[it.id * 3 + 2] = v.z;
  }
  return { items, unit };
}
```

- [ ] **Step 4: Vérifier le succès**

Run: `cd web && npx vitest run tests/labels-data.test.ts && npx tsc --noEmit -p .` → PASS (11 tests), typage propre.

- [ ] **Step 5: Commit**

```bash
git add web/src/labels/data.ts web/tests/labels-data.test.ts
git commit -m "feat(labels): parseurs des fichiers geo et LabelSet" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 5: `labels/select.ts` — sélection pure

**Files:**
- Create: `web/src/labels/select.ts`
- Test: `web/tests/labels-select.test.ts`

**Interfaces:**
- Consumes: `LabelSet`, `LabelItem` (T4) ; `Tier` de `web/src/gpu/tier.ts` (`"high" | "low"`).
- Produces:

```ts
export const CITY_TIERS: readonly { minD: number; minPop: number }[]
export const COUNTRY_TIERS: readonly { minD: number; maxRank: number }[]
export const LABEL_CAP: Record<Tier, number>      // { high: 60, low: 30 }
export const NARROW_PX = 600
export function tierIndex(d: number): number       // index du palier de zoom (0 = le plus loin)
export function labelCap(tier: Tier, viewportWidth: number): number
export function eligible(item: LabelItem, d: number): boolean
export interface Placed { id: number; x: number; y: number }
export interface SelectInput {
  set: LabelSet; d: number; camDir: { x: number; y: number; z: number };
  project(id: number, out: { x: number; y: number }): boolean;  // false = hors viewport
  cap: number; hasValue: boolean; shown: ReadonlySet<number>;
}
export function selectLabels(input: SelectInput): Placed[]
export function labelBox(item: LabelItem, x: number, y: number, hasValue: boolean): { x0: number; y0: number; x1: number; y1: number }
```

- [ ] **Step 1: Écrire les tests qui échouent**

`web/tests/labels-select.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { buildLabelSet, type LabelSet } from "../src/labels/data";
import { LABEL_CAP, eligible, labelBox, labelCap, selectLabels, tierIndex, type SelectInput } from "../src/labels/select";

const city = (name: string, pop: number, capital = false, lon = 0, lat = 0) => ({ lon, lat, name, pop, capital });
const country = (name: string, rank: number, lon = 0, lat = 0) => ({ lon, lat, name, rank });

/** Projecteur factice : position écran donnée par une table, tout le reste hors viewport. */
function input(set: LabelSet, screen: Record<string, [number, number]>, over: Partial<SelectInput> = {}): SelectInput {
  return {
    set, d: 1.3, camDir: { x: 0, y: 0, z: 1 }, cap: 60, hasValue: false, shown: new Set(),
    project(id, out) {
      const at = screen[set.items[id]!.name];
      if (!at) return false;
      out.x = at[0];
      out.y = at[1];
      return true;
    },
    ...over,
  };
}

/** Tous les lieux face caméra (+z) : lon = −90 dans le repère de lonLatToVec3. */
const FRONT = -90;

describe("paliers de zoom (spec repères §3)", () => {
  it("tierIndex suit les bornes 2,5 / 1,6 / 1,25", () => {
    expect([4, 2.5, 2.49, 1.6, 1.59, 1.25, 1.24, 1.05].map(tierIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
  it("villes : capitales toujours, sinon seuil de population du palier", () => {
    const set = buildLabelSet([city("Cap", 1000, true), city("Méga", 6e6), city("Grande", 2e6), city("Moyenne", 2e5), city("Petite", 5e3)], []);
    const names = (d: number) => set.items.filter((i) => eligible(i, d)).map((i) => i.name);
    expect(names(3)).toEqual(["Cap", "Méga"]);
    expect(names(2)).toEqual(["Cap", "Méga", "Grande"]);
    expect(names(1.4)).toEqual(["Cap", "Méga", "Grande", "Moyenne"]);
    expect(names(1.1)).toEqual(["Cap", "Méga", "Grande", "Moyenne", "Petite"]);
  });
  it("pays : par rang, puis tous, puis aucun de près", () => {
    const set = buildLabelSet([], [country("Un", 1), country("Quatre", 4), country("Sept", 7)]);
    const names = (d: number) => set.items.filter((i) => eligible(i, d)).map((i) => i.name);
    expect(names(3)).toEqual(["Un"]);
    expect(names(2)).toEqual(["Un", "Quatre"]);
    expect(names(1.4)).toEqual(["Un", "Quatre", "Sept"]);
    expect(names(1.1)).toEqual([]);
  });
  it("plafond par tier, divisé par deux sous 600 px", () => {
    expect(LABEL_CAP).toEqual({ high: 60, low: 30 });
    expect(labelCap("high", 1440)).toBe(60);
    expect(labelCap("high", 599)).toBe(30);
    expect(labelCap("low", 500)).toBe(15);
  });
});

describe("selectLabels", () => {
  it("écarte ce qui est derrière l'horizon sans même le projeter", () => {
    const set = buildLabelSet([city("Devant", 1e7, false, FRONT, 0), city("Derrière", 1e7, false, 90, 0)], []);
    const seen: string[] = [];
    const inp = input(set, { Devant: [100, 100], Derrière: [300, 300] });
    const project = inp.project;
    inp.project = (id, out) => { seen.push(set.items[id]!.name); return project(id, out); };
    expect(selectLabels(inp).map((p) => set.items[p.id]!.name)).toEqual(["Devant"]);
    expect(seen).toEqual(["Devant"]);
  });
  it("écarte ce que le projecteur déclare hors viewport", () => {
    const set = buildLabelSet([city("Vue", 1e7, false, FRONT, 0), city("Hors", 1e7, false, FRONT, 1)], []);
    expect(selectLabels(input(set, { Vue: [100, 100] })).map((p) => p.id)).toEqual([0]);
  });
  it("anti-chevauchement : le premier dans l'ordre de priorité gagne", () => {
    const set = buildLabelSet([city("Paris", 1e7, true, FRONT, 0), city("Versailles", 9e4, false, FRONT, 0.1), city("Lyon", 2e6, false, FRONT, 1)], []);
    const out = selectLabels(input(set, { Paris: [100, 100], Versailles: [110, 104], Lyon: [100, 300] }, { d: 1.1 }));
    expect(out.map((p) => set.items[p.id]!.name)).toEqual(["Paris", "Lyon"]);
    expect(out[0]).toEqual({ id: 0, x: 100, y: 100 });
  });
  it("une valeur affichée agrandit la boîte : deux villes compatibles sans valeur se gênent avec", () => {
    const set = buildLabelSet([city("Haut", 1e7, false, FRONT, 0), city("Bas", 9e6, false, FRONT, 1)], []);
    const screen = { Haut: [100, 100], Bas: [100, 126] } as Record<string, [number, number]>; // sans valeur : 111,5 < 114,5 ; avec : 126,5 > 114,5
    expect(selectLabels(input(set, screen)).length).toBe(2);
    expect(selectLabels(input(set, screen, { hasValue: true })).length).toBe(1);
  });
  it("s'arrête au plafond", () => {
    const places = Array.from({ length: 10 }, (_, i) => city(`V${i}`, 1e7 - i, false, FRONT, 0));
    const set = buildLabelSet(places, []);
    const screen = Object.fromEntries(places.map((p, i) => [p.name, [100, 50 + i * 60] as [number, number]]));
    expect(selectLabels(input(set, screen, { cap: 3 })).map((p) => set.items[p.id]!.name)).toEqual(["V0", "V1", "V2"]);
  });
  it("stabilité : une étiquette déjà affichée passe avant une plus prioritaire qui la chevauche", () => {
    const set = buildLabelSet([city("Grande", 1e7, false, FRONT, 0), city("Petite", 2e5, false, FRONT, 0.1)], []);
    const screen = { Grande: [100, 100], Petite: [105, 102] } as Record<string, [number, number]>;
    expect(selectLabels(input(set, screen)).map((p) => p.id)).toEqual([0]);
    expect(selectLabels(input(set, screen, { shown: new Set([1]) })).map((p) => p.id)).toEqual([1]);
  });
  it("une étiquette déjà affichée mais plus éligible à ce zoom disparaît", () => {
    const set = buildLabelSet([city("Petite", 2e5, false, FRONT, 0)], []);
    expect(selectLabels(input(set, { Petite: [100, 100] }, { d: 3, shown: new Set([0]) }))).toEqual([]);
  });
  it("les pays passent avant les villes", () => {
    const set = buildLabelSet([city("Paris", 1e7, true, FRONT, 0)], [country("France", 2, FRONT, 0.1)]);
    const out = selectLabels(input(set, { Paris: [100, 100], France: [100, 104] }, { d: 2 }));
    expect(out.map((p) => set.items[p.id]!.name)).toEqual(["France"]);
  });
});

describe("labelBox", () => {
  it("ville : à droite du point ; pays : centré", () => {
    const set = buildLabelSet([city("Paris", 1, true)], [country("France", 1)]);
    const c = labelBox(set.items[1]!, 100, 100, false);
    expect(c.x0).toBeLessThan(100);
    expect(c.x1).toBeGreaterThan(130);
    const p = labelBox(set.items[0]!, 100, 100, false);
    expect((p.x0 + p.x1) / 2).toBeCloseTo(100, 6);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd web && npx vitest run tests/labels-select.test.ts` → FAIL, module introuvable.

- [ ] **Step 3: Implémenter**

`web/src/labels/select.ts` :

```ts
/**
 * Choix des étiquettes à afficher (spec repères §3) : éligibilité selon le zoom, horizon,
 * viewport, anti-chevauchement glouton par priorité, plafond, stabilité. Logique pure :
 * la projection est injectée, aucune mesure DOM (boîtes estimées).
 */
import type { Tier } from "../gpu/tier";
import type { LabelItem, LabelSet } from "./data";

/** Du plus loin au plus près ; le premier palier dont `d ≥ minD` s'applique. Les capitales passent toujours. */
export const CITY_TIERS: readonly { minD: number; minPop: number }[] = [
  { minD: 2.5, minPop: 5_000_000 },
  { minD: 1.6, minPop: 1_000_000 },
  { minD: 1.25, minPop: 100_000 },
  { minD: 0, minPop: 0 },
];
/** Mêmes bornes que CITY_TIERS ; `maxRank` −1 = aucun pays (de près, les villes prennent la place). */
export const COUNTRY_TIERS: readonly { minD: number; maxRank: number }[] = [
  { minD: 2.5, maxRank: 3 },
  { minD: 1.6, maxRank: 5 },
  { minD: 1.25, maxRank: Number.POSITIVE_INFINITY },
  { minD: 0, maxRank: -1 },
];
export const LABEL_CAP: Record<Tier, number> = { high: 60, low: 30 };
export const NARROW_PX = 600;

/** Largeur moyenne d'un caractère (px CSS) à la taille de `.label`, et géométrie des boîtes. */
const CHAR_W = 6.5;
const COUNTRY_CHAR_W = 9; // capitales espacées
const VALUE_CHARS = 9;    // « 1013 hPa », « 120 µg/m³ »
const LINE_H = 15;
const PAD = 4;
const DOT = 8;            // point de la ville + écart avant le nom

export function tierIndex(d: number): number {
  const i = CITY_TIERS.findIndex((t) => d >= t.minD);
  return i === -1 ? CITY_TIERS.length - 1 : i;
}

export function labelCap(tier: Tier, viewportWidth: number): number {
  const cap = LABEL_CAP[tier];
  return viewportWidth < NARROW_PX ? Math.floor(cap / 2) : cap;
}

export function eligible(item: LabelItem, d: number): boolean {
  const t = tierIndex(d);
  if (item.kind === "country") return item.rank <= COUNTRY_TIERS[t]!.maxRank;
  return item.capital || item.pop >= CITY_TIERS[t]!.minPop;
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

/** Boîte estimée autour du point écran (x, y). Ville : point puis texte à droite ; pays : texte centré. */
export function labelBox(item: LabelItem, x: number, y: number, hasValue: boolean): Box {
  if (item.kind === "country") {
    const w = item.name.length * COUNTRY_CHAR_W + 2 * PAD;
    return { x0: x - w / 2, y0: y - LINE_H / 2 - PAD, x1: x + w / 2, y1: y + LINE_H / 2 + PAD };
  }
  const chars = Math.max(item.name.length, hasValue ? VALUE_CHARS : 0);
  return { x0: x - DOT / 2 - PAD, y0: y - LINE_H / 2 - PAD, x1: x + DOT + chars * CHAR_W + PAD, y1: y + LINE_H / 2 + (hasValue ? LINE_H : 0) + PAD };
}

export interface Placed { id: number; x: number; y: number }

export interface SelectInput {
  set: LabelSet;
  /** Distance caméra–centre. */
  d: number;
  /** Direction unité du centre vers la caméra. */
  camDir: { x: number; y: number; z: number };
  /** Écrit la position écran (px CSS) de l'item ; `false` s'il est hors viewport. */
  project(id: number, out: { x: number; y: number }): boolean;
  cap: number;
  /** Une valeur de couche s'affiche sous le nom des villes. */
  hasValue: boolean;
  /** Ids déjà affichés : placés d'abord (pas de clignotement en rotation). À vider par l'appelant à chaque changement de palier. */
  shown: ReadonlySet<number>;
}

export function selectLabels(input: SelectInput): Placed[] {
  const { set, d, camDir, cap, hasValue, shown } = input;
  const horizon = 1 / d; // point à rayon 1 (spec tuiles §5)
  const placed: Placed[] = [];
  const boxes: Box[] = [];
  const at = { x: 0, y: 0 };
  const tryPlace = (item: LabelItem): void => {
    const o = item.id * 3;
    if (set.unit[o]! * camDir.x + set.unit[o + 1]! * camDir.y + set.unit[o + 2]! * camDir.z <= horizon) return;
    if (!eligible(item, d)) return;
    if (!input.project(item.id, at)) return;
    const box = labelBox(item, at.x, at.y, hasValue);
    for (const b of boxes) {
      if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) return;
    }
    boxes.push(box);
    placed.push({ id: item.id, x: at.x, y: at.y });
  };
  for (const item of set.items) {
    if (placed.length >= cap) return placed;
    if (shown.has(item.id)) tryPlace(item);
  }
  for (const item of set.items) {
    if (placed.length >= cap) return placed;
    if (!shown.has(item.id)) tryPlace(item);
  }
  return placed;
}
```

- [ ] **Step 4: Vérifier le succès**

Run: `cd web && npx vitest run tests/labels-select.test.ts && npx tsc --noEmit -p .` → PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/labels/select.ts web/tests/labels-select.test.ts
git commit -m "feat(labels): sélection pure (zoom, horizon, anti-chevauchement, plafond, stabilité)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 6: Texte de valeur, couche DOM et styles

**Files:**
- Create: `web/src/labels/text.ts`, `web/src/labels/layer.ts`
- Modify: `web/src/style.css`, `web/index.html`
- Test: `web/tests/labels-text.test.ts`

**Interfaces:**
- Consumes: `TooltipData` de `web/src/ui/tooltip.ts` (`{ def: LayerDef; pixels: Uint8ClampedArray; grid; encoding }`), `sampleValue(pixels, grid, encoding, lon, lat)` de `web/src/data/sampling.ts`.
- Produces: `labelValue(data: TooltipData | null, lon: number, lat: number): string | null` ; `LabelView = { id: number; kind: "city" | "country"; name: string; value: string | null; x: number; y: number }` ; `createLabelsLayer(container: HTMLElement): LabelsLayer` avec `LabelsLayer = { render(views: LabelView[]): void; clear(): void }`.

- [ ] **Step 1: Écrire le test qui échoue**

`web/tests/labels-text.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { layerDef } from "../src/layers/registry";
import { labelValue } from "../src/labels/text";
import type { TooltipData } from "../src/ui/tooltip";

/** Champ 2×2 uniforme à l'octet `byte` (RGBA, seul R compte). */
function data(id: string, byte: number, min: number, max: number): TooltipData {
  const pixels = new Uint8ClampedArray(2 * 2 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels[i] = byte;
  return { def: layerDef(id)!, pixels, grid: { width: 2, height: 2 }, encoding: { bits: 8, min, max, scale: "linear" } };
}

describe("labelValue — valeur sous le nom d'une ville (spec repères §4)", () => {
  it("formate avec le format de la couche", () => {
    expect(labelValue(data("temp", 255, -50, 50), 2.35, 48.86)).toBe("50,0 °C");
    expect(labelValue(data("clouds", 0, 0, 100), 2.35, 48.86)).toBe("0 %");
  });
  it("nom seul : aucune couche", () => {
    expect(labelValue(null, 2.35, 48.86)).toBeNull();
  });
  it("nom seul : sous tooltipMin (pas de pluie)", () => {
    expect(labelValue(data("rain", 0, 0, 50), 2.35, 48.86)).toBeNull();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd web && npx vitest run tests/labels-text.test.ts` → FAIL, module introuvable.

- [ ] **Step 3: Implémenter**

`web/src/labels/text.ts` :

```ts
/** Valeur affichée sous le nom d'une ville (spec repères §4) : même lecture que le tooltip, sur les pixels bruts. */
import { sampleValue } from "../data/sampling";
import type { TooltipData } from "../ui/tooltip";

/** `null` = nom seul : aucune couche lisible, valeur non finie, ou sous `tooltipMin` (« pas de pluie »). */
export function labelValue(data: TooltipData | null, lon: number, lat: number): string | null {
  if (!data) return null;
  const v = sampleValue(data.pixels, data.grid, data.encoding, lon, lat);
  if (!Number.isFinite(v)) return null;
  if (data.def.tooltipMin !== null && v < data.def.tooltipMin) return null;
  return data.def.format(v);
}
```

`web/src/labels/layer.ts` :

```ts
/**
 * Étiquettes en DOM (spec repères §4) : un `div` par étiquette, réutilisé d'une sélection à
 * l'autre, positionné par `transform`. Aucune logique de choix ici — voir labels/select.ts.
 * Pas de test (Vitest tourne sans DOM) : validé à l'œil.
 */
export interface LabelView {
  id: number;
  kind: "city" | "country";
  name: string;
  value: string | null;
  x: number;
  y: number;
}

export interface LabelsLayer {
  /** Affiche exactement `views` : crée, met à jour, fait disparaître le reste en fondu. */
  render(views: LabelView[]): void;
  clear(): void;
}

const FADE_MS = 150;

interface Entry { el: HTMLDivElement; name: HTMLSpanElement; value: HTMLSpanElement; text: string }

export function createLabelsLayer(container: HTMLElement): LabelsLayer {
  const live = new Map<number, Entry>();
  const pool: Entry[] = [];

  const make = (): Entry => {
    const el = document.createElement("div");
    const name = document.createElement("span");
    const value = document.createElement("span");
    name.className = "name";
    value.className = "value";
    el.append(name, value);
    container.append(el);
    return { el, name, value, text: "" };
  };

  const retire = (e: Entry): void => {
    e.el.classList.remove("on");
    setTimeout(() => {
      if (!e.el.classList.contains("on")) pool.push(e);
    }, FADE_MS + 50);
  };

  return {
    render(views) {
      const keep = new Set<number>();
      for (const v of views) {
        keep.add(v.id);
        let e = live.get(v.id);
        if (!e) {
          e = pool.pop() ?? make();
          e.el.className = `label ${v.kind}`;
          e.name.textContent = v.name;
          e.text = "";
          live.set(v.id, e);
          const el = e.el;
          requestAnimationFrame(() => el.classList.add("on")); // frame suivante : la transition d'opacité joue
        }
        const text = v.value ?? "";
        if (e.text !== text) {
          e.text = text;
          e.value.textContent = text;
        }
        e.el.style.transform = `translate3d(${Math.round(v.x)}px, ${Math.round(v.y)}px, 0)`;
      }
      for (const [id, e] of live) {
        if (keep.has(id)) continue;
        live.delete(id);
        retire(e);
      }
    },
    clear() {
      for (const e of live.values()) retire(e);
      live.clear();
    },
  };
}
```

`web/index.html` — ajouter le conteneur **entre** le `<canvas id="globe">` et `<div id="overlay">` (les panneaux restent au-dessus) :

```html
    <div id="labels" aria-hidden="true"></div>
```

`web/src/style.css` — ajouter après les règles de `#attribution` :

```css
/* Étiquettes villes/pays (spec repères §4) : décoratives, ne captent jamais le pointeur. */
#labels { position: fixed; inset: 0; overflow: hidden; pointer-events: none; }
.label {
  position: absolute; left: 0; top: 0; opacity: 0; transition: opacity 150ms linear;
  font-size: 0.72rem; line-height: 15px; color: #fff; white-space: nowrap; will-change: transform;
  text-shadow: 0 0 3px #000, 0 0 3px #000, 0 1px 2px #000;
}
.label.on { opacity: 1; }
.label .name, .label .value { display: block; }
.label .value { font-weight: 700; }
.label .value:empty { display: none; }
.label.city { margin: -7.5px 0 0 8px; }            /* le nom démarre à droite du point, centré verticalement sur lui */
.label.city::before {
  content: ""; position: absolute; left: -11px; top: 4.5px; width: 6px; height: 6px;
  border-radius: 50%; background: #fff; box-shadow: 0 0 2px 1px #000;
}
.label.country {
  font-size: 0.8rem; letter-spacing: 0.12em; text-transform: uppercase; color: #f4f4f4;
  margin-top: -7.5px;
}
.label.country .name { transform: translateX(-50%); } /* centré sur le point d'étiquette */
@media (prefers-reduced-motion: reduce) { .label { transition: none; } }
```

`style.css` n'utilise aucun `z-index` : l'empilement suit l'ordre du DOM. `#labels` étant inséré avant `#overlay`, `#tooltip` et `#marker`, il reste sous eux ; ne pas ajouter de `z-index`.

- [ ] **Step 4: Vérifier le succès**

Run: `cd web && npx vitest run && npx tsc --noEmit -p .` → tout passe (3 tests de plus).

- [ ] **Step 5: Commit**

```bash
git add web/src/labels/text.ts web/src/labels/layer.ts web/tests/labels-text.test.ts web/src/style.css web/index.html
git commit -m "feat(labels): texte de valeur, couche DOM et styles" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 7: `labels/controller.ts` — cadence, stabilité, valeurs

**Files:**
- Create: `web/src/labels/controller.ts`
- Test: `web/tests/labels-controller.test.ts`

**Interfaces:**
- Consumes: `LabelSet` (T4) ; `selectLabels`, `tierIndex`, `labelCap`, `Placed` (T5) ; `labelValue`, `LabelView`, `LabelsLayer` (T6) ; `projectToScreen(p, camera, width, height): { x, y, visible }` de `web/src/render/pick.ts` ; `TooltipData`.
- Produces:

```ts
export const SELECT_INTERVAL_MS = 100
export interface LabelsControllerDeps {
  layer: Pick<LabelsLayer, "render" | "clear">;
  camera: THREE.PerspectiveCamera;
  size(): { width: number; height: number };   // px CSS du canvas
  tier: Tier;
  now?: () => number;                                           // défaut performance.now
  defer?: (cb: () => void, ms: number) => unknown;              // défaut setTimeout
}
export class LabelsController {
  constructor(deps: LabelsControllerDeps)
  setData(set: LabelSet | null): void
  setValueSource(data: TooltipData | null): void
  setEnabled(on: boolean): void
  onView(): void          // à brancher sur SceneHandle.onViewChange : appelé avant chaque rendu
}
```

- [ ] **Step 1: Écrire les tests qui échouent**

`web/tests/labels-controller.test.ts` :

```ts
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { LabelsController, SELECT_INTERVAL_MS } from "../src/labels/controller";
import { buildLabelSet } from "../src/labels/data";
import type { LabelView } from "../src/labels/layer";
import { layerDef } from "../src/layers/registry";
import { lonLatToVec3 } from "../src/tiles/patch";
import type { TooltipData } from "../src/ui/tooltip";

function rig(d = 1.3) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10);
  const look = (lon: number, lat: number, dist: number) => {
    camera.position.copy(lonLatToVec3(lon, lat).multiplyScalar(dist));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
  };
  look(2, 47, d);
  const frames: LabelView[][] = [];
  let t = 0;
  const deferred: (() => void)[] = [];
  const ctl = new LabelsController({
    layer: { render: (v) => void frames.push(v.map((x) => ({ ...x }))), clear: () => void frames.push([]) },
    camera, size: () => ({ width: 800, height: 800 }), tier: "high",
    now: () => t, defer: (cb) => void deferred.push(cb),
  });
  return { ctl, camera, look, frames, deferred, advance: (ms: number) => { t += ms; }, last: () => frames[frames.length - 1]! };
}

const SET = buildLabelSet(
  [{ lon: 2.35, lat: 48.86, name: "Paris", pop: 11e6, capital: true }, { lon: 4.84, lat: 45.77, name: "Lyon", pop: 1.7e6, capital: false },
   { lon: 139.69, lat: 35.69, name: "Tokyo", pop: 37e6, capital: true }],
  [],
);

function temp(byte: number): TooltipData {
  const pixels = new Uint8ClampedArray(2 * 2 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels[i] = byte;
  return { def: layerDef("temp")!, pixels, grid: { width: 2, height: 2 }, encoding: { bits: 8, min: -50, max: 50, scale: "linear" } };
}

describe("LabelsController (spec repères §4)", () => {
  it("rien tant qu'il est éteint ou sans données", () => {
    const r = rig();
    r.ctl.onView();
    r.ctl.setData(SET);
    r.ctl.onView();
    expect(r.frames).toEqual([]);
  });
  it("allumé : affiche les villes visibles, pas celles de l'autre face", () => {
    const r = rig();
    r.ctl.setData(SET);
    r.ctl.setEnabled(true);
    expect(r.last().map((v) => v.name).sort()).toEqual(["Lyon", "Paris"]);
    expect(r.last().every((v) => v.value === null)).toBe(true);
    const paris = r.last().find((v) => v.name === "Paris")!;
    expect(paris.x).toBeGreaterThan(0);
    expect(paris.x).toBeLessThan(800);
  });
  it("valeur de la couche active, retirée quand la couche part", () => {
    const r = rig();
    r.ctl.setData(SET);
    r.ctl.setEnabled(true);
    r.ctl.setValueSource(temp(255));
    expect(r.last().find((v) => v.name === "Paris")!.value).toBe("50,0 °C");
    r.ctl.setValueSource(null);
    expect(r.last().find((v) => v.name === "Paris")!.value).toBeNull();
  });
  it("caméra en mouvement : repositionne à chaque vue, ne re-sélectionne qu'après 100 ms", () => {
    const r = rig();
    r.ctl.setData(SET);
    r.ctl.setEnabled(true);
    const x0 = r.last().find((v) => v.name === "Paris")!.x;
    r.look(40, 47, 1.3); // Paris sort de l'écran par la gauche ; re-sélection pas encore due
    r.advance(10);
    r.ctl.onView();
    const moved = r.last().find((v) => v.name === "Paris");
    expect(moved === undefined || moved.x !== x0).toBe(true);
    r.look(139, 36, 1.3);
    r.advance(SELECT_INTERVAL_MS);
    r.ctl.onView();
    expect(r.last().map((v) => v.name)).toEqual(["Tokyo"]);
  });
  it("sélection de rattrapage après l'arrêt de la caméra, sans nouvelle vue", () => {
    const r = rig();
    r.ctl.setData(SET);
    r.ctl.setEnabled(true);
    r.look(139, 36, 1.3);
    r.advance(10);
    r.ctl.onView();            // trop tôt pour re-sélectionner : un rattrapage est programmé
    expect(r.deferred.length).toBe(1);
    r.advance(SELECT_INTERVAL_MS);
    r.deferred[0]!();
    expect(r.last().map((v) => v.name)).toEqual(["Tokyo"]);
  });
  it("éteint : vide la couche", () => {
    const r = rig();
    r.ctl.setData(SET);
    r.ctl.setEnabled(true);
    r.ctl.setEnabled(false);
    expect(r.last()).toEqual([]);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd web && npx vitest run tests/labels-controller.test.ts` → FAIL, module introuvable.

- [ ] **Step 3: Implémenter**

`web/src/labels/controller.ts` :

```ts
/**
 * Cadence des étiquettes (spec repères §4) : la sélection est recalculée au plus toutes les
 * SELECT_INTERVAL_MS quand la caméra a bougé ; entre deux sélections les étiquettes placées
 * sont seulement reprojetées. Ne demande jamais de rendu WebGL : le DOM vit à côté du canvas.
 */
import * as THREE from "three";
import type { Tier } from "../gpu/tier";
import { projectToScreen } from "../render/pick";
import type { TooltipData } from "../ui/tooltip";
import type { LabelSet } from "./data";
import type { LabelView, LabelsLayer } from "./layer";
import { labelCap, selectLabels, tierIndex, type Placed } from "./select";
import { labelValue } from "./text";

export const SELECT_INTERVAL_MS = 100;

export interface LabelsControllerDeps {
  layer: Pick<LabelsLayer, "render" | "clear">;
  camera: THREE.PerspectiveCamera;
  /** Taille CSS du canvas. */
  size(): { width: number; height: number };
  tier: Tier;
  now?: () => number;
  defer?: (cb: () => void, ms: number) => unknown;
}

const p = new THREE.Vector3();

export class LabelsController {
  private set: LabelSet | null = null;
  private source: TooltipData | null = null;
  private enabled = false;
  private placed: Placed[] = [];
  private readonly values = new Map<number, string | null>();
  private lastSelect = Number.NEGATIVE_INFINITY;
  private lastTier = -1;
  private pending = false;
  private readonly lastPos = new THREE.Vector3(Number.NaN, 0, 0);
  private readonly now: () => number;
  private readonly defer: (cb: () => void, ms: number) => unknown;

  constructor(private readonly deps: LabelsControllerDeps) {
    this.now = deps.now ?? (() => performance.now());
    this.defer = deps.defer ?? ((cb, ms) => setTimeout(cb, ms));
  }

  setData(set: LabelSet | null): void {
    this.set = set;
    this.placed = [];
    this.values.clear();
    if (this.enabled) this.refresh();
  }

  setValueSource(data: TooltipData | null): void {
    this.source = data;
    this.values.clear();
    if (this.enabled) this.refresh();
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (on) this.refresh();
    else {
      this.placed = [];
      this.deps.layer.clear();
    }
  }

  /** Avant chaque rendu WebGL (`SceneHandle.onViewChange`). */
  onView(): void {
    if (!this.enabled || !this.set) return;
    const moved = !this.lastPos.equals(this.deps.camera.position);
    if (moved && this.now() - this.lastSelect >= SELECT_INTERVAL_MS) {
      this.refresh();
      return;
    }
    if (moved) this.scheduleCatchUp();
    this.paint();
  }

  /** La caméra peut s'arrêter entre deux sélections, et plus aucune vue n'arrive (rendu à la demande). */
  private scheduleCatchUp(): void {
    if (this.pending) return;
    this.pending = true;
    this.defer(() => {
      this.pending = false;
      if (this.enabled && this.set && !this.lastPos.equals(this.deps.camera.position)) this.refresh();
    }, SELECT_INTERVAL_MS);
  }

  private refresh(): void {
    const set = this.set;
    if (!set) return;
    const { camera } = this.deps;
    const { width, height } = this.deps.size();
    const d = camera.position.length();
    const tier = tierIndex(d);
    // Changement de palier : on repart de l'ordre de priorité strict (spec §3).
    const shown = tier === this.lastTier ? new Set(this.placed.map((x) => x.id)) : new Set<number>();
    this.lastTier = tier;
    this.placed = selectLabels({
      set, d, camDir: { x: camera.position.x / d, y: camera.position.y / d, z: camera.position.z / d },
      project: (id, out) => {
        const s = projectToScreen(p.fromArray(set.unit, id * 3), camera, width, height);
        out.x = s.x;
        out.y = s.y;
        return s.visible;
      },
      cap: labelCap(this.deps.tier, width), hasValue: this.source !== null, shown,
    });
    this.lastSelect = this.now();
    this.lastPos.copy(camera.position);
    this.paint();
  }

  /** Reprojette les étiquettes placées ; celles qui passent l'horizon ou le bord disparaissent d'ici la prochaine sélection. */
  private paint(): void {
    const set = this.set;
    if (!set) return;
    const { camera } = this.deps;
    const { width, height } = this.deps.size();
    const views: LabelView[] = [];
    for (const pl of this.placed) {
      const s = projectToScreen(p.fromArray(set.unit, pl.id * 3), camera, width, height);
      if (!s.visible) continue;
      const item = set.items[pl.id]!;
      let value: string | null = null;
      if (item.kind === "city") {
        if (!this.values.has(item.id)) this.values.set(item.id, labelValue(this.source, item.lon, item.lat));
        value = this.values.get(item.id) ?? null;
      }
      views.push({ id: item.id, kind: item.kind, name: item.name, value, x: s.x, y: s.y });
    }
    this.deps.layer.render(views);
  }
}
```

- [ ] **Step 4: Vérifier le succès**

Run: `cd web && npx vitest run tests/labels-controller.test.ts && npx tsc --noEmit -p .` → PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/labels/controller.ts web/tests/labels-controller.test.ts
git commit -m "feat(labels): contrôleur (cadence 100 ms, rattrapage, valeurs en cache)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 8: `rivers/data.ts` — parseur de `rivers.bin`

**Files:**
- Create: `web/src/rivers/data.ts`, `web/tests/rivers-fixture.ts`
- Test: `web/tests/rivers-data.test.ts`

**Interfaces:**
- Consumes: format `rivers.bin` (T1), `lonLatToVec3`.
- Produces:

```ts
export class RiversError extends Error {}
export const RIVER_RADIUS = 1.001
export const MAX_SEGMENT_DEG = 2
export interface RiverSegments {
  count: number;
  starts: Float32Array;   // xyz par segment, rayon RIVER_RADIUS
  ends: Float32Array;
  ranks: Float32Array;    // un rang par segment, croissant
  countByRank: Uint32Array; // countByRank[r] = nombre de segments de rang ≤ r ; longueur = rang max + 1
}
export function parseRivers(buffer: ArrayBuffer): RiverSegments
```

- [ ] **Step 1: Écrire les tests qui échouent**

`web/tests/rivers-fixture.ts` (helper partagé avec `geo-loader.test.ts` ; hors d'un `*.test.ts`, sinon ses `describe` seraient rejoués par l'importeur) :

```ts
/** Encode comme tools/build_geo.py::encode_rivers. */
export function encodeRivers(lines: [number, [number, number][]][], magic = "WTRV", version = 1): ArrayBuffer {
  const size = 10 + lines.reduce((s, [, pts]) => s + 4 + pts.length * 4, 0);
  const view = new DataView(new ArrayBuffer(size));
  for (let i = 0; i < 4; i++) view.setUint8(i, magic.charCodeAt(i));
  view.setUint16(4, version, true);
  view.setUint32(6, lines.length, true);
  let o = 10;
  for (const [rank, pts] of lines) {
    view.setUint8(o, rank);
    view.setUint8(o + 1, 0);
    view.setUint16(o + 2, pts.length, true);
    o += 4;
    for (const [lon, lat] of pts) {
      view.setInt16(o, lon, true);
      view.setInt16(o + 2, lat, true);
      o += 4;
    }
  }
  return view.buffer;
}
```

`web/tests/rivers-data.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { MAX_SEGMENT_DEG, RIVER_RADIUS, RiversError, parseRivers } from "../src/rivers/data";
import { encodeRivers } from "./rivers-fixture";

const len = (a: Float32Array, i: number) => Math.hypot(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!);
const angleDeg = (s: Float32Array, e: Float32Array, i: number) => {
  const dot = (s[i * 3]! * e[i * 3]! + s[i * 3 + 1]! * e[i * 3 + 1]! + s[i * 3 + 2]! * e[i * 3 + 2]!) / (RIVER_RADIUS * RIVER_RADIUS);
  return (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
};

describe("parseRivers — spec repères §5", () => {
  it("segments au rayon 1,001, un par paire de points consécutifs", () => {
    const r = parseRivers(encodeRivers([[1, [[0, 0], [100, 0], [100, 100]]]]));
    expect(r.count).toBe(2);
    expect(len(r.starts, 0)).toBeCloseTo(RIVER_RADIUS, 6);
    expect(len(r.ends, 1)).toBeCloseTo(RIVER_RADIUS, 6);
    expect([r.ends[0], r.ends[1], r.ends[2]]).toEqual([r.starts[3], r.starts[4], r.starts[5]]);
    expect([...r.ranks]).toEqual([1, 1]);
  });
  it("subdivise au-delà de 2° : 5° → 3 segments contigus de moins de 2°", () => {
    const r = parseRivers(encodeRivers([[2, [[0, 0], [500, 0]]]]));
    expect(r.count).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(angleDeg(r.starts, r.ends, i)).toBeLessThanOrEqual(MAX_SEGMENT_DEG + 1e-6);
      expect(len(r.ends, i)).toBeCloseTo(RIVER_RADIUS, 6);
    }
    expect(r.ends[3]).toBeCloseTo(r.starts[6]!, 6);
  });
  it("countByRank cumule par rang, y compris les rangs sans segment", () => {
    const r = parseRivers(encodeRivers([[1, [[0, 0], [100, 0]]], [1, [[0, 0], [0, 100]]], [4, [[0, 0], [100, 100], [200, 100]]]]));
    expect([...r.countByRank]).toEqual([0, 2, 2, 2, 4]);
  });
  it("traverse l'antiméridien sans segment géant", () => {
    const r = parseRivers(encodeRivers([[1, [[17990, 0], [-17990, 0]]]]));
    expect(r.count).toBe(1);
    expect(angleDeg(r.starts, r.ends, 0)).toBeCloseTo(0.2, 3);
  });
  it.each([
    ["magic", encodeRivers([], "XXXX")],
    ["version", encodeRivers([], "WTRV", 2)],
    ["tampon tronqué", encodeRivers([[1, [[0, 0], [100, 0]]]]).slice(0, 16)],
    ["trop court pour un en-tête", new ArrayBuffer(6)],
    ["longitude hors bornes", encodeRivers([[1, [[18001, 0], [0, 0]]]])],
    ["latitude hors bornes", encodeRivers([[1, [[0, 9001], [0, 0]]]])],
    ["ligne d'un seul point", encodeRivers([[1, [[0, 0]]]])],
    ["rangs non triés", encodeRivers([[3, [[0, 0], [100, 0]]], [1, [[0, 0], [0, 100]]]])],
  ])("refuse : %s", (_label, buf) => {
    expect(() => parseRivers(buf)).toThrowError(RiversError);
  });
  it("octets en trop après la dernière ligne : refusé", () => {
    const ok = new Uint8Array(encodeRivers([[1, [[0, 0], [100, 0]]]]));
    const padded = new Uint8Array(ok.length + 2);
    padded.set(ok);
    expect(() => parseRivers(padded.buffer)).toThrowError(RiversError);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd web && npx vitest run tests/rivers-data.test.ts` → FAIL, module introuvable.

- [ ] **Step 3: Implémenter**

`web/src/rivers/data.ts` :

```ts
/**
 * `geo/rivers.bin` → segments 3D (spec repères §5). Little-endian : « WTRV », u16 version, u32
 * lignes ; par ligne u8 rang, u8 réservé, u16 n, n × (i16 lon, i16 lat) en centièmes de degré,
 * lignes triées par rang croissant. Logique pure. Miroir : tools/build_geo.py.
 */
import * as THREE from "three";
import { lonLatToVec3 } from "../tiles/patch";

export class RiversError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RiversError";
  }
}

/** Sous les traînées de vent (1,002), au-dessus de la surface. */
export const RIVER_RADIUS = 1.001;
/** Au-delà, la corde passerait sous la surface : on subdivise le long du grand cercle. */
export const MAX_SEGMENT_DEG = 2;

export interface RiverSegments {
  count: number;
  starts: Float32Array;
  ends: Float32Array;
  ranks: Float32Array;
  /** `countByRank[r]` = nombre de segments de rang ≤ r (préfixe, grâce au tri). */
  countByRank: Uint32Array;
}

const HEADER = 10;
const MAX_STEP = (MAX_SEGMENT_DEG * Math.PI) / 180;

export function parseRivers(buffer: ArrayBuffer): RiverSegments {
  if (buffer.byteLength < HEADER) throw new RiversError("en-tête tronqué");
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "WTRV") throw new RiversError("magic WTRV attendu");
  if (view.getUint16(4, true) !== 1) throw new RiversError(`version ${view.getUint16(4, true)} inconnue`);
  const lines = view.getUint32(6, true);

  const starts: number[] = [];
  const ends: number[] = [];
  const ranks: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  let o = HEADER;
  let lastRank = 0;
  for (let l = 0; l < lines; l++) {
    if (o + 4 > buffer.byteLength) throw new RiversError("ligne tronquée");
    const rank = view.getUint8(o);
    const n = view.getUint16(o + 2, true);
    o += 4;
    if (n < 2) throw new RiversError("ligne de moins de deux points");
    if (rank < lastRank) throw new RiversError("lignes non triées par rang");
    lastRank = rank;
    if (o + n * 4 > buffer.byteLength) throw new RiversError("points tronqués");
    for (let i = 0; i < n; i++, o += 4) {
      const lon = view.getInt16(o, true);
      const lat = view.getInt16(o + 2, true);
      if (Math.abs(lon) > 18000 || Math.abs(lat) > 9000) throw new RiversError("coordonnée hors bornes");
      lonLatToVec3(lon / 100, lat / 100, b);
      if (i > 0) {
        const angle = a.angleTo(b);
        const pieces = Math.max(1, Math.ceil(angle / MAX_STEP - 1e-9));
        from.copy(a);
        for (let k = 1; k <= pieces; k++) {
          // interpolation sphérique : les points intermédiaires restent sur le grand cercle
          if (k === pieces) to.copy(b);
          else {
            const t = k / pieces;
            const s = Math.sin(angle);
            to.copy(a).multiplyScalar(Math.sin((1 - t) * angle) / s).addScaledVector(b, Math.sin(t * angle) / s);
          }
          starts.push(from.x * RIVER_RADIUS, from.y * RIVER_RADIUS, from.z * RIVER_RADIUS);
          ends.push(to.x * RIVER_RADIUS, to.y * RIVER_RADIUS, to.z * RIVER_RADIUS);
          ranks.push(rank);
          from.copy(to);
        }
      }
      a.copy(b);
    }
  }
  if (o !== buffer.byteLength) throw new RiversError("octets en trop");

  const countByRank = new Uint32Array(lastRank + 1);
  for (const r of ranks) countByRank[r] = countByRank[r]! + 1;
  for (let r = 1; r < countByRank.length; r++) countByRank[r] = countByRank[r]! + countByRank[r - 1]!;
  return { count: ranks.length, starts: new Float32Array(starts), ends: new Float32Array(ends), ranks: new Float32Array(ranks), countByRank };
}
```

- [ ] **Step 4: Vérifier le succès**

Run: `cd web && npx vitest run tests/rivers-data.test.ts && npx tsc --noEmit -p .` → PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/rivers/data.ts web/tests/rivers-data.test.ts web/tests/rivers-fixture.ts
git commit -m "feat(rivers): parseur rivers.bin -> segments 3D subdivisés, cumul par rang" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 9: Fragment GLSL partagé et rendu des fleuves

**Files:**
- Create: `web/src/render/shaders/screen-quad.glsl`, `web/src/render/shaders/rivers.vert.glsl`, `web/src/render/shaders/rivers.frag.glsl`, `web/src/render/rivers.ts`
- Modify: `web/src/render/shaders/wind.vert.glsl`, `web/src/render/wind.ts`, `web/tests/wind-layer.test.ts`
- Test: `web/tests/rivers-layer.test.ts`

**Interfaces:**
- Consumes: `RiverSegments` (T8).
- Produces:

```ts
export const RIVER_WIDTH_PX = 1.5
export const RIVER_TIERS: readonly { d: number; rank: number }[]   // points de contrôle (d décroissant)
export function riverMaxRank(d: number, topRank: number): number     // flottant, interpolé linéairement en d
export interface RiversLayer { object: THREE.Mesh; setView(d: number, mapStyle: number): void; dispose(): void }
export function createRiversLayer(seg: RiverSegments): RiversLayer
```

Le vent passe à `renderOrder = 2` (les fleuves prennent 1).

- [ ] **Step 1: Écrire les tests qui échouent**

`web/tests/rivers-layer.test.ts` :

```ts
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RIVER_WIDTH_PX, createRiversLayer, riverMaxRank } from "../src/render/rivers";
import type { RiverSegments } from "../src/rivers/data";

/** 2 segments de rang 1, 3 de rang 4, 5 de rang 9. */
const SEG: RiverSegments = {
  count: 10,
  starts: new Float32Array(30),
  ends: new Float32Array(30),
  ranks: new Float32Array([1, 1, 4, 4, 4, 9, 9, 9, 9, 9]),
  countByRank: new Uint32Array([0, 2, 2, 2, 5, 5, 5, 5, 5, 10]),
};

describe("riverMaxRank — apparition selon le zoom (spec repères §5)", () => {
  it("3 de loin, 5 à d = 1,6, 7 à d = 1,25, tout au plus près, interpolé entre", () => {
    expect(riverMaxRank(4, 12)).toBe(3);
    expect(riverMaxRank(2.5, 12)).toBe(3);
    expect(riverMaxRank(1.6, 12)).toBe(5);
    expect(riverMaxRank(2.05, 12)).toBeCloseTo(4, 6);
    expect(riverMaxRank(1.25, 12)).toBe(7);
    expect(riverMaxRank(1.05, 12)).toBe(12);
  });
  it("jamais au-delà du rang maximal des données", () => {
    expect(riverMaxRank(1.25, 4)).toBe(4);
  });
});

describe("createRiversLayer", () => {
  const layer = createRiversLayer(SEG);
  const geometry = layer.object.geometry as THREE.InstancedBufferGeometry;
  const material = layer.object.material as THREE.ShaderMaterial;

  it("Mesh transparent sans écriture de profondeur, sous le vent, jamais cullé, caché au départ", () => {
    expect(layer.object).toBeInstanceOf(THREE.Mesh);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(layer.object.renderOrder).toBe(1);
    expect(layer.object.frustumCulled).toBe(false);
    expect(layer.object.visible).toBe(false);
  });
  it("tampons statiques, un par attribut d'instance", () => {
    for (const [name, size] of [["aStart", 3], ["aEnd", 3], ["aRank", 1]] as const) {
      const attr = geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      expect(attr).toBeInstanceOf(THREE.InstancedBufferAttribute);
      expect(attr.itemSize).toBe(size);
      expect(attr.count).toBe(10);
      expect(attr.usage).toBe(THREE.StaticDrawUsage);
    }
    expect((geometry.getAttribute("aStart") as THREE.InstancedBufferAttribute).array).toBe(SEG.starts);
  });
  it("setView : instanceCount = préfixe des rangs admis, uMaxRank flottant, uMapStyle", () => {
    layer.setView(4, 0);
    expect(geometry.instanceCount).toBe(2);           // rang ≤ 3
    expect(material.uniforms.uMaxRank!.value).toBe(3);
    layer.setView(2.05, 0.5);
    expect(material.uniforms.uMaxRank!.value).toBeCloseTo(4, 6);
    expect(geometry.instanceCount).toBe(5);           // rang ≤ 4
    expect(material.uniforms.uMapStyle!.value).toBe(0.5);
    layer.setView(1.05, 1);
    expect(geometry.instanceCount).toBe(10);
  });
  it("rang fractionnaire : le rang suivant est déjà dessiné, en fondu", () => {
    layer.setView(1.9, 0); // entre 3 (d = 2,5) et 5 (d = 1,6) : ≈ 4,33 → rang 5 admis pour le fondu
    expect(material.uniforms.uMaxRank!.value).toBeGreaterThan(4);
    expect(geometry.instanceCount).toBe(5);           // countByRank[5]
  });
  it("avant chaque rendu : viewport et largeur × pixel ratio", () => {
    const renderer = { getDrawingBufferSize: (v: THREE.Vector2) => v.set(1600, 1200), getPixelRatio: () => 2 } as unknown as THREE.WebGLRenderer;
    (layer.object.onBeforeRender as (r: THREE.WebGLRenderer) => void)(renderer);
    expect(material.uniforms.uViewport!.value).toEqual(new THREE.Vector2(1600, 1200));
    expect(RIVER_WIDTH_PX).toBe(1.5);
    expect(material.uniforms.uWidthPx!.value).toBe(3);
  });
  it("le vertex shader embarque le fragment partagé", () => {
    expect(material.vertexShader).toContain("vec4 screenQuad(");
    expect(material.vertexShader.indexOf("vec4 screenQuad(")).toBeLessThan(material.vertexShader.indexOf("void main()"));
  });
  it("données vides : rien à dessiner, pas d'exception", () => {
    const empty = createRiversLayer({ count: 0, starts: new Float32Array(0), ends: new Float32Array(0), ranks: new Float32Array(0), countByRank: new Uint32Array([0]) });
    empty.setView(2, 0);
    expect((empty.object.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
  });
});
```

Dans `web/tests/wind-layer.test.ts`, remplacer `expect(layer.object.renderOrder).toBe(1);` par `expect(layer.object.renderOrder).toBe(2); // au-dessus des fleuves (1)` et ajouter dans le même `describe` :

```ts
  it("le vertex shader embarque le fragment partagé d'élargissement", () => {
    expect(material.vertexShader).toContain("vec4 screenQuad(");
    expect(material.vertexShader.indexOf("vec4 screenQuad(")).toBeLessThan(material.vertexShader.indexOf("void main()"));
  });
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd web && npx vitest run tests/rivers-layer.test.ts tests/wind-layer.test.ts`
Expected: `rivers-layer` échoue (module introuvable) ; `wind-layer` échoue sur `renderOrder` (1 reçu) et sur `screenQuad`.

- [ ] **Step 3: Implémenter**

`web/src/render/shaders/screen-quad.glsl` :

```glsl
// Fragment partagé (vent, fleuves) : élargit le segment [c0, c1] (espace clip) en quad de
// demi-largeur halfPx (pixels du tampon de dessin). corner.x = 0 | 1 le long du segment,
// corner.y = −1 | +1 en travers. Segment nul → normale nulle → quad d'aire nulle.
vec4 screenQuad(vec4 c0, vec4 c1, vec2 corner, float halfPx, vec2 viewport) {
  vec2 halfVp = 0.5 * viewport;
  vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * halfVp;
  float len = length(d);
  vec2 n = len > 1e-3 ? vec2(-d.y, d.x) / len : vec2(0.0);
  vec4 c = mix(c0, c1, corner.x);
  c.xy += n * (corner.y * halfPx) / halfVp * c.w;
  return c;
}
```

`web/src/render/shaders/wind.vert.glsl` — remplacer tout le fichier par :

```glsl
// Traînées de vent (spec vent §8) : un quad par segment, élargi en pixels dans l'espace écran
// par screenQuad (shaders/screen-quad.glsl, préfixé par render/wind.ts).
// aStart / aEnd : extrémités déjà sur la sphère (rayon 1,002), lues dans le tampon de la simulation.
attribute vec3 aStart;
attribute vec3 aEnd;
uniform float uCount;      // N particules
uniform float uTrail;      // K slots
uniform vec2 uViewport;    // pixels du tampon de dessin
uniform float uWidthPx;    // largeur du trait, pixels du tampon
uniform float uPixelRatio;
varying float vAlpha;
varying float vDist;       // distance à l'axe du trait, pixels du tampon

void main() {
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
  // Demi-largeur du quad : trait + liseré (1 px CSS) + 1 px d'anti-crénelage.
  float halfQuad = 0.5 * uWidthPx + uPixelRatio + 1.0;
  gl_Position = screenQuad(c0, c1, position.xy, halfQuad, uViewport);
  vDist = position.y * halfQuad;
  // Instance j = k·N + i : alpha k/(K−1) au début du segment, (k+1)/(K−1) à la fin (0 en queue, 1 en tête).
  float k = floor((float(gl_InstanceID) + 0.5) / uCount);
  vAlpha = (k + position.x) / (uTrail - 1.0);
}
```

`web/src/render/wind.ts` — trois modifications : ajouter l'import `import screenQuad from "./shaders/screen-quad.glsl?raw";` sous les deux imports de shaders ; dans `new THREE.ShaderMaterial({ … })` remplacer `vertexShader,` par `vertexShader: `${screenQuad}\n${vertexShader}`,` ; remplacer `object.renderOrder = 1;` par `object.renderOrder = 2; // au-dessus des fleuves (render/rivers.ts, 1)`.

`web/src/render/shaders/rivers.vert.glsl` :

```glsl
// Fleuves (spec repères §5) : segments statiques au rayon 1,001, élargis par screenQuad
// (shaders/screen-quad.glsl, préfixé par render/rivers.ts).
attribute vec3 aStart;
attribute vec3 aEnd;
attribute float aRank;
uniform vec2 uViewport;   // pixels du tampon de dessin
uniform float uWidthPx;   // largeur du trait, pixels du tampon
uniform float uMaxRank;   // rang admis, flottant : le dernier rang entre en fondu
varying float vAlpha;
varying float vDist;

void main() {
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
  float halfQuad = 0.5 * uWidthPx + 1.0; // + 1 px d'anti-crénelage
  gl_Position = screenQuad(c0, c1, position.xy, halfQuad, uViewport);
  vDist = position.y * halfQuad;
  // Horizon exact pour un point à rayon R (même seuil que wind/sim.ts::isVisible) : sans lui, une
  // bande de surface juste derrière le limbe se dessinerait hors du disque du globe.
  float d = length(cameraPosition);
  float R = length(aStart);
  float thr = (1.0 + sqrt(max(0.0, d * d - 1.0) * max(0.0, R * R - 1.0))) / (d * R);
  float front = step(thr, dot(aStart, cameraPosition) / (d * R));
  vAlpha = front * clamp(uMaxRank - aRank + 1.0, 0.0, 1.0);
}
```

`web/src/render/shaders/rivers.frag.glsl` :

```glsl
// Bleu-cyan clair sur satellite, bleu soutenu en style carte (où l'eau est déjà bleu pâle) :
// distinct du blanc des frontières. Pas de colorspace_fragment : couleurs données en sRGB.
uniform float uMapStyle;
uniform float uWidthPx;
varying float vAlpha;
varying float vDist;

void main() {
  float w = 0.5 * uWidthPx;
  float core = 1.0 - smoothstep(w - 0.5, w + 0.5, abs(vDist));
  vec3 color = mix(vec3(0.55, 0.82, 1.0), vec3(0.25, 0.50, 0.85), uMapStyle);
  gl_FragColor = vec4(color, 0.8 * vAlpha * core);
}
```

`web/src/render/rivers.ts` :

```ts
/**
 * Rendu des fleuves (spec repères §5) : un quad instancié par segment, tampons statiques envoyés
 * une fois. Les segments sont triés par rang : `instanceCount` = préfixe des rangs admis au zoom
 * courant, le dernier rang entrant en fondu (uMaxRank flottant).
 */
import * as THREE from "three";
import type { RiverSegments } from "../rivers/data";
import fragmentShader from "./shaders/rivers.frag.glsl?raw";
import vertexShader from "./shaders/rivers.vert.glsl?raw";
import screenQuad from "./shaders/screen-quad.glsl?raw";

/** Largeur du trait en px CSS. */
export const RIVER_WIDTH_PX = 1.5;

/** Points de contrôle (d décroissant) du rang maximal admis ; interpolation linéaire entre eux. `rank: Infinity` = tous. */
export const RIVER_TIERS: readonly { d: number; rank: number }[] = [
  { d: 2.5, rank: 3 },
  { d: 1.6, rank: 5 },
  { d: 1.25, rank: 7 },
  { d: 1.05, rank: Number.POSITIVE_INFINITY },
];

export function riverMaxRank(d: number, topRank: number): number {
  const first = RIVER_TIERS[0]!;
  if (d >= first.d) return Math.min(first.rank, topRank);
  for (let i = 1; i < RIVER_TIERS.length; i++) {
    const hi = RIVER_TIERS[i - 1]!;
    const lo = RIVER_TIERS[i]!;
    if (d >= lo.d) {
      const loRank = Math.min(lo.rank, topRank);
      const hiRank = Math.min(hi.rank, topRank);
      return hiRank + ((hi.d - d) / (hi.d - lo.d)) * (loRank - hiRank);
    }
  }
  return topRank;
}

export interface RiversLayer {
  object: THREE.Mesh;
  /** `d` = distance caméra–centre ; `mapStyle` = même valeur que le globe (0 satellite, 1 carte). */
  setView(d: number, mapStyle: number): void;
  dispose(): void;
}

export function createRiversLayer(seg: RiverSegments): RiversLayer {
  const geometry = new THREE.InstancedBufferGeometry();
  // Coin du quad : x = 0 (début) ou 1 (fin) le long du segment, y = −1 / +1 en travers.
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]), 3));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  geometry.setAttribute("aStart", new THREE.InstancedBufferAttribute(seg.starts, 3));
  geometry.setAttribute("aEnd", new THREE.InstancedBufferAttribute(seg.ends, 3));
  geometry.setAttribute("aRank", new THREE.InstancedBufferAttribute(seg.ranks, 1));
  geometry.instanceCount = 0;
  const topRank = seg.countByRank.length - 1;
  const uniforms = {
    uMapStyle: { value: 0 },
    uMaxRank: { value: 0 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uWidthPx: { value: RIVER_WIDTH_PX },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: `${screenQuad}\n${vertexShader}`, fragmentShader,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
  });
  const object = new THREE.Mesh(geometry, material);
  object.frustumCulled = false;
  object.matrixAutoUpdate = false;
  object.renderOrder = 1; // au-dessus du globe, sous le vent (2)
  object.visible = false;
  object.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(uniforms.uViewport.value);
    uniforms.uWidthPx.value = RIVER_WIDTH_PX * renderer.getPixelRatio();
  };
  return {
    object,
    setView(d, mapStyle) {
      const max = riverMaxRank(d, topRank);
      uniforms.uMaxRank.value = max;
      uniforms.uMapStyle.value = mapStyle;
      // le rang suivant est déjà dessiné, avec un alpha < 1 (fondu)
      geometry.instanceCount = seg.count === 0 ? 0 : seg.countByRank[Math.min(topRank, Math.ceil(max))]!;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
```

- [ ] **Step 4: Vérifier le succès**

Run: `cd web && npx vitest run && npx tsc --noEmit -p .` → tout passe.
Le test « rang fractionnaire » attend `instanceCount = countByRank[5] = 5` pour `uMaxRank ≈ 4,33` (`ceil` = 5) : si `riverMaxRank(1.9, 9)` ne donne pas ≈ 4,33, vérifier l'interpolation (`3 + (2,5 − 1,9)/(2,5 − 1,6) × 2`).

- [ ] **Step 5: Commit**

```bash
git add web/src/render web/tests/rivers-layer.test.ts web/tests/wind-layer.test.ts
git commit -m "feat(rivers): rendu en quads instanciés, fragment GLSL partagé avec le vent" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 10: Chargement des fichiers `geo/` et câblage dans `main.ts`

**Files:**
- Create: `web/src/geo/loader.ts`
- Modify: `web/index.html`, `web/src/style.css`, `web/src/ui/overlay.ts`, `web/src/main.ts`
- Test: `web/tests/geo-loader.test.ts`

**Interfaces:**
- Consumes: `parsePlaces`, `parseCountries`, `buildLabelSet`, `LabelSet` (T4) ; `parseRivers`, `RiverSegments` (T8) ; `createToggle` , `parseFlag`, `withFlag` (T3) ; `LabelsController` (T7) ; `createLabelsLayer` (T6) ; `createRiversLayer` (T9) ; `mapStyleFor(distance)` de `web/src/tiles/lod.ts` ; `SceneHandle.onViewChange(cb: (view: ViewState) => void)`.
- Produces: `once<T>(load: () => Promise<T>): () => Promise<T>` ; `loadLabelSet(base: string, fetchJson: (url: string) => Promise<unknown>): Promise<LabelSet>` ; `loadRivers(base: string, fetchBuffer: (url: string) => Promise<ArrayBuffer>): Promise<RiverSegments>`.

- [ ] **Step 1: Écrire les tests qui échouent**

`web/tests/geo-loader.test.ts` :

```ts
import { describe, expect, it, vi } from "vitest";
import { loadLabelSet, loadRivers, once } from "../src/geo/loader";
import { encodeRivers } from "./rivers-fixture";

const PLACES = { version: 1, places: [[2.35, 48.86, "Paris", 11000000, 1]] };
const COUNTRIES = { version: 1, countries: [[2.55, 46.7, "France", 2]] };

describe("once — un seul chargement par session (spec repères §6)", () => {
  it("partage la promesse, succès comme échec", async () => {
    const load = vi.fn(async () => 42);
    const get = once(load);
    expect(await Promise.all([get(), get()])).toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
    const bad = once(vi.fn(async () => { throw new Error("réseau"); }));
    await expect(bad()).rejects.toThrowError("réseau");
    await expect(bad()).rejects.toThrowError("réseau");
  });
});

describe("loadLabelSet", () => {
  it("charge villes et pays", async () => {
    const fetchJson = vi.fn(async (url: string) => (url.endsWith("places.json") ? PLACES : COUNTRIES));
    const set = await loadLabelSet("/geo", fetchJson);
    expect(set.items.map((i) => i.name)).toEqual(["France", "Paris"]);
    expect(fetchJson.mock.calls.map((c) => c[0]).sort()).toEqual(["/geo/countries.json", "/geo/places.json"]);
  });
  it("un seul fichier en échec : l'autre s'affiche quand même", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const set = await loadLabelSet("/geo", async (url) => {
      if (url.endsWith("countries.json")) throw new Error("404");
      return PLACES;
    });
    expect(set.items.map((i) => i.name)).toEqual(["Paris"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("fichier invalide compté comme un échec ; les deux en échec : rejet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(loadLabelSet("/geo", async () => ({ version: 9 }))).rejects.toThrowError();
    warn.mockRestore();
  });
});

describe("loadRivers", () => {
  it("charge et parse rivers.bin", async () => {
    const fetchBuffer = vi.fn(async () => encodeRivers([[1, [[0, 0], [100, 0]]]]));
    const seg = await loadRivers("/geo", fetchBuffer);
    expect(seg.count).toBe(1);
    expect(fetchBuffer).toHaveBeenCalledWith("/geo/rivers.bin");
  });
  it("binaire invalide : rejet", async () => {
    await expect(loadRivers("/geo", async () => new ArrayBuffer(3))).rejects.toThrowError();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd web && npx vitest run tests/geo-loader.test.ts` → FAIL, module introuvable.

- [ ] **Step 3: Implémenter le chargeur**

`web/src/geo/loader.ts` :

```ts
/**
 * Chargement des fichiers statiques `geo/` (spec repères §6, §7) : une fois par session, hors
 * du chemin de démarrage. Les accès réseau sont injectés.
 */
import { buildLabelSet, parseCountries, parsePlaces, type Country, type LabelSet, type Place } from "../labels/data";
import { parseRivers, type RiverSegments } from "../rivers/data";

/** Mémorise la promesse, succès comme échec : pas de second téléchargement dans la session. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => (promise ??= load());
}

/** Villes et pays ; un seul des deux en échec n'empêche pas l'autre (spec §7). Rejette si les deux échouent. */
export async function loadLabelSet(base: string, fetchJson: (url: string) => Promise<unknown>): Promise<LabelSet> {
  const [places, countries] = await Promise.allSettled([
    fetchJson(`${base}/places.json`).then(parsePlaces),
    fetchJson(`${base}/countries.json`).then(parseCountries),
  ]);
  if (places.status === "rejected") console.warn("[worldtemp] villes indisponibles :", places.reason);
  if (countries.status === "rejected") console.warn("[worldtemp] pays indisponibles :", countries.reason);
  if (places.status === "rejected" && countries.status === "rejected") throw new Error("étiquettes indisponibles");
  const p: Place[] = places.status === "fulfilled" ? places.value : [];
  const c: Country[] = countries.status === "fulfilled" ? countries.value : [];
  return buildLabelSet(p, c);
}

export async function loadRivers(base: string, fetchBuffer: (url: string) => Promise<ArrayBuffer>): Promise<RiverSegments> {
  return parseRivers(await fetchBuffer(`${base}/rivers.bin`));
}
```

Run: `cd web && npx vitest run tests/geo-loader.test.ts` → PASS (6 tests).

- [ ] **Step 4: HTML, CSS, overlay**

`web/index.html` — sous le bouton `#wind-toggle`, dans `<aside id="controls">` :

```html
        <button id="labels-toggle" type="button" role="switch" aria-checked="false">Étiquettes</button>
        <button id="rivers-toggle" type="button" role="switch" aria-checked="false">Fleuves</button>
```

`web/src/style.css` — sous les deux règles `#wind-toggle::before` :

```css
#labels-toggle::before, #rivers-toggle::before { content: "○ " / ""; }
#labels-toggle[aria-checked="true"]::before, #rivers-toggle[aria-checked="true"]::before { content: "● " / ""; }
```

`web/src/ui/overlay.ts` — dans l'interface `Overlay`, sous `windToggle: HTMLButtonElement;` :

```ts
  labelsToggle: HTMLButtonElement;
  riversToggle: HTMLButtonElement;
  labels: HTMLElement;
```

dans `createOverlay`, sous `const windToggle = byId<HTMLButtonElement>("wind-toggle");` :

```ts
  const labelsToggle = byId<HTMLButtonElement>("labels-toggle");
  const riversToggle = byId<HTMLButtonElement>("rivers-toggle");
  const labels = byId<HTMLElement>("labels");
```

et dans l'objet retourné, sous `windToggle,` : `labelsToggle, riversToggle, labels,`.

- [ ] **Step 5: Câbler `main.ts`**

Imports à ajouter (ordre alphabétique des chemins, comme l'existant) :

```ts
import { loadLabelSet, loadRivers, once } from "./geo/loader";
import { parseFlag, withFlag } from "./geo/params";
import { LabelsController } from "./labels/controller";
import { createLabelsLayer } from "./labels/layer";
import { createRiversLayer, type RiversLayer } from "./render/rivers";
```

`mapStyleFor` : l'ajouter à l'import existant de `./tiles/lod` s'il n'y est pas.

Juste **après** le bloc du crochet de validation `__worldtempWind` (fin de la construction du vent), insérer :

```ts
  // Repères géographiques (spec repères §6) : fichiers statiques servis avec le site.
  const GEO_BASE_URL = `${import.meta.env.BASE_URL}geo`;
  const fetchGeo = async (url: string): Promise<Response> => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
    return r;
  };
  const labelSet = once(() => loadLabelSet(GEO_BASE_URL, (url) => fetchGeo(url).then((r) => r.json() as Promise<unknown>)));
  const riverSegments = once(() => loadRivers(GEO_BASE_URL, (url) => fetchGeo(url).then((r) => r.arrayBuffer())));

  const labelsCtl = new LabelsController({
    layer: createLabelsLayer(ui.labels),
    camera: sceneHandle.camera,
    size: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
    tier: decision.tier,
  });
  sceneHandle.onViewChange(() => labelsCtl.onView());
  let labelsOn = parseFlag(location.search, "labels");
  let labelsLoaded = false;
  const applyLabels = async (): Promise<void> => {
    if (labelsOn && !labelsLoaded) {
      try {
        labelsCtl.setData(await labelSet());
        labelsLoaded = true;
      } catch (e) {
        console.warn("[worldtemp] étiquettes indisponibles :", e);
        labelsToggle.setDisabled(true);
        return;
      }
    }
    labelsCtl.setEnabled(labelsOn); // `labelsOn` relu après l'attente : il a pu basculer pendant le chargement
  };
  const labelsToggle = createToggle(ui.labelsToggle, (on) => {
    labelsOn = on;
    history.replaceState(null, "", withFlag(location.search, "labels", on));
    void applyLabels();
  }, "Étiquettes indisponibles");
  labelsToggle.setOn(labelsOn);

  let rivers: RiversLayer | null = null;
  let riversOn = parseFlag(location.search, "rivers");
  const applyRivers = async (): Promise<void> => {
    if (riversOn && !rivers) {
      try {
        const layer = createRiversLayer(await riverSegments());
        rivers = layer;
        sceneHandle.scene.add(layer.object);
        sceneHandle.onViewChange((view) => {
          const d = view.cameraPosition.length();
          layer.setView(d, mapStyleFor(d));
        });
      } catch (e) {
        console.warn("[worldtemp] fleuves indisponibles :", e);
        riversToggle.setDisabled(true);
        return;
      }
    }
    if (rivers) {
      const d = sceneHandle.camera.position.length();
      rivers.setView(d, mapStyleFor(d));
      rivers.object.visible = riversOn;
      sceneHandle.requestRender();
    }
  };
  const riversToggle = createToggle(ui.riversToggle, (on) => {
    riversOn = on;
    history.replaceState(null, "", withFlag(location.search, "rivers", on));
    void applyRivers();
  }, "Fleuves indisponibles");
  riversToggle.setOn(riversOn);
  if (import.meta.env.DEV) {
    (window as unknown as { __worldtempGeo: unknown }).__worldtempGeo = { labels: labelsCtl, rivers: () => rivers };
  }
```

`applyLabels` référence `labelsToggle` déclaré juste après : c'est une fermeture appelée plus tard, pas de TDZ **à condition** de ne jamais appeler `applyLabels()`/`applyRivers()` avant la ligne `const …Toggle = createToggle(…)`. Ne pas déplacer ces appels.

Valeurs des étiquettes — aux **deux** appels existants de `tooltip.setData(…)` dans `activate` (`grep -n "tooltip.setData" web/src/main.ts`), ajouter sur la ligne suivante le même argument pour les étiquettes :

```ts
      tooltip.setData(null);
      labelsCtl.setValueSource(null);
```

```ts
    const tooltipData = active.pixels ? { def, pixels: active.pixels, grid: manifest.grid, encoding: enc } : null;
    tooltip.setData(tooltipData);
    labelsCtl.setValueSource(tooltipData);
```

`labelsCtl` doit donc être déclaré **avant** `activate` dans le fichier : si le bloc inséré ci-dessus se trouve après la définition de `activate`, c'est sans conséquence (fermeture appelée plus tard) tant qu'il se trouve avant `await applyData()`.

Chargement après le premier rendu — à la fin de `boot()`, juste après `await applyData();` :

```ts
  void applyLabels();
  void applyRivers();
```

Perte de contexte WebGL : rien à faire (three renvoie la géométrie ; les étiquettes sont du DOM).

- [ ] **Step 6: Vérifier**

Run: `cd web && npx vitest run && npx tsc --noEmit -p . && npm run build`
Expected: tout passe ; relever la taille gzip de `dist/assets/index-*.js` (budget ≤ 164,08 Ko) ; `ls dist/geo` montre les trois fichiers.

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/src web/tests/geo-loader.test.ts
git commit -m "feat(geo): interrupteurs Étiquettes et Fleuves, chargement après le premier rendu" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log -1 --format=%B | grep -c 'Claude Fable 5.1'
```

---

### Task 11: Validation navigateur (critères de la spec §9)

**Files:**
- Create: `.superpowers/sdd/2026-09-18-labels-rivers/validation-report.md` (git-ignoré, comme pour le vent)
- Modify: constantes de réglage seulement si un critère l'exige (`CITY_TIERS`, `COUNTRY_TIERS`, `LABEL_CAP`, `RIVER_TIERS`, `RIVER_WIDTH_PX`, couleurs des fleuves, CSS `.label`) — avec le test correspondant mis à jour **d'abord**.

**Interfaces:**
- Consumes: tout ce qui précède. Outils `mcp__brave-devtools__*` (`new_page`, `emulate`, `select_page` avec `bringToFront: true` — indispensable, sinon rAF est bridé à 1 Hz —, `take_screenshot`, `evaluate_script`).

- [ ] **Step 1: Servir le build**

```bash
cd web && VITE_DATA_BASE_URL=http://localhost:4173/dev-data/layers npx vite build && npx vite preview --port 4173 --strictPort
```

(en arrière-plan). Les données de `web/public/dev-data/layers/` (git-ignorées) sont copiées dans `dist/` par le build. `VITE_DATA_BASE_URL` doit être une URL absolue sous Git Bash.

- [ ] **Step 2: Critères 1 à 5 et 8**

Viewport `1440x830x1`. Pour chaque critère, capture d'écran + constat dans le rapport :

1. `http://localhost:4173/?layer=temp&wind=0&lon=2&lat=46.5&d=1.35` : Paris, Lyon, Marseille, Toulouse, Bordeaux affichées avec une valeur ; comparer la valeur de Paris à celle du tooltip au même point (`pointermove` synthétique sur le canvas, comme en validation du vent) : identiques.
2. Aucun chevauchement : script qui lit les `getBoundingClientRect()` des `.label.on` et vérifie qu'aucune paire ne s'intersecte ; à 1440 px puis à `500x800x1`.
3. Rotation (glisser synthétique) et zoom : pas de clignotement visible sur une capture vidéo courte ou trois captures rapprochées ; aucune étiquette hors du disque du globe à d = 3.
4. Fleuves : à d = 1,35 Loire, Seine, Rhône, Garonne visibles ; à d = 3 seuls les très grands ; couleur distincte des frontières sur satellite (d ≥ 1,2) et en style carte (d < 1,14).
5. `?labels=0&rivers=0` : rien d'affiché, interrupteurs éteints ; clic sur chacun : apparition sans rechargement, URL mise à jour.
8. Renommer `web/dist/geo/rivers.bin` puis recharger : « Fleuves » grisé avec le titre « Fleuves indisponibles », étiquettes et reste de l'app intacts. Remettre le fichier. Idem avec `places.json` **et** `countries.json` pour « Étiquettes ».

- [ ] **Step 3: Critères 6 et 7 (performance, bundle)**

`?layer=temp&wind=1&tier=high&lon=2&lat=46.5&d=1.35`, vent + étiquettes + fleuves : mesurer les fps sur 5 × 2 s (compteur rAF, même script que la validation du vent) → 60 attendu. Mesurer la sélection : envelopper `selectLabels` n'est pas possible depuis la console en build ; mesurer en dev (`__worldtempGeo`) le temps de `labelsCtl.setData(...)`/`onView` autour d'une re-sélection forcée, ou ajouter temporairement un `performance.now()` local non commité. Attendu ≤ 2 ms.
Bundle : taille gzip relevée en T10 ≤ 164,08 Ko.
Si les fps chutent avec les fleuves : réduire `SEGMENT_BUDGET` dans `tools/build_geo.py`, régénérer (T2), re-mesurer.

- [ ] **Step 4: Critère 9 — profil low émulé**

`emulate` viewport `390x844x3,mobile,touch`, URL `?tier=low&layer=temp&lon=2&lat=46.5&d=1.35` : au plus 15 étiquettes (plafond 30 ÷ 2), aucune ne déborde de l'écran ni ne passe sous les panneaux de façon gênante, tap-tooltip et pincement inchangés, fleuves visibles. Capture dans le rapport.

- [ ] **Step 5: Rapport, nettoyage, commit des réglages éventuels**

Écrire le rapport (un paragraphe + mesures par critère). Tuer les serveurs : `netstat -ano | grep -E ":4173|:5173"` puis `taskkill //PID <pid> //F`. Si des constantes ont été réglées :

```bash
git add web/src web/tests
git commit -m "fix(geo): réglages de validation navigateur (seuils, styles)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Point d'arrêt utilisateur — validation mobile réelle**

**Ne pas merger.** Demander à l'utilisateur de valider sur un vrai téléphone (spec §9, critère 9, condition du merge). Pour cela il faut une URL joignable depuis le téléphone : proposer `npx vite preview --host` sur le réseau local (URL `http://<ip-du-PC>:4173/?tier=low`), les données de dev étant servies par le même serveur — `VITE_DATA_BASE_URL` doit alors pointer vers `http://<ip-du-PC>:4173/dev-data/layers` au moment du build. Attendre son verdict.

---

### Task 12: HISTORY, merge, déploiement

**Files:**
- Modify: `HISTORY.md`

**Interfaces:**
- Consumes: verdict utilisateur de T11 ; skill `updating-history` ; skill `superpowers:finishing-a-development-branch`.

- [ ] **Step 1: Vérification finale**

Run: `.venv/Scripts/python -m pytest -q` ; `cd web && npx vitest run && npx tsc --noEmit -p . && npm run build`. Tout vert, tailles relevées.

- [ ] **Step 2: Merge local**

```bash
git checkout master
git merge --no-ff feat/labels-rivers -m "Merge feat/labels-rivers : lot C — étiquettes villes/pays avec valeur de couche, fleuves" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git branch -d feat/labels-rivers
```

- [ ] **Step 3: HISTORY en une passe (skill `updating-history`)**

Sections forcées par le diff : **§2** (source Natural Earth populated places / rivers, script `build_geo.py`), **§3** (nouveaux dossiers `web/src/labels/`, `web/src/rivers/`, `web/src/geo/`, `web/public/geo/`, fichiers créés/supprimés dont `ui/wind-toggle.ts` → `ui/toggle.ts`, tests), **§5** (décisions de la spec §1 avec leur pourquoi), **§6** (tout défaut rencontré), **§7** (ligne du lot C avec le sha de merge et les nombres de tests), **§8** (dette n° 38 : retirer le point `aria-checked`, résolu), **§9**, pied de page (une entrée par ligne). Puis `python tools/history_check.py` → vert.

```bash
git add HISTORY.md
git commit -m "docs(history): lot C mergé — étiquettes et fleuves" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push et vérification de la prod**

```bash
git push origin master
```

Attendre la CI (`gh run watch`), puis vérifier que `https://globelayers.com/` sert le hash de bundle du build local et que `https://globelayers.com/geo/places.json` répond 200. Mettre à jour la mémoire persistante (`worldtemp-brainstorm-decisions.md` + ligne de `MEMORY.md`).
