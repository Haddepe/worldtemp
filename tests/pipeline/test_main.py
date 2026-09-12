import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from pipeline import nomads, texture
from pipeline.grib_adapter import DecodeError, Field
from pipeline.layers import LAYERS, by_source, get
from pipeline.main import EXIT_DATA, EXIT_OK, EXIT_PUBLISH, EXIT_SOURCE, run
from pipeline.publish import PublishError

NOW = datetime(2026, 9, 12, 14, 40, tzinfo=timezone.utc)
GFS_RUN, GFS_FH = "2026-09-12T06:00:00Z", 8      # cible 14:00, délai 3 h 30 → run 06z
CHEM_RUN, CHEM_FH = "2026-09-12T06:00:00Z", 6    # cible 12:00 (pas 3 h), délai 5 h → run 06z
GFS_IDS = ["temp", "clouds", "rain", "pressure", "humidity"]
CHEM_IDS = ["pm25", "dust"]

# Valeurs brutes plausibles par couche (avant conversion).
RAW = {"temp": 288.15, "clouds": 40.0, "rain": 0.001, "pressure": 101325.0, "humidity": 55.0, "pm25": 12.0, "dust": 500.0}


def field(value):
    return Field(np.full((721, 1440), value, np.float32), np.linspace(90, -90, 721), np.arange(0, 360, 0.25))


def good_decode(data, specs):
    return {s.id: field(RAW[s.id]) for s in specs}


class Recorder:
    def __init__(self):
        self.downloads: list[str] = []
        self.uploads: list[list] = []
        self.sleeps: list[float] = []


def make_run(tmp_path: Path, *, download=None, decode=None, upload=None, current=None, upload_none=False):
    rec = Recorder()

    def _download(url):
        rec.downloads.append(url)
        return b"GRIB" if download is None else download(url, len(rec.downloads))

    def _decode(data, specs):
        return good_decode(data, specs) if decode is None else decode(data, specs)

    def _upload(objects):
        rec.uploads.append(list(objects))
        if upload is not None:
            upload(objects)

    code = run(
        NOW, download=_download, decode=_decode, upload=None if upload_none else _upload,
        read_current=lambda: current, out_dir=tmp_path, sleep=rec.sleeps.append,
    )
    return code, rec


def manifest_of(rec):
    keys = [o.key for o in rec.uploads[-1]]
    assert keys[-1] == "layers/latest.json"
    return json.loads(rec.uploads[-1][-1].body)


def current_manifest(gfs=(GFS_RUN, GFS_FH), chem=(CHEM_RUN, CHEM_FH), with_chem=True):
    layers = {}
    for lid in GFS_IDS:
        layers[lid] = {"run": gfs[0], "forecast_hour": gfs[1], "texture": f"{lid}.png", "generated_at": "2026-09-12T14:12:40Z",
                       "valid_time_utc": "2026-09-12T14:00:00Z", "model": "gfs_0p25", "variable": get(lid).variable, "unit": get(lid).unit,
                       "encoding": {"bits": 8, "min": get(lid).encoding.min, "max": get(lid).encoding.max, "scale": get(lid).encoding.scale},
                       "stats": {"min": 0.0, "max": 1.0}}
    if with_chem:
        for lid in CHEM_IDS:
            layers[lid] = {"run": chem[0], "forecast_hour": chem[1], "texture": f"{lid}.png", "generated_at": "2026-09-12T12:12:07Z",
                           "valid_time_utc": "2026-09-12T12:00:00Z", "model": "gefs_chem_0p25", "variable": get(lid).variable, "unit": get(lid).unit,
                           "encoding": {"bits": 8, "min": 0, "max": get(lid).encoding.max, "scale": "sqrt"}, "stats": {"min": 0.0, "max": 9.0}}
    return {"schema_version": 2, "generated_at": "2026-09-12T14:12:40Z", "grid": {}, "layers": layers}


# --- chemin nominal -----------------------------------------------------------

