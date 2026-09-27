import io
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from pipeline import config, nomads, texture
from pipeline.grib_adapter import DecodeError, Field
from pipeline.layers import LAYERS, get
from pipeline.main import EXIT_DATA, EXIT_OK, EXIT_PUBLISH, EXIT_SOURCE, main, run
from pipeline.publish import RUN_DIR, PublishError

NOW = datetime(2026, 9, 12, 14, 40, tzinfo=timezone.utc)  # GFS : 11:10 → run 06z ; chem : 09:40 → run 06z
HOURS = (3, 6)                                            # frise courte : les tests restent rapides
R06, R00 = "2026-09-12T06:00:00Z", "2026-09-12T00:00:00Z"
D06, D00 = "20260912T06Z", "20260912T00Z"
GFS_IDS = ["temp", "clouds", "rain", "pressure", "humidity", "wind_u", "wind_v"]
CHEM_IDS = ["pm25", "dust"]

# Valeurs brutes plausibles par couche (avant conversion).
RAW = {"temp": 288.15, "clouds": 40.0, "rain": 0.001, "pressure": 101325.0, "humidity": 55.0,
       "wind_u": -3.5, "wind_v": 7.25, "pm25": 12.0, "dust": 500.0}


def field(value):
    return Field(np.full((721, 1440), value, np.float32), np.linspace(90, -90, 721), np.arange(0, 360, 0.25))


def good_decode(data, specs):
    return {s.id: field(RAW[s.id]) for s in specs}


class FakeStore:
    """Store en mémoire, même contrat que publish.R2Store."""

    def __init__(self, fail_on: str | None = None):
        self.objects: dict[str, bytes] = {}
        self.cache: dict[str, str] = {}
        self.puts: list[list[str]] = []
        self.deleted: list[str] = []
        self.fail_on = fail_on

    def get_json(self, key):
        body = self.objects.get(key)
        return json.loads(body) if body is not None else None

    def put(self, objects):
        self.puts.append([o.key for o in objects])
        for o in objects:
            if o.key == self.fail_on:
                raise PublishError(f"{o.key} : boom")
            self.objects[o.key] = o.body
            self.cache[o.key] = o.cache_control

    def list_run_dirs(self):
        return sorted({k.split("/")[1] for k in self.objects if k.count("/") == 2 and RUN_DIR.match(k.split("/")[1])})

    def delete_run_dirs(self, names):
        doomed = [k for k in self.objects if k.count("/") == 2 and k.split("/")[1] in names]
        for k in doomed:
            del self.objects[k]
        self.deleted.extend(names)
        return len(doomed)


class Recorder:
    def __init__(self):
        self.downloads: list[str] = []
        self.sleeps: list[float] = []


def make_run(tmp_path: Path, *, download=None, decode=None, store=None, hours=HOURS):
    rec = Recorder()
    store = store if store is not None else FakeStore()

    def _download(url):
        rec.downloads.append(url)
        return b"GRIB" if download is None else download(url, len(rec.downloads))

    def _decode(data, specs):
        return good_decode(data, specs) if decode is None else decode(data, specs)

    code = run(NOW, download=_download, decode=_decode, store=store, out_dir=tmp_path, hours=hours, sleep=rec.sleeps.append)
    return code, rec, store


def not_found_when(*parts):
    """NOMADS répond 404 aux URL qui contiennent toutes les `parts`."""
    def download(url, n):
        if all(p in url for p in parts):
            raise nomads.NotFound(url)
        return b"GRIB"
    return download


def manifest_of(store):
    return json.loads(store.objects[config.FORECAST_KEY])


def published(gfs_run=R06, chem_run=R06, hours=HOURS, with_chem=True) -> dict:
    """Manifeste v3 déjà publié, frises complètes."""
    def entry(lid, model, run_iso):
        d = f"{run_iso[:4]}{run_iso[5:7]}{run_iso[8:10]}T{run_iso[11:13]}Z"
        enc = get(lid).encoding
        return {"model": model, "variable": get(lid).variable, "unit": get(lid).unit, "run": run_iso,
                "generated_at": "2026-09-12T12:12:00Z",
                "encoding": {"bits": 8, "min": enc.min, "max": enc.max, "scale": enc.scale},
                "frames": [{"forecast_hour": fh, "valid_time_utc": "2026-09-12T12:00:00Z",
                            "texture": f"{d}/{lid}_f{fh:03d}.png", "stats": {"min": 0.0, "max": 1.0}} for fh in hours]}
    layers = {lid: entry(lid, "gfs_0p25", gfs_run) for lid in GFS_IDS}
    if with_chem:
        layers.update({lid: entry(lid, "gefs_chem_0p25", chem_run) for lid in CHEM_IDS})
    return {"schema_version": 3, "generated_at": "2026-09-12T12:12:00Z", "grid": {}, "layers": layers}


