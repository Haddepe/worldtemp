# Pipeline GFS → texture — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un paquet Python `pipeline/` qui, lancé toutes les heures par GitHub Actions, télécharge la prévision GFS de température à 2 m valide à l'heure courante, la convertit en PNG 8 bits 1440 × 721 + `latest.json`, et la publie sur Cloudflare R2 sans jamais laisser R2 dans un état invalide.

**Architecture:** Modules purs (sélection du run, URL, conversion, métadonnées) testés sur numpy dans le venv Windows ; un seul module impur non testable localement (`grib_adapter.py`, cfgrib/eccodes) ; effets réseau (`download`, `upload`, `read_current`) injectés dans `main.run()` comme callables. Deux workflows Actions : `pipeline.yml` (cron) et `test.yml` (CI).

**Tech Stack:** Python 3.12 (Actions) / 3.14 (venv local), numpy, Pillow, requests, boto3, pytest ; cfgrib + eccodeslib + xarray sur Actions seulement.

**Spec:** `docs/superpowers/specs/2026-08-30-pipeline-gfs-design.md` — le plan argumente à partir de la spec ; l'exécutant lit les deux.

## Global Constraints

- Encodage : `MIN_C = -90`, `MAX_C = 60`, `pixel = round((T_c - MIN_C) / (MAX_C - MIN_C) * 255)` clippé [0, 255].
- Texture : 1440 × 721, PNG mode `L`, lon -180 → +180 (gauche → droite), lat +90 → -90 (haut → bas). Roll de 720 colonnes depuis la grille GFS, **aucun flip latitude**.
- Sélection : prévision valide à l'heure courante ; délai de disponibilité d'un run 3 h 30 ; 4 candidats max ; `0 ≤ fh ≤ 48`.
- Réseau NOMADS : timeout 60 s ; 404 → candidat suivant ; 5xx/timeout → un retry après 30 s puis suivant.
- Codes retour : `0` succès/no-op, `2` source indisponible, `3` données invalides, `4` publication.
- Objets R2 : `gfs/latest.png` **puis** `gfs/latest.json`, `Cache-Control: public, max-age=300`.
- `metadata.json` : `schema_version: 1`, champs exacts de la spec §4.
- `grib_adapter.py` importe cfgrib/xarray **dans la fonction**, jamais en tête de module.
- Aucun secret R2 → dry-run implicite (génère `out/`, n'uploade rien, exit 0).
- Tous les datetimes sont tz-aware UTC ; sérialisation `YYYY-MM-DDTHH:MM:SSZ`.
- Dépôt en LF (`.gitattributes`). Commits en français, Conventional Commits.
- Commandes locales avec le venv : `.venv/Scripts/python` (Windows). Sur Actions : `python`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `pipeline/__init__.py` | paquet |
| `pipeline/config.py` | constantes (encodage, grille, NOMADS, R2, délais) |
| `pipeline/run_selection.py` | `Candidate`, `candidates(now_utc)` — pur |
| `pipeline/nomads.py` | `build_url` (pur), `download`, exceptions `NotFound`/`TransientError` |
| `pipeline/grib_adapter.py` | `Field`, `decode_grib(bytes)` — seul module cfgrib |
| `pipeline/texture.py` | `validate`, `kelvin_to_celsius`, `reorient`, `quantize`, `encode_png`, `InvalidData` |
| `pipeline/metadata.py` | `iso_utc`, `build_metadata`, `to_json` |
| `pipeline/publish.py` | `write_atomic`, `R2Config`, `read_current`, `upload_r2`, `PublishError` |
| `pipeline/main.py` | `run(...)` orchestration injectée, `main(argv)` CLI |
| `pipeline/requirements.txt`, `pipeline/requirements-grib.txt` | dépendances |
| `pytest.ini` | `pythonpath = .`, `testpaths = tests` |
| `tests/pipeline/test_*.py` | tests niveau 1 et 2 |
| `tests/fixtures/gfs_tmp2m.grib2` | fixture GRIB réelle (~516 Ko) |
| `.github/workflows/pipeline.yml`, `.github/workflows/test.yml` | Actions |

Branche de travail : `feat/pipeline-gfs` (créée par `superpowers:using-git-worktrees` à l'exécution).

---

### Task 1 : Squelette du paquet, dépendances, pytest

**Files:**
- Create: `pipeline/__init__.py`, `pipeline/config.py`, `pipeline/requirements.txt`, `pipeline/requirements-grib.txt`, `pytest.ini`
- Modify: `.gitignore`

**Interfaces:**
- Produces: toutes les constantes de `pipeline.config` utilisées par les tâches suivantes (noms exacts ci-dessous).

- [ ] **Step 1 : Installer les dépendances locales**

```powershell
.venv/Scripts/python -m pip install numpy Pillow requests boto3 pytest
```

Attendu : installation sans erreur (numpy/Pillow/requests déjà présents). Ne PAS installer `requirements-grib.txt` en local.

- [ ] **Step 2 : Créer `pipeline/__init__.py`** (vide) et `pipeline/config.py`

```python
"""Constantes du pipeline. Source de vérité côté Python de l'encodage ; le front
ne recopie rien, il lit `encoding` et `grid` dans latest.json (spec §4)."""

from datetime import timedelta

# Encodage température (spec §4) : pixel = round((T_c - MIN_C) / (MAX_C - MIN_C) * 255)
MIN_C = -90
MAX_C = 60

# Grille GFS 0,25° (spec §4)
WIDTH = 1440
HEIGHT = 721

# Plage Kelvin plausible pour la validation (spec §6)
MIN_K = 180.0
MAX_K = 340.0

# Sélection du run (spec §3)
RUN_AVAILABILITY_DELAY = timedelta(hours=3, minutes=30)
MAX_CANDIDATES = 4
MAX_FORECAST_HOUR = 48

# NOMADS (spec §3)
NOMADS_FILTER_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25_1hr.pl"
HTTP_TIMEOUT_S = 60
RETRY_DELAY_S = 30

# R2 (spec §4)
PNG_KEY = "gfs/latest.png"
JSON_KEY = "gfs/latest.json"
CACHE_CONTROL = "public, max-age=300"

SCHEMA_VERSION = 1
```

- [ ] **Step 3 : Écrire les deux `requirements`**

`pipeline/requirements.txt` :
```
numpy>=2.0
Pillow>=10.0
requests>=2.31
boto3>=1.34
```

`pipeline/requirements-grib.txt` :
```
# Actions (Linux) seulement : eccodeslib n'a pas de roue Windows.
cfgrib>=0.9.15
eccodeslib>=2.48
xarray>=2025.1
```

- [ ] **Step 4 : Créer `pytest.ini`**

```ini
[pytest]
testpaths = tests
pythonpath = .
```

- [ ] **Step 5 : Compléter `.gitignore`** — ajouter après le bloc « Données et textures générées » :

```
# Sortie locale du pipeline (spec §4)
out/

# La fixture GRIB de test est l'exception à *.grib2 (spec §7)
!tests/fixtures/*.grib2
```

- [ ] **Step 6 : Vérifier que pytest collecte les tests existants**

Run: `.venv/Scripts/python -m pytest -q`
Expected: `30 passed` (les tests unittest de `history_check` sont ramassés).

- [ ] **Step 7 : Commit**

```bash
git add pipeline/__init__.py pipeline/config.py pipeline/requirements.txt pipeline/requirements-grib.txt pytest.ini .gitignore
git commit -m "chore(pipeline): squelette du paquet, constantes, pytest"
```

---

### Task 2 : Sélection du run (`run_selection.py`)

**Files:**
- Create: `pipeline/run_selection.py`
- Test: `tests/pipeline/test_run_selection.py`

**Interfaces:**
- Consumes: `config.RUN_AVAILABILITY_DELAY`, `config.MAX_CANDIDATES`, `config.MAX_FORECAST_HOUR`
- Produces: `Candidate(run: datetime, forecast_hour: int)` frozen dataclass avec propriété `valid_time`, et `candidates(now_utc, *, delay=..., max_candidates=..., max_forecast_hour=...) -> list[Candidate]`.

- [ ] **Step 1 : Écrire les tests**

`tests/pipeline/test_run_selection.py` :
```python
from datetime import datetime, timedelta, timezone

import pytest

from pipeline.run_selection import Candidate, candidates

UTC = timezone.utc


def dt(y, m, d, h, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=UTC)


def test_spec_example_14h20():
    got = candidates(dt(2026, 8, 30, 14, 20))
    assert got == [
        Candidate(dt(2026, 8, 30, 6), 8),
        Candidate(dt(2026, 8, 30, 0), 14),
        Candidate(dt(2026, 8, 29, 18), 20),
        Candidate(dt(2026, 8, 29, 12), 26),
    ]


def test_early_morning_skips_00z_run():
    got = candidates(dt(2026, 8, 30, 3, 0))
    assert got[0] == Candidate(dt(2026, 8, 29, 18), 9)
    assert all(c.run != dt(2026, 8, 30, 0) for c in got)


def test_midnight_crossing():
    got = candidates(dt(2026, 8, 30, 0, 0))
    assert got[0] == Candidate(dt(2026, 8, 29, 18), 6)
    assert got[-1] == Candidate(dt(2026, 8, 29, 0), 24)


def test_target_is_floored_to_the_hour():
    assert candidates(dt(2026, 8, 30, 14, 59)) == candidates(dt(2026, 8, 30, 14, 0))


def test_forecast_hour_is_capped():
    got = candidates(dt(2026, 8, 30, 14, 20), max_candidates=20, max_forecast_hour=48)
    assert got, "au moins un candidat"
    assert all(0 <= c.forecast_hour <= 48 for c in got)
    assert len(got) < 20


def test_valid_time_is_run_plus_forecast_hour():
    c = Candidate(dt(2026, 8, 30, 6), 8)
    assert c.valid_time == dt(2026, 8, 30, 14)


def test_naive_datetime_rejected():
    with pytest.raises(ValueError):
        candidates(datetime(2026, 8, 30, 14, 20))


def test_non_utc_timezone_is_converted():
    paris = timezone(timedelta(hours=2))
    assert candidates(datetime(2026, 8, 30, 16, 20, tzinfo=paris)) == candidates(dt(2026, 8, 30, 14, 20))
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `.venv/Scripts/python -m pytest tests/pipeline/test_run_selection.py -q`
Expected: erreur d'import `pipeline.run_selection`.

- [ ] **Step 3 : Implémenter `pipeline/run_selection.py`**

```python
"""Choix du couple (run GFS, échéance) dont la prévision est valide à l'heure
courante (spec §3). Fonction pure : aucune I/O."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from pipeline import config


@dataclass(frozen=True)
class Candidate:
    run: datetime          # heure du run, tz-aware UTC, multiple de 6 h
    forecast_hour: int     # échéance en heures

    @property
    def valid_time(self) -> datetime:
        return self.run + timedelta(hours=self.forecast_hour)


def _floor_to_hour(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def _floor_to_run(dt: datetime) -> datetime:
    return dt.replace(hour=(dt.hour // 6) * 6, minute=0, second=0, microsecond=0)


def candidates(
    now_utc: datetime,
    *,
    delay: timedelta = config.RUN_AVAILABILITY_DELAY,
    max_candidates: int = config.MAX_CANDIDATES,
    max_forecast_hour: int = config.MAX_FORECAST_HOUR,
) -> list[Candidate]:
    """Candidats du plus récent au plus ancien, tous valides à `now` tronqué à l'heure.

    Un run n'est retenu que s'il a eu `delay` pour apparaître sur NOMADS ; un 404
    en aval couvre l'imprécision de ce délai dans les deux sens.
    """
    if now_utc.tzinfo is None:
        raise ValueError("now_utc doit être tz-aware (UTC)")
    target = _floor_to_hour(now_utc.astimezone(timezone.utc))
    run = _floor_to_run(target - delay)
    found: list[Candidate] = []
    for _ in range(max_candidates):
        fh = int((target - run).total_seconds() // 3600)
        if 0 <= fh <= max_forecast_hour:
            found.append(Candidate(run, fh))
        run -= timedelta(hours=6)
    return found
```

- [ ] **Step 4 : Vérifier le succès**

Run: `.venv/Scripts/python -m pytest tests/pipeline/test_run_selection.py -q`
Expected: `8 passed`.

- [ ] **Step 5 : Commit**

```bash
git add pipeline/run_selection.py tests/pipeline/test_run_selection.py
git commit -m "feat(pipeline): sélection du run et de l'échéance valide à l'heure courante"
```

---

### Task 3 : URL et téléchargement NOMADS (`nomads.py`)

**Files:**
- Create: `pipeline/nomads.py`
- Test: `tests/pipeline/test_nomads.py`

**Interfaces:**
- Consumes: `Candidate` (Task 2), `config.NOMADS_FILTER_URL`, `config.HTTP_TIMEOUT_S`
- Produces: `build_url(c: Candidate, base: str = ...) -> str` ; `download(url: str, timeout: float = ...) -> bytes` ; exceptions `NotFound(Exception)` et `TransientError(Exception)`.

- [ ] **Step 1 : Écrire les tests**

`tests/pipeline/test_nomads.py` :
```python
from datetime import datetime, timezone

from pipeline.nomads import build_url
from pipeline.run_selection import Candidate


def test_build_url_exact_for_06z_f008():
    c = Candidate(datetime(2026, 8, 30, 6, tzinfo=timezone.utc), 8)
    assert build_url(c) == (
        "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25_1hr.pl"
        "?dir=/gfs.20260830/06/atmos"
        "&file=gfs.t06z.pgrb2.0p25.f008"
        "&var_TMP=on&lev_2_m_above_ground=on"
    )


def test_build_url_zero_pads_hour_and_forecast():
    c = Candidate(datetime(2026, 1, 2, 0, tzinfo=timezone.utc), 26)
    url = build_url(c)
    assert "dir=/gfs.20260102/00/atmos" in url
    assert "file=gfs.t00z.pgrb2.0p25.f026" in url


def test_build_url_has_no_subregion():
    c = Candidate(datetime(2026, 8, 30, 6, tzinfo=timezone.utc), 8)
    assert "subregion" not in build_url(c)
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `.venv/Scripts/python -m pytest tests/pipeline/test_nomads.py -q`
Expected: erreur d'import `pipeline.nomads`.

- [ ] **Step 3 : Implémenter `pipeline/nomads.py`**

```python
"""Accès NOMADS : construction d'URL (pure) et téléchargement (réseau)."""

from __future__ import annotations

from urllib.parse import urlencode

import requests

from pipeline import config
from pipeline.run_selection import Candidate


class NotFound(Exception):
    """404 : ce run/échéance n'est pas (ou pas encore) sur NOMADS → candidat suivant."""


class TransientError(Exception):
    """5xx, timeout, erreur de connexion → un retry, puis candidat suivant."""


def build_url(c: Candidate, base: str = config.NOMADS_FILTER_URL) -> str:
    hh = f"{c.run.hour:02d}"
    params = [
        ("dir", f"/gfs.{c.run:%Y%m%d}/{hh}/atmos"),
        ("file", f"gfs.t{hh}z.pgrb2.0p25.f{c.forecast_hour:03d}"),
        ("var_TMP", "on"),
        ("lev_2_m_above_ground", "on"),
    ]
    return base + "?" + urlencode(params, safe="/")


def download(url: str, timeout: float = config.HTTP_TIMEOUT_S) -> bytes:
    try:
        resp = requests.get(url, timeout=timeout)
    except requests.RequestException as exc:
        raise TransientError(str(exc)) from exc
    if resp.status_code == 404:
        raise NotFound(url)
    if resp.status_code >= 500:
        raise TransientError(f"HTTP {resp.status_code}")
    resp.raise_for_status()
    # Le filtre NOMADS peut répondre 200 avec une page HTML d'erreur.
    if not resp.content.startswith(b"GRIB"):
        raise NotFound(f"réponse non GRIB ({len(resp.content)} octets)")
    return resp.content
```

- [ ] **Step 4 : Vérifier le succès**

Run: `.venv/Scripts/python -m pytest tests/pipeline/test_nomads.py -q`
Expected: `3 passed`.

- [ ] **Step 5 : Commit**

```bash
git add pipeline/nomads.py tests/pipeline/test_nomads.py
git commit -m "feat(pipeline): URL du filtre NOMADS et téléchargement"
```

---

### Task 4 : Adaptateur GRIB (`grib_adapter.py`) et fixture réelle

**Files:**
- Create: `pipeline/grib_adapter.py`, `tests/fixtures/gfs_tmp2m.grib2`
- Test: `tests/pipeline/test_grib_adapter.py`

**Interfaces:**
- Produces: `Field(values: np.ndarray, lat: np.ndarray, lon: np.ndarray)` frozen dataclass — `values` float32 `(721, 1440)` en Kelvin, lat 90 → -90, lon 0 → 359.75 ; `decode_grib(data: bytes) -> Field`.

Le module doit s'importer sur Windows (le `Field` sert à `texture.py` et `main.py`) ; seul l'appel à `decode_grib` échoue sans eccodes. Les tests de cette tâche ne passent que sur Actions ; en local ils doivent être **skipped**, pas en erreur.

- [ ] **Step 1 : Télécharger la fixture**

```powershell
New-Item -ItemType Directory -Force tests/fixtures | Out-Null
$url = .venv/Scripts/python -c "from datetime import datetime, timezone; from pipeline.run_selection import candidates; from pipeline.nomads import build_url; print(build_url(candidates(datetime.now(timezone.utc))[0]))"
curl.exe -fL -o tests/fixtures/gfs_tmp2m.grib2 $url
Get-Item tests/fixtures/gfs_tmp2m.grib2 | Select-Object Length
```

Attendu : fichier de ~500 Ko. Vérifier l'en-tête : `.venv/Scripts/python -c "print(open('tests/fixtures/gfs_tmp2m.grib2','rb').read(4))"` → `b'GRIB'`. Si 404 (run pas encore publié), remplacer `[0]` par `[1]`.

- [ ] **Step 2 : Écrire le test**

`tests/pipeline/test_grib_adapter.py` :
```python
from pathlib import Path

import numpy as np
import pytest

FIXTURE = Path(__file__).parent.parent / "fixtures" / "gfs_tmp2m.grib2"


def _grib_stack_available() -> bool:
    try:
        import cfgrib  # noqa: F401
        import eccodes  # noqa: F401
    except Exception:  # ImportError, ou RuntimeError « Cannot find the ecCodes library » sur Windows
        return False
    return True


pytestmark = pytest.mark.skipif(not _grib_stack_available(), reason="cfgrib/eccodes indisponibles (poste Windows)")


def test_decode_real_gfs_file():
    from pipeline.grib_adapter import decode_grib

    field = decode_grib(FIXTURE.read_bytes())
    assert field.values.shape == (721, 1440)
    assert field.values.dtype == np.float32
    assert field.lat.shape == (721,) and field.lon.shape == (1440,)
    assert field.lat[0] == 90 and field.lat[-1] == -90
    assert field.lon[0] == 0 and field.lon[-1] == pytest.approx(359.75)
    assert not np.isnan(field.values).any()
    assert 180 < field.values.min() < field.values.max() < 340


def test_field_importable_without_decoding():
    from pipeline.grib_adapter import Field  # noqa: F401
```

- [ ] **Step 3 : Implémenter `pipeline/grib_adapter.py`**

```python
"""Seul module dépendant de cfgrib/eccodes. Il rend du numpy nu : rien de xarray
ne sort d'ici. Les imports lourds sont dans la fonction : sur le poste Windows
(sans eccodes) le module s'importe, seul `decode_grib` échoue."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Field:
    values: np.ndarray  # (721, 1440) float32, Kelvin, lat 90→-90 (haut→bas), lon 0→359.75
    lat: np.ndarray     # (721,)
    lon: np.ndarray     # (1440,)


def decode_grib(data: bytes) -> Field:
    import xarray as xr  # cfgrib est chargé via engine="cfgrib"

    fd, path = tempfile.mkstemp(suffix=".grib2")  # cfgrib lit un chemin, pas un buffer
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        with xr.open_dataset(path, engine="cfgrib", backend_kwargs={"indexpath": ""}) as ds:
            da = ds["t2m"]  # nom cfgrib de TMP à 2 m
            return Field(
                values=np.ascontiguousarray(da.values, dtype=np.float32),
                lat=np.asarray(ds["latitude"].values, dtype=np.float64),
                lon=np.asarray(ds["longitude"].values, dtype=np.float64),
            )
    finally:
        os.unlink(path)
```

- [ ] **Step 4 : Vérifier localement (skip attendu)**

Run: `.venv/Scripts/python -m pytest tests/pipeline/test_grib_adapter.py -v`
Expected: `2 skipped` avec la raison « cfgrib/eccodes indisponibles ». Aucune erreur d'import.

- [ ] **Step 5 : Vérifier que git accepte la fixture**

Run: `git check-ignore -v tests/fixtures/gfs_tmp2m.grib2`
Expected: sortie mentionnant la règle `!tests/fixtures/*.grib2` (exclusion inversée) — ou exit 1 sans sortie. Si la règle `*.grib2` apparaît seule, corriger `.gitignore` (Task 1, Step 5).

- [ ] **Step 6 : Commit**

```bash
git add pipeline/grib_adapter.py tests/pipeline/test_grib_adapter.py tests/fixtures/gfs_tmp2m.grib2
git commit -m "feat(pipeline): adaptateur GRIB isolé + fixture GFS réelle"
```

Le test réel ne s'exécutera qu'en Task 10 (CI). Si `ds["t2m"]` lève `KeyError` sur Actions, lister `ds.data_vars` dans le log et ajuster le nom — c'est le seul point de cette tâche non vérifiable avant.

---

### Task 5 : Conversion en texture (`texture.py`)

**Files:**
- Create: `pipeline/texture.py`
- Test: `tests/pipeline/test_texture.py`

**Interfaces:**
- Consumes: `Field` (Task 4), `config.MIN_C/MAX_C/WIDTH/HEIGHT/MIN_K/MAX_K`
- Produces: `InvalidData(ValueError)` ; `validate(field: Field) -> None` ; `kelvin_to_celsius(k: np.ndarray) -> np.ndarray` ; `reorient(values: np.ndarray) -> np.ndarray` ; `quantize(celsius: np.ndarray, min_c=config.MIN_C, max_c=config.MAX_C) -> np.ndarray[uint8]` ; `encode_png(pixels: np.ndarray) -> bytes`.

- [ ] **Step 1 : Écrire les tests**

`tests/pipeline/test_texture.py` :
```python
import io

import numpy as np
import pytest
from PIL import Image

from pipeline.grib_adapter import Field
from pipeline.texture import InvalidData, encode_png, kelvin_to_celsius, quantize, reorient, validate


def make_field(values=None):
    if values is None:
        values = np.full((721, 1440), 288.15, dtype=np.float32)
    return Field(values=values, lat=np.linspace(90, -90, 721), lon=np.arange(0, 360, 0.25))


# --- validate -------------------------------------------------------------

def test_validate_accepts_plausible_field():
    validate(make_field())


def test_validate_rejects_nan():
    v = np.full((721, 1440), 288.15, dtype=np.float32)
    v[10, 10] = np.nan
    with pytest.raises(InvalidData, match="NaN"):
        validate(make_field(v))


@pytest.mark.parametrize("bad", [170.0, 350.0])
def test_validate_rejects_implausible_kelvin(bad):
    v = np.full((721, 1440), 288.15, dtype=np.float32)
    v[0, 0] = bad
    with pytest.raises(InvalidData):
        validate(make_field(v))


def test_validate_rejects_wrong_shape():
    with pytest.raises(InvalidData, match="forme"):
        validate(Field(np.zeros((10, 10), np.float32) + 288, np.zeros(10), np.zeros(10)))


def test_validate_rejects_south_up_grid():
    f = make_field()
    with pytest.raises(InvalidData, match="lat"):
        validate(Field(f.values, f.lat[::-1].copy(), f.lon))


def test_validate_rejects_shifted_longitudes():
    f = make_field()
    with pytest.raises(InvalidData, match="lon"):
        validate(Field(f.values, f.lat, f.lon - 180))


# --- conversions ----------------------------------------------------------

def test_kelvin_to_celsius():
    assert kelvin_to_celsius(np.array([273.15, 288.15])) == pytest.approx([0.0, 15.0])


def test_reorient_rolls_longitude_zero_to_center():
    values = np.tile(np.arange(1440, dtype=np.float32), (721, 1))  # colonne j vaut j
    out = reorient(values)
    assert out.shape == (721, 1440)
    assert (out[:, 720] == 0).all()      # lon 0 arrive au centre
    assert (out[:, 0] == 720).all()      # lon 180 (= -180) arrive à gauche
    assert (out[0] == values[0][[(j + 720) % 1440 for j in range(1440)]]).all()


@pytest.mark.parametrize("celsius,pixel", [(-90, 0), (60, 255), (15, 178), (-15, 128)])
def test_quantize_known_values(celsius, pixel):
    assert quantize(np.array([[float(celsius)]]))[0, 0] == pixel


def test_quantize_clips_out_of_range():
    out = quantize(np.array([[-120.0, 90.0]]))
    assert out.tolist() == [[0, 255]]
    assert out.dtype == np.uint8


def test_quantize_rejects_nan():
    with pytest.raises(InvalidData):
        quantize(np.array([[np.nan]]))


# --- PNG ------------------------------------------------------------------

def test_encode_png_roundtrip():
    pixels = np.random.default_rng(0).integers(0, 256, size=(721, 1440), dtype=np.uint8)
    data = encode_png(pixels)
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    img = Image.open(io.BytesIO(data))
    assert img.mode == "L"
    assert img.size == (1440, 721)
    assert (np.asarray(img) == pixels).all()


def test_encode_png_rejects_non_uint8():
    with pytest.raises(ValueError):
        encode_png(np.zeros((2, 2), dtype=np.float32))
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `.venv/Scripts/python -m pytest tests/pipeline/test_texture.py -q`
Expected: erreur d'import `pipeline.texture`.

- [ ] **Step 3 : Implémenter `pipeline/texture.py`**

```python
"""Champ Kelvin sur grille GFS → pixels 8 bits orientés pour la sphère (spec §4).
Fonctions pures sur numpy."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from pipeline import config
from pipeline.grib_adapter import Field


class InvalidData(ValueError):
    """Données invraisemblables : le pipeline s'arrête (exit 3), jamais de remplissage."""


def validate(field: Field) -> None:
    v = field.values
    expected = (config.HEIGHT, config.WIDTH)
    if v.shape != expected:
        raise InvalidData(f"forme {v.shape}, attendu {expected}")
    if np.isnan(v).any():
        raise InvalidData("NaN présent dans le champ")
    lo, hi = float(v.min()), float(v.max())
    if lo < config.MIN_K or hi > config.MAX_K:
        raise InvalidData(f"plage Kelvin invraisemblable [{lo:.1f}, {hi:.1f}]")
    if field.lat[0] != 90:
        raise InvalidData(f"lat[0] = {field.lat[0]}, attendu 90 (nord en haut)")
    if field.lon[0] != 0:
        raise InvalidData(f"lon[0] = {field.lon[0]}, attendu 0")


def kelvin_to_celsius(kelvin: np.ndarray) -> np.ndarray:
    return kelvin - 273.15


def reorient(values: np.ndarray) -> np.ndarray:
    """Grille GFS lon 0→360 → lon -180→180 : roll d'une demi-largeur. Pas de flip
    latitude, GFS livre déjà le nord en haut (garanti par `validate`)."""
    return np.roll(values, values.shape[1] // 2, axis=1)


def quantize(celsius: np.ndarray, min_c: float = config.MIN_C, max_c: float = config.MAX_C) -> np.ndarray:
    if np.isnan(celsius).any():
        raise InvalidData("NaN présent avant quantification")
    scaled = (np.asarray(celsius, dtype=np.float64) - min_c) / (max_c - min_c) * 255.0
    return np.clip(np.rint(scaled), 0, 255).astype(np.uint8)


def encode_png(pixels: np.ndarray) -> bytes:
    if pixels.dtype != np.uint8 or pixels.ndim != 2:
        raise ValueError("encode_png attend un tableau 2D uint8")
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, format="PNG", optimize=True)
    return buf.getvalue()
```

- [ ] **Step 4 : Vérifier le succès**

Run: `.venv/Scripts/python -m pytest tests/pipeline/test_texture.py -q`
Expected: `17 passed`.

- [ ] **Step 5 : Commit**

```bash
git add pipeline/texture.py tests/pipeline/test_texture.py
git commit -m "feat(pipeline): validation, réorientation et quantification 8 bits en PNG"
```

---

### Task 6 : Métadonnées (`metadata.py`)

**Files:**
- Create: `pipeline/metadata.py`
- Test: `tests/pipeline/test_metadata.py`

**Interfaces:**
- Consumes: `Candidate` (Task 2), `config.*`
- Produces: `iso_utc(dt: datetime) -> str` ; `build_metadata(c: Candidate, celsius: np.ndarray, generated_at: datetime) -> dict` ; `to_json(meta: dict) -> bytes`.

- [ ] **Step 1 : Écrire les tests**

`tests/pipeline/test_metadata.py` :
```python
import json
from datetime import datetime, timedelta, timezone

import numpy as np

from pipeline.metadata import build_metadata, iso_utc, to_json
from pipeline.run_selection import Candidate

UTC = timezone.utc


def test_iso_utc_format_and_conversion():
    assert iso_utc(datetime(2026, 8, 30, 14, 7, 42, tzinfo=UTC)) == "2026-08-30T14:07:42Z"
    paris = timezone(timedelta(hours=2))
    assert iso_utc(datetime(2026, 8, 30, 16, 0, tzinfo=paris)) == "2026-08-30T14:00:00Z"


def test_build_metadata_matches_spec_contract():
    c = Candidate(datetime(2026, 8, 30, 6, tzinfo=UTC), 8)
    celsius = np.array([[-71.34, 48.86]])
    meta = build_metadata(c, celsius, generated_at=datetime(2026, 8, 30, 14, 7, 42, tzinfo=UTC))
    assert meta == {
        "schema_version": 1,
        "model": "gfs_0p25",
        "variable": "TMP_2m",
        "run": "2026-08-30T06:00:00Z",
        "forecast_hour": 8,
        "valid_time_utc": "2026-08-30T14:00:00Z",
        "generated_at": "2026-08-30T14:07:42Z",
        "encoding": {"bits": 8, "min_c": -90, "max_c": 60},
        "grid": {"width": 1440, "height": 721, "lon_min": -180, "lon_max": 180, "lat_min": -90, "lat_max": 90},
        "texture": "latest.png",
        "stats": {"min_c": -71.3, "max_c": 48.9},
    }


def test_to_json_is_utf8_pretty_with_trailing_newline():
    data = to_json({"a": 1})
    assert data.endswith(b"\n")
    assert json.loads(data) == {"a": 1}
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `.venv/Scripts/python -m pytest tests/pipeline/test_metadata.py -q`
Expected: erreur d'import.

- [ ] **Step 3 : Implémenter `pipeline/metadata.py`**

```python
"""latest.json — contrat de données avec le globe (spec §4). Pur."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np

from pipeline import config
from pipeline.run_selection import Candidate


def iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_metadata(c: Candidate, celsius: np.ndarray, generated_at: datetime) -> dict:
    return {
        "schema_version": config.SCHEMA_VERSION,
        "model": "gfs_0p25",
        "variable": "TMP_2m",
        "run": iso_utc(c.run),
        "forecast_hour": c.forecast_hour,
        "valid_time_utc": iso_utc(c.valid_time),
        "generated_at": iso_utc(generated_at),
        "encoding": {"bits": 8, "min_c": config.MIN_C, "max_c": config.MAX_C},
        "grid": {
            "width": config.WIDTH, "height": config.HEIGHT,
            "lon_min": -180, "lon_max": 180, "lat_min": -90, "lat_max": 90,
        },
        "texture": "latest.png",
        "stats": {"min_c": round(float(celsius.min()), 1), "max_c": round(float(celsius.max()), 1)},
    }


def to_json(meta: dict) -> bytes:
    return (json.dumps(meta, indent=2) + "\n").encode("utf-8")
```

- [ ] **Step 4 : Vérifier le succès**

Run: `.venv/Scripts/python -m pytest tests/pipeline/test_metadata.py -q`
Expected: `3 passed`.

- [ ] **Step 5 : Commit**

```bash
git add pipeline/metadata.py tests/pipeline/test_metadata.py
git commit -m "feat(pipeline): métadonnées latest.json (schéma v1)"
```

---

### Task 7 : Écriture atomique et R2 (`publish.py`)

**Files:**
- Create: `pipeline/publish.py`
- Test: `tests/pipeline/test_publish.py`

**Interfaces:**
- Consumes: `config.PNG_KEY/JSON_KEY/CACHE_CONTROL`
- Produces: `PublishError(Exception)` ; `write_atomic(path: Path, data: bytes) -> None` ; `R2Config` frozen dataclass (`account_id, access_key_id, secret_access_key, bucket`, `from_env(env) -> R2Config | None`, `endpoint_url`) ; `read_current(cfg, client_factory=_client) -> dict | None` ; `upload_r2(cfg, png: bytes, meta_json: bytes, client_factory=_client) -> None`.

Note de conception : l'idempotence lit `gfs/latest.json` via l'API S3 avec les mêmes secrets (token « Read & Write ») plutôt que via l'URL publique — pas de 5ᵉ secret à gérer. Même sémantique que la spec §3 : absent ou illisible → `None`, on continue.

- [ ] **Step 1 : Écrire les tests**

`tests/pipeline/test_publish.py` :
```python
import json
from pathlib import Path

import pytest

from pipeline.publish import PublishError, R2Config, read_current, upload_r2, write_atomic

ENV = {
    "R2_ACCOUNT_ID": "acc", "R2_ACCESS_KEY_ID": "key",
    "R2_SECRET_ACCESS_KEY": "secret", "R2_BUCKET": "worldtemp",
}


class FakeClient:
    """Enregistre les put_object ; peut échouer sur une clé donnée."""

    def __init__(self, fail_on: str | None = None, current: bytes | None = None):
        self.calls: list[dict] = []
        self.fail_on = fail_on
        self.current = current

    def put_object(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs["Key"] == self.fail_on:
            raise RuntimeError("boom")

    def get_object(self, **kwargs):
        if self.current is None:
            raise RuntimeError("NoSuchKey")
        return {"Body": _Body(self.current)}


class _Body:
    def __init__(self, data):
        self._data = data

    def read(self):
        return self._data


# --- write_atomic ---------------------------------------------------------

def test_write_atomic_creates_parents_and_leaves_no_temp(tmp_path: Path):
    target = tmp_path / "out" / "latest.png"
    write_atomic(target, b"abc")
    assert target.read_bytes() == b"abc"
    assert list((tmp_path / "out").iterdir()) == [target]


def test_write_atomic_overwrites(tmp_path: Path):
    target = tmp_path / "f"
    write_atomic(target, b"1")
    write_atomic(target, b"22")
    assert target.read_bytes() == b"22"


# --- R2Config -------------------------------------------------------------

def test_from_env_complete():
    cfg = R2Config.from_env(ENV)
    assert cfg == R2Config("acc", "key", "secret", "worldtemp")
    assert cfg.endpoint_url == "https://acc.r2.cloudflarestorage.com"


@pytest.mark.parametrize("missing", list(ENV))
def test_from_env_missing_any_secret_is_dry_run(missing):
    env = {k: v for k, v in ENV.items() if k != missing}
    assert R2Config.from_env(env) is None


def test_from_env_empty_value_is_dry_run():
    assert R2Config.from_env({**ENV, "R2_BUCKET": ""}) is None


# --- upload_r2 ------------------------------------------------------------

def test_upload_png_then_json_with_headers():
    client = FakeClient()
    upload_r2(R2Config.from_env(ENV), b"png", b"{}", client_factory=lambda cfg: client)
    assert [c["Key"] for c in client.calls] == ["gfs/latest.png", "gfs/latest.json"]
    png, js = client.calls
    assert png["Bucket"] == "worldtemp" and png["Body"] == b"png"
    assert png["ContentType"] == "image/png" and js["ContentType"] == "application/json"
    assert png["CacheControl"] == js["CacheControl"] == "public, max-age=300"


def test_upload_png_failure_never_sends_json():
    client = FakeClient(fail_on="gfs/latest.png")
    with pytest.raises(PublishError):
        upload_r2(R2Config.from_env(ENV), b"png", b"{}", client_factory=lambda cfg: client)
    assert [c["Key"] for c in client.calls] == ["gfs/latest.png"]


def test_upload_json_failure_raises_publish_error():
    client = FakeClient(fail_on="gfs/latest.json")
    with pytest.raises(PublishError):
        upload_r2(R2Config.from_env(ENV), b"png", b"{}", client_factory=lambda cfg: client)


# --- read_current ---------------------------------------------------------

def test_read_current_returns_parsed_json():
    client = FakeClient(current=json.dumps({"run": "x", "forecast_hour": 3}).encode())
    assert read_current(R2Config.from_env(ENV), client_factory=lambda cfg: client) == {"run": "x", "forecast_hour": 3}


def test_read_current_absent_or_broken_is_none():
    assert read_current(R2Config.from_env(ENV), client_factory=lambda cfg: FakeClient()) is None
    assert read_current(R2Config.from_env(ENV), client_factory=lambda cfg: FakeClient(current=b"{not json")) is None
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `.venv/Scripts/python -m pytest tests/pipeline/test_publish.py -q`
Expected: erreur d'import.

- [ ] **Step 3 : Implémenter `pipeline/publish.py`**

```python
"""Écriture locale atomique et publication R2 (spec §4, §6). R2 parle S3 : boto3
sur l'endpoint Cloudflare, aucun SDK spécifique."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

from pipeline import config

log = logging.getLogger(__name__)


class PublishError(Exception):
    """Échec d'upload : exit 4. R2 reste sur l'ancien couple ou PNG neuf + JSON ancien."""


@dataclass(frozen=True)
class R2Config:
    account_id: str
    access_key_id: str
    secret_access_key: str
    bucket: str

    ENV_KEYS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> R2Config | None:
        """None dès qu'un secret manque ou est vide → dry-run implicite."""
        values = [env.get(k, "") for k in cls.ENV_KEYS]
        if not all(values):
            return None
        return cls(*values)

    @property
    def endpoint_url(self) -> str:
        return f"https://{self.account_id}.r2.cloudflarestorage.com"


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _client(cfg: R2Config):
    import boto3  # import local : inutile en dry-run

    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint_url,
        aws_access_key_id=cfg.access_key_id,
        aws_secret_access_key=cfg.secret_access_key,
        region_name="auto",
    )


ClientFactory = Callable[[R2Config], object]


def read_current(cfg: R2Config, client_factory: ClientFactory = _client) -> dict | None:
    """latest.json actuellement publié, ou None s'il est absent ou illisible.
    L'idempotence est un confort, pas une garde : toute erreur → None."""
    try:
        obj = client_factory(cfg).get_object(Bucket=cfg.bucket, Key=config.JSON_KEY)
        return json.loads(obj["Body"].read())
    except Exception as exc:  # NoSuchKey, réseau, droits, JSON cassé
        log.warning("latest.json non lu sur R2 (%s) : on continue", exc)
        return None


def upload_r2(cfg: R2Config, png: bytes, meta_json: bytes, client_factory: ClientFactory = _client) -> None:
    """PNG d'abord, JSON ensuite (spec §4) : la seule incohérence possible est
    « PNG neuf + JSON ancien », invisible côté front."""
    client = client_factory(cfg)
    try:
        client.put_object(
            Bucket=cfg.bucket, Key=config.PNG_KEY, Body=png,
            ContentType="image/png", CacheControl=config.CACHE_CONTROL,
        )
        client.put_object(
            Bucket=cfg.bucket, Key=config.JSON_KEY, Body=meta_json,
            ContentType="application/json", CacheControl=config.CACHE_CONTROL,
        )
    except Exception as exc:
        raise PublishError(str(exc)) from exc
```

- [ ] **Step 4 : Vérifier le succès**

Run: `.venv/Scripts/python -m pytest tests/pipeline/test_publish.py -q`
Expected: `13 passed`.

- [ ] **Step 5 : Commit**

```bash
git add pipeline/publish.py tests/pipeline/test_publish.py
git commit -m "feat(pipeline): écriture atomique et publication R2 ordonnée"
```

---

### Task 8 : Orchestration (`main.run`)

**Files:**
- Create: `pipeline/main.py` (fonction `run` seulement ; le CLI vient en Task 9)
- Test: `tests/pipeline/test_main.py`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `EXIT_OK = 0`, `EXIT_SOURCE = 2`, `EXIT_DATA = 3`, `EXIT_PUBLISH = 4` ; `run(now, *, download, decode, upload, read_current, out_dir, sleep=time.sleep) -> int` où `download(url) -> bytes` lève `nomads.NotFound`/`nomads.TransientError`, `decode(bytes) -> Field`, `upload(png, meta_json) -> None` ou `None` (dry-run), `read_current() -> dict | None`.

- [ ] **Step 1 : Écrire les tests**

`tests/pipeline/test_main.py` :
```python
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

from pipeline import nomads
from pipeline.grib_adapter import Field
from pipeline.main import EXIT_DATA, EXIT_OK, EXIT_PUBLISH, EXIT_SOURCE, run
from pipeline.publish import PublishError

NOW = datetime(2026, 8, 30, 14, 20, tzinfo=timezone.utc)
FIRST_RUN = "2026-08-30T06:00:00Z"  # 1er candidat à 14:20 : 06z f008


def good_field(value=288.15):
    return Field(np.full((721, 1440), value, np.float32), np.linspace(90, -90, 721), np.arange(0, 360, 0.25))


class Recorder:
    def __init__(self):
        self.downloads: list[str] = []
        self.uploads: list[tuple[bytes, bytes]] = []
        self.sleeps: list[float] = []


def make_run(tmp_path: Path, *, download=None, decode=None, upload=None, current=None):
    rec = Recorder()

    def _download(url):
        rec.downloads.append(url)
        return b"GRIB" if download is None else download(url, len(rec.downloads))

    def _decode(data):
        return good_field() if decode is None else decode(data)

    def _upload(png, js):
        rec.uploads.append((png, js))
        if upload is not None:
            upload(png, js)

    code = run(
        NOW, download=_download, decode=_decode, upload=_upload,
        read_current=lambda: current, out_dir=tmp_path, sleep=rec.sleeps.append,
    )
    return code, rec


def test_happy_path_writes_files_and_uploads(tmp_path):
    code, rec = make_run(tmp_path)
    assert code == EXIT_OK
    assert len(rec.downloads) == 1 and "f008" in rec.downloads[0]
    assert (tmp_path / "latest.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    meta = json.loads((tmp_path / "latest.json").read_text())
    assert meta["run"] == FIRST_RUN and meta["forecast_hour"] == 8
    assert meta["stats"] == {"min_c": 15.0, "max_c": 15.0}
    assert len(rec.uploads) == 1
    png, js = rec.uploads[0]
    assert png == (tmp_path / "latest.png").read_bytes() and js == (tmp_path / "latest.json").read_bytes()


def test_404_moves_to_next_candidate(tmp_path):
    def download(url, n):
        if n == 1:
            raise nomads.NotFound(url)
        return b"GRIB"

    code, rec = make_run(tmp_path, download=download)
    assert code == EXIT_OK
    assert "f008" in rec.downloads[0] and "f014" in rec.downloads[1]
    assert rec.sleeps == []


def test_transient_error_retries_once_after_delay_then_next(tmp_path):
    def download(url, n):
        if n <= 2:
            raise nomads.TransientError("503")
        return b"GRIB"

    code, rec = make_run(tmp_path, download=download)
    assert code == EXIT_OK
    assert rec.downloads[0] == rec.downloads[1]      # retry du même candidat
    assert "f014" in rec.downloads[2]                 # puis le suivant
    assert rec.sleeps == [30]


def test_all_candidates_exhausted_is_exit_2(tmp_path):
    def download(url, n):
        raise nomads.NotFound(url)

    code, rec = make_run(tmp_path, download=download)
    assert code == EXIT_SOURCE
    assert len(rec.downloads) == 4
    assert rec.uploads == [] and not (tmp_path / "latest.png").exists()


def test_invalid_field_is_exit_3_without_upload(tmp_path):
    v = np.full((721, 1440), 288.15, np.float32)
    v[0, 0] = np.nan
    code, rec = make_run(tmp_path, decode=lambda data: Field(v, np.linspace(90, -90, 721), np.arange(0, 360, 0.25)))
    assert code == EXIT_DATA
    assert rec.uploads == [] and not (tmp_path / "latest.png").exists()


def test_decode_exception_is_exit_3(tmp_path):
    def decode(data):
        raise RuntimeError("Cannot find the ecCodes library")

    code, rec = make_run(tmp_path, decode=decode)
    assert code == EXIT_DATA
    assert len(rec.downloads) == 1  # pas de candidat suivant sur erreur de décodage


def test_upload_failure_is_exit_4_but_local_files_exist(tmp_path):
    def upload(png, js):
        raise PublishError("boom")

    code, rec = make_run(tmp_path, upload=upload)
    assert code == EXIT_PUBLISH
    assert (tmp_path / "latest.png").exists()


def test_already_published_is_noop_exit_0(tmp_path):
    code, rec = make_run(tmp_path, current={"run": FIRST_RUN, "forecast_hour": 8})
    assert code == EXIT_OK
    assert rec.downloads == [] and rec.uploads == []


def test_stale_published_metadata_does_not_block(tmp_path):
    code, rec = make_run(tmp_path, current={"run": FIRST_RUN, "forecast_hour": 7})
    assert code == EXIT_OK
    assert len(rec.downloads) == 1


def test_dry_run_when_upload_is_none(tmp_path):
    code = run(
        NOW, download=lambda url: b"GRIB", decode=lambda d: good_field(), upload=None,
        read_current=lambda: None, out_dir=tmp_path, sleep=lambda s: None,
    )
    assert code == EXIT_OK
    assert (tmp_path / "latest.json").exists()
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `.venv/Scripts/python -m pytest tests/pipeline/test_main.py -q`
Expected: erreur d'import.

- [ ] **Step 3 : Implémenter `pipeline/main.py` (partie `run`)**

```python
"""Orchestration (spec §3, §6). Les effets sont injectés : `run` se teste sans
réseau ni cfgrib. Règle : échouer bruyamment ou publier une texture valide,
jamais entre les deux."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from pipeline import config, nomads, publish, texture
from pipeline.grib_adapter import Field
from pipeline.metadata import build_metadata, iso_utc, to_json
from pipeline.run_selection import Candidate, candidates

log = logging.getLogger("pipeline")

EXIT_OK = 0
EXIT_SOURCE = 2    # aucun candidat téléchargeable
EXIT_DATA = 3      # décodage ou validation en échec — bug ou format changé
EXIT_PUBLISH = 4   # upload R2 en échec

Download = Callable[[str], bytes]
Decode = Callable[[bytes], Field]
Upload = Callable[[bytes, bytes], None]
ReadCurrent = Callable[[], "dict | None"]


def _fetch_first_available(cands: list[Candidate], download: Download, sleep: Callable[[float], None]) -> tuple[Candidate, bytes] | None:
    for c in cands:
        url = nomads.build_url(c)
        for attempt in (1, 2):
            try:
                data = download(url)
            except nomads.NotFound:
                log.info("absent : run %s f%03d", iso_utc(c.run), c.forecast_hour)
                break
            except nomads.TransientError as exc:
                log.warning("erreur transitoire (%s) : run %s f%03d, tentative %d", exc, iso_utc(c.run), c.forecast_hour, attempt)
                if attempt == 1:
                    sleep(config.RETRY_DELAY_S)
                continue
            log.info("téléchargé : run %s f%03d, %d octets", iso_utc(c.run), c.forecast_hour, len(data))
            return c, data
    return None


def _already_published(current: dict | None, c: Candidate) -> bool:
    return bool(current) and current.get("run") == iso_utc(c.run) and current.get("forecast_hour") == c.forecast_hour


def run(
    now: datetime,
    *,
    download: Download,
    decode: Decode,
    upload: Upload | None,
    read_current: ReadCurrent,
    out_dir: Path,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    cands = candidates(now)
    if not cands:
        log.error("aucun candidat pour %s", iso_utc(now))
        return EXIT_SOURCE

    if _already_published(read_current(), cands[0]):
        log.info("déjà publié : run %s f%03d", iso_utc(cands[0].run), cands[0].forecast_hour)
        return EXIT_OK

    got = _fetch_first_available(cands, download, sleep)
    if got is None:
        log.error("source indisponible : %d candidats épuisés", len(cands))
        return EXIT_SOURCE
    cand, data = got

    try:
        field = decode(data)
        texture.validate(field)
    except Exception as exc:
        log.error("données invalides : %s", exc)
        return EXIT_DATA

    celsius = texture.kelvin_to_celsius(texture.reorient(field.values))
    png = texture.encode_png(texture.quantize(celsius))
    meta_json = to_json(build_metadata(cand, celsius, generated_at=now))

    publish.write_atomic(out_dir / "latest.png", png)
    publish.write_atomic(out_dir / "latest.json", meta_json)
    log.info("écrit : %s (%d octets PNG)", out_dir, len(png))

    if upload is None:
        log.info("dry-run : pas d'upload")
        return EXIT_OK
    try:
        upload(png, meta_json)
    except publish.PublishError as exc:
        log.error("publication en échec : %s", exc)
        return EXIT_PUBLISH
    log.info("publié : run %s f%03d, valide %s", iso_utc(cand.run), cand.forecast_hour, iso_utc(cand.valid_time))
    return EXIT_OK
```

- [ ] **Step 4 : Vérifier le succès**

Run: `.venv/Scripts/python -m pytest tests/pipeline/test_main.py -q`
Expected: `10 passed`.

- [ ] **Step 5 : Commit**

```bash
git add pipeline/main.py tests/pipeline/test_main.py
git commit -m "feat(pipeline): orchestration avec effets injectés et codes retour"
```

---

### Task 9 : Ligne de commande (`main.main`) et vérification locale

**Files:**
- Modify: `pipeline/main.py` (ajouter `main` et `__main__`)

**Interfaces:**
- Produces: `main(argv: list[str] | None = None) -> int` ; options `--dry-run`, `--out PATH` (défaut `out`). `python -m pipeline.main`.

- [ ] **Step 1 : Ajouter le CLI à la fin de `pipeline/main.py`**

```python
def main(argv: list[str] | None = None) -> int:
    import argparse
    import sys
    from datetime import timezone

    from pipeline.grib_adapter import decode_grib

    parser = argparse.ArgumentParser(prog="pipeline", description="GFS TMP 2 m → latest.png + latest.json")
    parser.add_argument("--dry-run", action="store_true", help="générer out/ sans publier sur R2")
    parser.add_argument("--out", type=Path, default=Path("out"), help="dossier de sortie (défaut : out)")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)

    cfg = None if args.dry_run else publish.R2Config.from_env()
    if cfg is None:
        log.info("dry-run : aucun upload R2 (%s)", "--dry-run" if args.dry_run else "secrets R2 absents")

    return run(
        datetime.now(timezone.utc),
        download=nomads.download,
        decode=decode_grib,
        upload=(lambda png, js: publish.upload_r2(cfg, png, js)) if cfg else None,
        read_current=(lambda: publish.read_current(cfg)) if cfg else (lambda: None),
        out_dir=args.out,
    )


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2 : Lancer en local (échec attendu au décodage)**

Run: `.venv/Scripts/python -m pipeline.main --dry-run; echo "exit=$LASTEXITCODE"`
Expected : journal « dry-run », une ligne « téléchargé : run … », puis « données invalides : … ecCodes … » et `exit=3`. C'est le comportement documenté spec §5 : le poste Windows s'arrête au décodage. Si la ligne « téléchargé » n'apparaît pas (404 en série), vérifier la connectivité ou attendre.

- [ ] **Step 3 : Suite complète**

Run: `.venv/Scripts/python -m pytest -q`
Expected: `84 passed, 2 skipped` (30 history + 8 + 3 + 17 + 3 + 13 + 10 ; 2 skip GRIB).

- [ ] **Step 4 : Commit**

```bash
git add pipeline/main.py
git commit -m "feat(pipeline): ligne de commande python -m pipeline.main"
```

---

### Task 10 : Workflows GitHub Actions

**Files:**
- Create: `.github/workflows/test.yml`, `.github/workflows/pipeline.yml`

**Interfaces:**
- Consumes: `python -m pipeline.main [--dry-run]`, secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

- [ ] **Step 1 : Écrire `.github/workflows/test.yml`**

```yaml
name: test

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
          cache-dependency-path: |
            pipeline/requirements.txt
            pipeline/requirements-grib.txt
      - name: Dépendances (avec cfgrib/eccodes)
        run: pip install -r pipeline/requirements.txt -r pipeline/requirements-grib.txt pytest
      - name: Tests (niveaux 1 et 2)
        run: python -m pytest -v
      - name: Contrôle HISTORY.md
        run: python tools/history_check.py
      - name: Dry-run contre NOMADS réel
        run: python -m pipeline.main --dry-run
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: dry-run
          path: out/
          retention-days: 3
```

- [ ] **Step 2 : Écrire `.github/workflows/pipeline.yml`**

```yaml
name: pipeline

on:
  schedule:
    - cron: "12 * * * *"   # minute 12 : les crons à l'heure pile sont retardés ou sautés
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Générer sans publier sur R2"
        type: boolean
        default: false

concurrency:
  group: pipeline
  cancel-in-progress: false

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
          cache-dependency-path: |
            pipeline/requirements.txt
            pipeline/requirements-grib.txt
      - name: Dépendances
        run: pip install -r pipeline/requirements.txt -r pipeline/requirements-grib.txt
      - name: Pipeline
        env:
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
        run: python -m pipeline.main ${{ inputs.dry_run == true && '--dry-run' || '' }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: latest
          path: out/
          retention-days: 3
```

- [ ] **Step 3 : Commit et push de la branche**

```bash
git add .github/workflows/test.yml .github/workflows/pipeline.yml
git commit -m "ci: workflows test (CI) et pipeline (cron horaire)"
git push -u origin feat/pipeline-gfs
```

- [ ] **Step 4 : Observer `test.yml`**

Run: `gh run watch --exit-status` (ou `gh run list --workflow=test.yml --limit 1` puis `gh run view <id> --log-failed`).

Attendu : **`history_check` rouge** (dossiers `pipeline`, `fixtures` absents de HISTORY §3 — corrigé en Task 11) ; **tout le reste vert** : pytest avec les 2 tests GRIB **exécutés** (pas skipped), dry-run avec « téléchargé » puis « écrit » et exit 0, artefact `dry-run` présent.

Si `test_decode_real_gfs_file` échoue sur `KeyError: 't2m'` : ajouter dans `decode_grib` un `log.error("variables : %s", list(ds.data_vars))` temporaire, relancer, remplacer `"t2m"` par le nom trouvé, retirer le log.

- [ ] **Step 5 : Télécharger l'artefact et vérifier le PNG** (critère d'acceptation 3)

```bash
gh run download --name dry-run --dir out-ci
```

Ouvrir `out-ci/latest.png` : continents reconnaissables (Antarctique sombre en bas, Sahara/Arabie clairs, Groenland sombre en haut à gauche). `out-ci/latest.json` conforme à spec §4. Si la carte est décalée d'une demi-largeur (Amériques au centre), le roll est à revoir ; si le nord est en bas, `validate` aurait dû échouer — vérifier `lat[0]`.

---

### Task 11 : HISTORY.md, CI verte, merge

**Files:**
- Modify: `HISTORY.md` (§2, §3, §5, §7, §8, §9, pied de page)

- [ ] **Step 1 : Mettre à jour HISTORY.md via le skill `updating-history`** (dérive les sections du diff `master..HEAD`). Points obligatoires :
  - §2 : `boto3`, `pytest`, `requirements-grib.txt` Actions seulement ; Python 3.12 Actions / 3.14 local.
  - §3 : arbre avec `pipeline/` (tous les modules), `tests/pipeline/`, `tests/fixtures/gfs_tmp2m.grib2`, `.github/workflows/`, `pytest.ini`, `docs/superpowers/specs/`, `docs/superpowers/plans/`.
  - §5 : prévision valide à l'heure courante (vs analyse f000) ; idempotence via API S3 (pas de 5ᵉ secret) ; repo passé public le 2026-08-30 (minutes Actions).
  - §7 : ligne du plan `2026-08-30 | feat/pipeline-gfs | …`.
  - §8 : dette 3 → ✅ résolue par construction (`encoding` dans `latest.json`) ; dette 5 → ✅ résolue (`test.yml`) ; **nouvelle dette** : cron désactivé après 60 jours sans commit ; **nouvelle dette** : mise en place R2 à faire (Task 12).
  - §9 : entrée datée, `pytest` 84 passed / 2 skipped local, CI verte.

- [ ] **Step 2 : Vérifier**

Run: `.venv/Scripts/python tools/history_check.py && .venv/Scripts/python -m pytest -q`
Expected: `✓ HISTORY.md est à jour …` puis `84 passed, 2 skipped`.

- [ ] **Step 3 : Commit, push, CI verte**

```bash
git add HISTORY.md
git commit -m "docs(history): pipeline GFS livré, dettes 3 et 5 résolues"
git push
gh run watch --exit-status
```

Expected: `test.yml` entièrement vert.

- [ ] **Step 4 : Merge dans `master`** via `superpowers:finishing-a-development-branch`. Après merge, `pipeline.yml` se lance à la prochaine minute 12 en **dry-run implicite** (pas de secrets) : vérifier un run vert avec « secrets R2 absents » dans le journal.

---

### Task 12 : Mise en place R2 (manuel, utilisateur) et validation de bout en bout

Aucun code. Checklist spec §5 ; l'agent guide, l'utilisateur agit dans les dashboards.

- [ ] **Step 1 : Cloudflare → R2 → activer** (carte bancaire demandée, plan gratuit).
- [ ] **Step 2 : Créer le bucket `worldtemp`**, localisation automatique.
- [ ] **Step 3 : Accès public** : Settings → Public access → activer le sous-domaine `r2.dev`. Noter l'URL `https://pub-<hash>.r2.dev`.
- [ ] **Step 4 : CORS** du bucket :
```json
[{"AllowedOrigins": ["http://localhost:5173"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600}]
```
(ajouter l'origine Pages quand le site existera.)
- [ ] **Step 5 : API token R2** : R2 → Manage R2 API Tokens → Create : permission « Object Read & Write », bucket `worldtemp` seulement. Noter Access Key ID + Secret Access Key (affiché une fois) et l'Account ID (dans l'URL de l'endpoint S3 affichée).
- [ ] **Step 6 : Secrets GitHub** : `gh secret set R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (valeur `worldtemp`). Les saisir dans le terminal de l'utilisateur, jamais dans le chat.
- [ ] **Step 7 : Premier run réel** : `gh workflow run pipeline.yml` puis `gh run watch --exit-status`. Journal attendu : « latest.json non lu sur R2 » (première fois), « téléchargé », « écrit », « publié ».
- [ ] **Step 8 : Critère 4** : `curl -s https://pub-<hash>.r2.dev/gfs/latest.json` → `run`/`forecast_hour` cohérents avec l'heure UTC, `valid_time_utc` à moins d'une heure ; `curl -sI …/gfs/latest.png` → `content-type: image/png`, `cache-control: public, max-age=300`.
- [ ] **Step 9 : Critère 5** : relancer `gh workflow run pipeline.yml` dans la même heure → journal « déjà publié », exit 0, durée < 1 min.
- [ ] **Step 10 : Critère 6** : `gh secret set R2_SECRET_ACCESS_KEY` avec une valeur fausse, `gh workflow run pipeline.yml` → run rouge exit 4 ; `latest.json` sur R2 inchangé (`generated_at` identique). Remettre le vrai secret, relancer, vert.
- [ ] **Step 11 : HISTORY** : §8 dette « R2 à mettre en place » → ✅ ; §9 entrée « premier run réel publié le … ». Commit `docs(history): R2 en service`.

---

## Auto-revue du plan

**Couverture spec :** §2 modules → T1–T9 ; §3 sélection/URL/retry/idempotence → T2, T3, T8 ; §4 PNG/JSON/ordre/en-têtes → T5, T6, T7 ; §5 workflows, dry-run implicite, mise en place R2 → T9, T10, T12 ; §6 codes retour et table d'erreurs → T8 (tests 404/5xx/épuisé/NaN/décodage/upload) ; §7 trois niveaux de tests → T2–T8, T4 (skip), T10 ; §8 critères 1–2 → T9/T10, 3 → T10 step 5, 4–6 → T12 ; dettes HISTORY → T11.

**Écart assumé vs spec :** idempotence par `get_object` S3 (mêmes secrets) au lieu de l'URL publique. À reporter en §5 de HISTORY (T11).

**Cohérence des signatures :** `Candidate.valid_time` (T2) utilisée en T6/T8 ; `nomads.NotFound/TransientError` (T3) attrapées en T8 ; `Field` défini en T4, consommé en T5/T8 ; `texture.validate/reorient/kelvin_to_celsius/quantize/encode_png` (T5) appelées dans cet ordre en T8 ; `iso_utc` (T6) utilisée en T8 ; `publish.PublishError/write_atomic/R2Config/read_current/upload_r2` (T7) en T8/T9 ; `upload(png, meta_json)` deux positionnels partout.