def test_happy_path_publishes_seven_layers_legacy_and_manifest_last(tmp_path):
    code, rec = make_run(tmp_path)
    assert code == EXIT_OK
    assert len(rec.downloads) == 2
    assert "filter_gfs_0p25_1hr" in rec.downloads[0] and "f008" in rec.downloads[0]
    assert "filter_gefs_chem_0p25" in rec.downloads[1] and "f006" in rec.downloads[1]
    keys = [o.key for o in rec.uploads[0]]
    assert keys == [f"layers/{i}.png" for i in GFS_IDS] + [f"layers/{i}.png" for i in CHEM_IDS] + [
        "gfs/latest.png", "gfs/latest.json", "layers/latest.json",
    ]
    m = manifest_of(rec)
    assert m["schema_version"] == 2 and list(m["layers"]) == [s.id for s in LAYERS]
    assert m["layers"]["temp"]["run"] == GFS_RUN and m["layers"]["temp"]["forecast_hour"] == GFS_FH
    assert m["layers"]["pm25"]["run"] == CHEM_RUN and m["layers"]["pm25"]["forecast_hour"] == CHEM_FH
    assert m["layers"]["temp"]["stats"] == {"min": 15.0, "max": 15.0}
    assert m["layers"]["rain"]["stats"] == {"min": 3.6, "max": 3.6}
    for o in rec.uploads[0]:
        assert (tmp_path / o.key).read_bytes() == o.body
    legacy = json.loads((tmp_path / "gfs/latest.json").read_text())
    assert legacy["schema_version"] == 1 and legacy["encoding"] == {"bits": 8, "min_c": -90, "max_c": 60}
    assert (tmp_path / "gfs/latest.png").read_bytes() == (tmp_path / "layers/temp.png").read_bytes()


def test_run_applies_longitude_roll_on_each_layer(tmp_path):
    ramp_row = 273.15 + np.arange(1440, dtype=np.float32) / 1440 * 50
    values = np.tile(ramp_row, (721, 1)).astype(np.float32)

    def decode(data, specs):
        out = good_decode(data, specs)
        if "temp" in out:
            out["temp"] = Field(values, np.linspace(90, -90, 721), np.arange(0, 360, 0.25))
        return out

    code, rec = make_run(tmp_path, decode=decode)
    assert code == EXIT_OK
    pixels = np.array(Image.open(tmp_path / "layers/temp.png"))
    enc = get("temp").encoding
    # Le pipeline convertit en float64 avant de soustraire 273.15 (layer_pixels) ;
    # on reproduit ce chemin ici pour ne pas comparer à un calcul float32 (NEP 50).
    assert pixels[0, 720] == texture.quantize(ramp_row[0:1].astype(np.float64) - 273.15, enc)[0]
    assert pixels[0, 0] == texture.quantize(ramp_row[720:721].astype(np.float64) - 273.15, enc)[0]


# --- source primaire : comportement inchangé -----------------------------------

def test_gfs_404_moves_to_next_candidate(tmp_path):
    def download(url, n):
        if n == 1:
            raise nomads.NotFound(url)
        return b"GRIB"

    code, rec = make_run(tmp_path, download=download)
    assert code == EXIT_OK
    assert "f008" in rec.downloads[0] and "f014" in rec.downloads[1] and "gefs_chem" in rec.downloads[2]
    assert rec.sleeps == []


def test_gfs_transient_error_retries_once_after_delay_then_next(tmp_path):
    def download(url, n):
        if n <= 2:
            raise nomads.TransientError("503")
        return b"GRIB"

    code, rec = make_run(tmp_path, download=download)
    assert code == EXIT_OK
    assert rec.downloads[0] == rec.downloads[1] and "f014" in rec.downloads[2]
    assert rec.sleeps == [30]


def test_gfs_all_candidates_exhausted_is_exit_2_and_chem_not_even_tried(tmp_path):
    def download(url, n):
        raise nomads.NotFound(url)

    code, rec = make_run(tmp_path, download=download)
    assert code == EXIT_SOURCE
    assert len(rec.downloads) == 4 and all("filter_gfs" in u for u in rec.downloads)
    assert rec.uploads == [] and not (tmp_path / "layers").exists()


def test_gfs_invalid_field_is_exit_3_without_upload(tmp_path):
    def decode(data, specs):
        out = good_decode(data, specs)
        if "clouds" in out:
            v = np.full((721, 1440), 40.0, np.float32)
            v[0, 0] = np.nan
            out["clouds"] = Field(v, np.linspace(90, -90, 721), np.arange(0, 360, 0.25))
        return out

    code, rec = make_run(tmp_path, decode=decode)
    assert code == EXIT_DATA
    assert rec.uploads == [] and not (tmp_path / "layers").exists()


def test_gfs_decode_error_is_exit_3(tmp_path):
    def decode(data, specs):
        raise DecodeError("champs absents du fichier : ['clouds']")

    code, rec = make_run(tmp_path, decode=decode)
    assert code == EXIT_DATA
    assert len(rec.downloads) == 1