def store_with(manifest=None, extra=()) -> FakeStore:
    s = FakeStore()
    if manifest is not None:
        s.objects[config.FORECAST_KEY] = json.dumps(manifest).encode()
    for k in extra:
        s.objects[k] = b"x"
    return s


# --- chemin nominal -----------------------------------------------------------

def test_happy_path_publishes_every_frame_then_manifest_last(tmp_path):
    code, rec, store = make_run(tmp_path)
    assert code == EXIT_OK
    assert len(rec.downloads) == 4
    assert "filter_gfs_0p25_1hr" in rec.downloads[0] and "f003" in rec.downloads[0] and "f006" in rec.downloads[1]
    assert "filter_gefs_chem_0p25" in rec.downloads[2] and "f003" in rec.downloads[2] and "f006" in rec.downloads[3]
    assert store.puts[0] == [f"layers/{D06}/{i}_f003.png" for i in GFS_IDS] + [f"layers/{D06}/gfs.json"]
    assert store.puts[-1] == [config.FORECAST_KEY]
    assert all(store.cache[k] == config.CACHE_IMMUTABLE for k in store.objects if k.endswith(".png"))
    assert store.cache[config.FORECAST_KEY] == config.CACHE_CONTROL
    m = manifest_of(store)
    assert m["schema_version"] == 3 and list(m["layers"]) == [s.id for s in LAYERS]
    temp = m["layers"]["temp"]
    assert temp["run"] == R06 and temp["model"] == "gfs_0p25" and temp["generated_at"] == "2026-09-12T14:40:00Z"
    assert temp["encoding"] == {"bits": 8, "min": -90, "max": 60, "scale": "linear"}
    assert temp["frames"] == [
        {"forecast_hour": 3, "valid_time_utc": "2026-09-12T09:00:00Z", "texture": f"{D06}/temp_f003.png", "stats": {"min": 15.0, "max": 15.0}},
        {"forecast_hour": 6, "valid_time_utc": "2026-09-12T12:00:00Z", "texture": f"{D06}/temp_f006.png", "stats": {"min": 15.0, "max": 15.0}},
    ]
    assert m["layers"]["rain"]["frames"][0]["stats"] == {"min": 3.6, "max": 3.6}
    assert m["layers"]["pm25"]["run"] == R06 and m["layers"]["pm25"]["encoding"]["scale"] == "sqrt"
    assert (tmp_path / config.FORECAST_KEY).read_bytes() == store.objects[config.FORECAST_KEY]


def test_progress_file_records_stats_of_each_published_frame(tmp_path):
    _, _, store = make_run(tmp_path)
    p = json.loads(store.objects[f"layers/{D06}/gfs.json"])
    assert p["run"] == R06 and p["source"] == "gfs"
    assert sorted(p["stats"]) == ["3", "6"] and p["stats"]["6"]["temp"] == {"min": 15.0, "max": 15.0}
    assert sorted(json.loads(store.objects[f"layers/{D06}/gefs_chem.json"])["stats"]["3"]) == ["dust", "pm25"]


def test_never_writes_legacy_keys(tmp_path):
    _, _, store = make_run(tmp_path)
    assert "layers/latest.json" not in store.objects
    assert not any(k == f"layers/{i}.png" for i in GFS_IDS + CHEM_IDS for k in store.objects)


def test_each_frame_applies_longitude_roll(tmp_path):
    ramp_row = 273.15 + np.arange(1440, dtype=np.float32) / 1440 * 50
    values = np.tile(ramp_row, (721, 1)).astype(np.float32)

    def decode(data, specs):
        out = good_decode(data, specs)
        if "temp" in out:
            out["temp"] = Field(values, np.linspace(90, -90, 721), np.arange(0, 360, 0.25))
        return out

    code, _, store = make_run(tmp_path, decode=decode)
    assert code == EXIT_OK
    pixels = np.array(Image.open(io.BytesIO(store.objects[f"layers/{D06}/temp_f003.png"])))
    enc = get("temp").encoding
    # Même chemin float64 que layer_pixels (NEP 50), voir l'ancien test de roulis.
    assert pixels[0, 720] == texture.quantize(ramp_row[0:1].astype(np.float64) - 273.15, enc)[0]
    assert pixels[0, 0] == texture.quantize(ramp_row[720:721].astype(np.float64) - 273.15, enc)[0]


# --- reprise et bascule -------------------------------------------------------

def test_resume_downloads_only_missing_frames(tmp_path):
    store = FakeStore()
    code, _, _ = make_run(tmp_path, store=store, download=not_found_when("filter_gfs", "t06z", "f006"))
    assert code == EXIT_OK and manifest_of(store)["layers"]["temp"]["run"] == R00  # 1er déploiement : 06z incomplet → 00z
    assert f"layers/{D06}/temp_f003.png" in store.objects                          # f003 de 06z attend la reprise
    code, rec, _ = make_run(tmp_path, store=store)
    gfs = [u for u in rec.downloads if "filter_gfs" in u]
    assert code == EXIT_OK and len(gfs) == 1 and "t06z" in gfs[0] and "f006" in gfs[0]
    assert manifest_of(store)["layers"]["temp"]["run"] == R06


def test_incomplete_new_run_keeps_published_run(tmp_path):
    store = store_with(published(gfs_run=R00))
    code, rec, _ = make_run(tmp_path, store=store, download=not_found_when("filter_gfs", "t06z", "f003"))
    assert code == EXIT_OK
    assert len(rec.downloads) == 1 and "t06z" in rec.downloads[0]  # pas de repli sur un run plus ancien
    assert all(config.FORECAST_KEY not in put for put in store.puts)  # chem déjà à jour : rien de neuf


def test_everything_already_published_is_noop(tmp_path):
    store = store_with(published())
    code, rec, _ = make_run(tmp_path, store=store)
    assert code == EXIT_OK and rec.downloads == [] and store.puts == []


def test_no_complete_run_anywhere_is_exit_2_and_chem_not_tried(tmp_path):
    code, rec, store = make_run(tmp_path, download=not_found_when("filter_gfs"))
    assert code == EXIT_SOURCE
    assert len(rec.downloads) == 4 and all("filter_gfs" in u and "f003" in u for u in rec.downloads)
    assert store.puts == []


def test_transient_errors_twice_count_as_absent(tmp_path):
    def download(url, n):
        if n <= 2:
            raise nomads.TransientError("503")
        return b"GRIB"

    code, rec, store = make_run(tmp_path, download=download)
    assert code == EXIT_OK and rec.sleeps == [30]
    assert rec.downloads[0] == rec.downloads[1] and "t06z" in rec.downloads[0]
    assert manifest_of(store)["layers"]["temp"]["run"] == R00  # 06z abandonné pour ce passage, 00z complet


def test_v2_manifest_is_ignored(tmp_path):
    store = FakeStore()
    store.objects[config.FORECAST_KEY] = json.dumps({"schema_version": 2, "layers": {}}).encode()
    code, rec, _ = make_run(tmp_path, store=store)
    assert code == EXIT_OK and len(rec.downloads) == 4


# --- données et publication en échec --------------------------------------------

def test_invalid_field_is_exit_3_and_nothing_published(tmp_path):
    def decode(data, specs):
        out = good_decode(data, specs)
        if "clouds" in out:
            v = np.full((721, 1440), 40.0, np.float32)
            v[0, 0] = np.nan
            out["clouds"] = Field(v, np.linspace(90, -90, 721), np.arange(0, 360, 0.25))
        return out

    code, rec, store = make_run(tmp_path, decode=decode)
    assert code == EXIT_DATA and store.puts == [] and len(rec.downloads) == 1


def test_decode_error_is_exit_3(tmp_path):
    def decode(data, specs):
        raise DecodeError("champs absents du fichier : ['clouds']")

    code, rec, _ = make_run(tmp_path, decode=decode)
    assert code == EXIT_DATA and len(rec.downloads) == 1


def test_frame_upload_failure_is_exit_4(tmp_path):
    code, _, store = make_run(tmp_path, store=FakeStore(fail_on=f"layers/{D06}/temp_f003.png"))
    assert code == EXIT_PUBLISH and config.FORECAST_KEY not in store.objects