def test_upload_failure_is_exit_4_but_local_files_exist(tmp_path):
    def upload(objects):
        raise PublishError("boom")

    code, rec = make_run(tmp_path, upload=upload)
    assert code == EXIT_PUBLISH
    assert (tmp_path / "layers/latest.json").exists()


# --- source secondaire : tolérance -------------------------------------------

def test_chem_failure_carries_over_previous_entries(tmp_path):
    def download(url, n):
        if "gefs_chem" in url:
            raise nomads.NotFound(url)
        return b"GRIB"

    # GFS et chem périmés : GFS retéléchargé avec succès, chem retenté puis reporté.
    cur = current_manifest(gfs=("2026-09-12T00:00:00Z", 14), chem=("2026-09-12T00:00:00Z", 12))
    code, rec = make_run(tmp_path, download=download, current=cur)
    assert code == EXIT_OK
    keys = [o.key for o in rec.uploads[0]]
    assert "layers/pm25.png" not in keys and "layers/dust.png" not in keys
    m = manifest_of(rec)
    assert m["layers"]["pm25"] == cur["layers"]["pm25"] and m["layers"]["dust"] == cur["layers"]["dust"]
    assert m["layers"]["temp"]["run"] == GFS_RUN
    assert sum("gefs_chem" in u for u in rec.downloads) == 4  # 4 candidats épuisés, puis report


def test_chem_decode_error_carries_over_too(tmp_path):
    def decode(data, specs):
        if specs and specs[0].source == "gefs_chem":
            raise DecodeError("pm25 : plusieurs messages correspondent")
        return good_decode(data, specs)

    cur = current_manifest(gfs=("2026-09-12T00:00:00Z", 14))
    code, rec = make_run(tmp_path, decode=decode, current=cur)
    assert code == EXIT_OK
    assert manifest_of(rec)["layers"]["dust"] == cur["layers"]["dust"]


def test_chem_failure_without_current_manifest_omits_chem_layers(tmp_path):
    def download(url, n):
        if "gefs_chem" in url:
            raise nomads.TransientError("503")
        return b"GRIB"

    code, rec = make_run(tmp_path, download=download, current=None)
    assert code == EXIT_OK
    assert list(manifest_of(rec)["layers"]) == GFS_IDS
    assert rec.sleeps == [30] * 4  # un retry par candidat chem


# --- idempotence par source ----------------------------------------------------

def test_everything_already_published_is_noop(tmp_path):
    code, rec = make_run(tmp_path, current=current_manifest())
    assert code == EXIT_OK
    assert rec.downloads == [] and rec.uploads == []


def test_only_gfs_stale_republishes_gfs_and_reuses_chem_entries(tmp_path):
    cur = current_manifest(gfs=("2026-09-12T06:00:00Z", 7))
    code, rec = make_run(tmp_path, current=cur)
    assert code == EXIT_OK
    assert len(rec.downloads) == 1 and "filter_gfs" in rec.downloads[0]
    keys = [o.key for o in rec.uploads[0]]
    assert keys == [f"layers/{i}.png" for i in GFS_IDS] + ["gfs/latest.png", "gfs/latest.json", "layers/latest.json"]
    assert manifest_of(rec)["layers"]["pm25"] == cur["layers"]["pm25"]


def test_only_chem_stale_republishes_chem_without_legacy(tmp_path):
    cur = current_manifest(chem=("2026-09-12T00:00:00Z", 12))
    code, rec = make_run(tmp_path, current=cur)
    assert code == EXIT_OK
    assert len(rec.downloads) == 1 and "gefs_chem" in rec.downloads[0]
    keys = [o.key for o in rec.uploads[0]]
    assert keys == ["layers/pm25.png", "layers/dust.png", "layers/latest.json"]
    assert manifest_of(rec)["layers"]["temp"] == cur["layers"]["temp"]


def test_partial_current_manifest_is_not_up_to_date(tmp_path):
    cur = current_manifest()
    del cur["layers"]["rain"]
    code, rec = make_run(tmp_path, current=cur)
    assert code == EXIT_OK
    assert any("filter_gfs" in u for u in rec.downloads)


def test_dry_run_when_upload_is_none(tmp_path):
    code, rec = make_run(tmp_path, upload_none=True)
    assert code == EXIT_OK
    assert (tmp_path / "layers/latest.json").exists() and rec.uploads == []