def test_progress_upload_failure_leaves_frame_to_redo(tmp_path):
    store = FakeStore(fail_on=f"layers/{D06}/gfs.json")
    code, _, _ = make_run(tmp_path, store=store)
    assert code == EXIT_PUBLISH
    assert f"layers/{D06}/temp_f003.png" in store.objects and f"layers/{D06}/gfs.json" not in store.objects
    store.fail_on = None
    code, rec, _ = make_run(tmp_path, store=store)
    assert code == EXIT_OK
    assert sum("filter_gfs" in u and "f003" in u for u in rec.downloads) == 1  # la progression ne citait pas f003


def test_manifest_upload_failure_is_exit_4_with_local_copy(tmp_path):
    code, _, _ = make_run(tmp_path, store=FakeStore(fail_on=config.FORECAST_KEY))
    assert code == EXIT_PUBLISH and (tmp_path / config.FORECAST_KEY).exists()


# --- source secondaire : tolérance ----------------------------------------------

def test_chem_absent_keeps_published_chem_run(tmp_path):
    store = store_with(published(gfs_run=R00, chem_run=R00))
    code, rec, _ = make_run(tmp_path, store=store, download=not_found_when("gefs_chem"))
    m = manifest_of(store)
    assert code == EXIT_OK and m["layers"]["temp"]["run"] == R06 and m["layers"]["pm25"]["run"] == R00
    assert sum("gefs_chem" in u for u in rec.downloads) == 1


def test_chem_decode_error_carries_over(tmp_path):
    before = published(gfs_run=R00, chem_run=R00)

    def decode(data, specs):
        if specs and specs[0].source == "gefs_chem":
            raise DecodeError("pm25 : plusieurs messages correspondent")
        return good_decode(data, specs)

    code, _, store = make_run(tmp_path, store=store_with(before), decode=decode)
    assert code == EXIT_OK and manifest_of(store)["layers"]["dust"] == before["layers"]["dust"]


def test_chem_failure_without_manifest_omits_chem_layers(tmp_path):
    code, rec, store = make_run(tmp_path, download=not_found_when("gefs_chem"))
    assert code == EXIT_OK and list(manifest_of(store)["layers"]) == GFS_IDS
    assert sum("gefs_chem" in u for u in rec.downloads) == 4  # chaque run candidat essayé, rien à reporter


# --- CLI ------------------------------------------------------------------------

def test_max_frames_is_refused_outside_dry_run(monkeypatch):
    for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.setenv(k, "x")
    with pytest.raises(SystemExit) as e:
        main(["--max-frames", "1"])
    assert e.value.code == 2


# --- rétention (spec lot E §4.3) -------------------------------------------------

def test_retention_deletes_runs_neither_cited_nor_newer(tmp_path):
    extra = [f"layers/{d}/temp_f003.png" for d in ("20260911T12Z", "20260911T18Z", D00, "20260912T12Z")]
    store = store_with(published(gfs_run=R00, chem_run=R00), extra)
    code, _, _ = make_run(tmp_path, store=store)
    assert code == EXIT_OK and manifest_of(store)["layers"]["temp"]["run"] == R06
    assert store.deleted == ["20260911T12Z", "20260911T18Z"]
    assert f"layers/{D00}/temp_f003.png" in store.objects           # cité par l'ancien manifeste (CDN ≤ 300 s)
    assert "layers/20260912T12Z/temp_f003.png" in store.objects     # plus récent : run en cours de téléchargement


def test_retention_never_touches_legacy_keys(tmp_path):
    store = store_with(published(gfs_run=R00, chem_run=R00), ["layers/latest.json", "layers/temp.png"])
    make_run(tmp_path, store=store)
    assert "layers/latest.json" in store.objects and "layers/temp.png" in store.objects


def test_retention_failure_is_not_fatal(tmp_path):
    store = store_with(published(gfs_run=R00, chem_run=R00))

    def boom():
        raise RuntimeError("list en échec")

    store.list_run_dirs = boom
    code, _, _ = make_run(tmp_path, store=store)
    assert code == EXIT_OK and manifest_of(store)["layers"]["temp"]["run"] == R06


def test_no_retention_without_publication(tmp_path):
    store = store_with(published(), ["layers/20260911T12Z/temp_f003.png"])
    make_run(tmp_path, store=store)
    assert store.deleted == []
