import io
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from pipeline import config, nomads, snow, texture
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
SNOW_IDS = ["snowfall", "snow_depth"]

# Valeurs brutes plausibles par couche (avant conversion). Neige : APCP continu 2 mm, SNOD 0,3 m,
# CPOFP 100 % (entrée du calcul des chutes, jamais publiée).
RAW = {"temp": 288.15, "clouds": 40.0, "rain": 0.001, "pressure": 101325.0, "humidity": 55.0,
       "wind_u": -3.5, "wind_v": 7.25, "pm25": 12.0, "dust": 500.0,
       "snowfall": 2.0, "snow_depth": 0.3, "cpofp": 100.0}


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

    def get_bytes(self, key):
        return self.objects.get(key)

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


def is_gfs(url):
    """Téléchargement de la source gfs (le flux gfs_snow lit les mêmes fichiers NOMADS)."""
    return "filter_gfs" in url and "var_TMP" in url


def is_snow(url):
    return "var_CPOFP" in url


def manifest_of(store):
    return json.loads(store.objects[config.FORECAST_KEY])


def published(gfs_run=R06, chem_run=R06, hours=HOURS, with_chem=True, with_snow=True, snow_run=None) -> dict:
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
    if with_snow:
        layers.update({lid: entry(lid, "gfs_0p25", snow_run or gfs_run) for lid in SNOW_IDS})
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
    assert len(rec.downloads) == 6
    assert "filter_gfs_0p25_1hr" in rec.downloads[0] and "f003" in rec.downloads[0] and "f006" in rec.downloads[1]
    assert "filter_gefs_chem_0p25" in rec.downloads[2] and "f003" in rec.downloads[2] and "f006" in rec.downloads[3]
    assert all(is_snow(u) for u in rec.downloads[4:]) and "f003" in rec.downloads[4] and "f006" in rec.downloads[5]
    assert store.puts[0] == [f"layers/{D06}/{i}_f003.png" for i in GFS_IDS] + [f"layers/{D06}/gfs.json"]
    assert store.puts[2] == [f"layers/{D06}/{i}_f003.png" for i in CHEM_IDS] + [f"layers/{D06}/gefs_chem.json"]
    # gfs_snow après gefs_chem ; par échéance : PNG, état, progression.
    assert store.puts[4] == [f"layers/{D06}/{i}_f003.png" for i in SNOW_IDS] + [snow.state_key(datetime(2026, 9, 12, 6, tzinfo=timezone.utc)), f"layers/{D06}/gfs_snow.json"]
    assert len(store.puts) == 7 and store.puts[-1] == [config.FORECAST_KEY]
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
    assert not any(k == f"layers/{i}.png" for i in GFS_IDS + CHEM_IDS + SNOW_IDS for k in store.objects)
    assert not any("cpofp" in k for k in store.objects)  # entrée du calcul, jamais publiée


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
    gfs = [u for u in rec.downloads if is_gfs(u)]
    assert code == EXIT_OK and len(gfs) == 1 and "t06z" in gfs[0] and "f006" in gfs[0]
    assert manifest_of(store)["layers"]["temp"]["run"] == R06


def test_incomplete_new_run_keeps_published_run(tmp_path):
    store = store_with(published(gfs_run=R00))
    code, rec, _ = make_run(tmp_path, store=store, download=not_found_when("filter_gfs", "t06z", "f003"))
    assert code == EXIT_OK
    # gfs et gfs_snow (mêmes fichiers) : 00z est le run publié, pas de repli plus loin.
    assert [is_gfs(u) for u in rec.downloads] == [True, False] and all("t06z" in u for u in rec.downloads)
    assert is_snow(rec.downloads[1])
    assert all(config.FORECAST_KEY not in put for put in store.puts)  # chem déjà à jour : rien de neuf


def test_incomplete_new_run_falls_back_to_complete_run_newer_than_published(tmp_path):
    # Cron GitHub sauté : le manifeste cite encore 18z la veille, 06z est incomplet, 00z complet.
    store = store_with(published(gfs_run="2026-09-11T18:00:00Z"))
    code, rec, _ = make_run(tmp_path, store=store, download=not_found_when("filter_gfs", "t06z", "f006"))
    assert code == EXIT_OK
    assert manifest_of(store)["layers"]["temp"]["run"] == R00
    assert f"layers/{D06}/temp_f003.png" in store.objects  # f003 de 06z garde sa place pour la reprise
    gfs = [u for u in rec.downloads if is_gfs(u)]
    assert not any("20260911" in u for u in gfs)  # rien plus ancien que le run publié


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
    assert code == EXIT_OK and len(rec.downloads) == 6


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
    assert sum(is_gfs(u) and "f003" in u for u in rec.downloads) == 1  # la progression ne citait pas f003


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
    assert code == EXIT_OK and list(manifest_of(store)["layers"]) == GFS_IDS + SNOW_IDS
    assert sum("gefs_chem" in u for u in rec.downloads) == 4  # chaque run candidat essayé, rien à reporter


# --- neige : source dérivée gfs_snow (spec R5a §6) -------------------------------

RUN06 = datetime(2026, 9, 12, 6, tzinfo=timezone.utc)
RUN00 = datetime(2026, 9, 12, 0, tzinfo=timezone.utc)
APCP_BY_FH = {3: 2.0, 6: 6.0}  # APCP continu (mm) : 2 mm à f003, 6 mm cumulés à f006


def url_download(url, n):
    return url.encode()  # le « GRIB » porte son URL : le décodage factice y lit l'échéance


def apcp_decode(data, specs):
    """APCP continu qui croît avec l'échéance ; le run 00z diffère du 06z (états non interchangeables)."""
    out = good_decode(data, specs)
    if "snowfall" in out:
        fh = int(data.split(b".f")[-1][:3])
        bonus = 1.0 if b"t00z" in data else 0.0
        out["snowfall"] = field(APCP_BY_FH[fh] + bonus)
    return out


def snow_png(store, fh, run_dir=D06):
    return store.objects[f"layers/{run_dir}/snowfall_f{fh:03d}.png"]


def single_pass_pngs(tmp_path):
    _, _, ref = make_run(tmp_path, download=url_download, decode=apcp_decode)
    return {fh: snow_png(ref, fh) for fh in HOURS}


def interrupted_store(tmp_path):
    """Passage 1 : f006 du 06z pas encore sur NOMADS pour la neige → f003 publié avec son état."""
    def download(url, n):
        if is_snow(url) and "t06z" in url and "f006" in url:
            raise nomads.NotFound(url)
        return url.encode()

    code, _, store = make_run(tmp_path, download=download, decode=apcp_decode)
    assert code == EXIT_OK
    assert snow.state_key(RUN06) in store.objects and f"layers/{D06}/snowfall_f006.png" not in store.objects
    assert manifest_of(store)["layers"]["snowfall"]["run"] == R00  # repli sur 00z complet
    return store


def test_snow_layers_published_with_their_own_progress(tmp_path):
    code, _, store = make_run(tmp_path)
    assert code == EXIT_OK
    p = json.loads(store.objects[f"layers/{D06}/gfs_snow.json"])
    assert p["source"] == "gfs_snow" and sorted(p["stats"]) == ["3", "6"] and sorted(p["stats"]["3"]) == sorted(SNOW_IDS)
    assert snow.state_key(RUN06) in store.objects
    assert store.cache[snow.state_key(RUN06)] == config.CACHE_CONTROL  # réécrit à chaque échéance : pas immuable
    m = manifest_of(store)["layers"]
    assert m["snowfall"]["model"] == "gfs_0p25" and m["snow_depth"]["model"] == "gfs_0p25"
    assert m["snow_depth"]["frames"][0]["stats"] == {"min": 30.0, "max": 30.0}  # 0,3 m → 30 cm


def test_snowfall_png_is_cumulative(tmp_path):
    code, _, store = make_run(tmp_path, download=url_download, decode=apcp_decode)
    assert code == EXIT_OK
    enc = get("snowfall").encoding
    for fh, cm in ((3, 2.0), (6, 6.0)):  # CPOFP 100 %, 10:1 : 1 mm → 1 cm
        px = np.array(Image.open(io.BytesIO(snow_png(store, fh))))
        assert (px == texture.quantize(np.array([cm]), enc)[0]).all(), fh
    stats = manifest_of(store)["layers"]["snowfall"]["frames"]
    assert [f["stats"] for f in stats] == [{"min": 2.0, "max": 2.0}, {"min": 6.0, "max": 6.0}]


def test_snow_resume_equals_single_pass(tmp_path):
    ref = single_pass_pngs(tmp_path / "ref")
    store = interrupted_store(tmp_path)
    code, rec, _ = make_run(tmp_path, store=store, download=url_download, decode=apcp_decode)
    assert code == EXIT_OK
    snow_dl = [u for u in rec.downloads if is_snow(u)]
    assert len(snow_dl) == 1 and "t06z" in snow_dl[0] and "f006" in snow_dl[0]  # f003 repris depuis l'état
    assert manifest_of(store)["layers"]["snowfall"]["run"] == R06
    assert {fh: snow_png(store, fh) for fh in HOURS} == ref


def _other_run_state():
    """État lisible, même échéance (f003) que la progression, mais calculé pour le run 00z."""
    return snow.encode_state(snow.advance(snow.start(R00), 3, field(9.0).values, field(100.0).values))


@pytest.mark.parametrize("state", [None, "other_run", b"x"], ids=["absent", "autre-run", "illisible"])
def test_snow_missing_state_recomputes_from_first_hour(tmp_path, state):
    ref = single_pass_pngs(tmp_path / "ref")
    store = interrupted_store(tmp_path)
    key = snow.state_key(RUN06)
    if state is None:
        del store.objects[key]
    else:
        store.objects[key] = _other_run_state() if state == "other_run" else state
    code, rec, _ = make_run(tmp_path, store=store, download=url_download, decode=apcp_decode)
    assert code == EXIT_OK
    snow_dl = [u for u in rec.downloads if is_snow(u) and "t06z" in u]
    assert ["f003" in u for u in snow_dl] == [True, False]  # f003 re-téléchargé malgré la progression
    assert {fh: snow_png(store, fh) for fh in HOURS} == ref
    final = snow.decode_state(store.objects[key])
    assert final.fh == 6 and final.run == R06


def test_snow_decode_error_keeps_gfs_fresh(tmp_path):
    before = published(gfs_run=R00, chem_run=R00)

    def decode(data, specs):
        if snow.CPOFP in specs:
            raise DecodeError("champs absents du fichier : ['cpofp']")
        return good_decode(data, specs)

    code, _, store = make_run(tmp_path, store=store_with(before), decode=decode)
    m = manifest_of(store)["layers"]
    assert code == EXIT_OK and m["temp"]["run"] == R06 and m["pm25"]["run"] == R06
    assert m["snowfall"] == before["layers"]["snowfall"] and m["snow_depth"] == before["layers"]["snow_depth"]


@pytest.mark.parametrize("layer,bad", [("cpofp", np.nan), ("snowfall", np.nan), ("snowfall", 9.999e20)],
                         ids=["cpofp-nan", "apcp-nan", "apcp-manquant-grib"])
def test_snow_invalid_input_never_reaches_the_state(tmp_path, layer, bad):
    def decode(data, specs):
        out = good_decode(data, specs)
        if layer in out:
            v = np.full((721, 1440), RAW[layer], np.float32)
            v[10, 10] = bad
            out[layer] = Field(v, np.linspace(90, -90, 721), np.arange(0, 360, 0.25))
        return out

    code, _, store = make_run(tmp_path, decode=decode)
    assert code == EXIT_OK and manifest_of(store)["layers"]["temp"]["run"] == R06
    assert not any("gfs_snow" in k or "snowfall" in k for k in store.objects)


def test_snow_failure_without_manifest_omits_snow_layers(tmp_path):
    def download(url, n):
        if is_snow(url):
            raise nomads.NotFound(url)
        return b"GRIB"

    code, _, store = make_run(tmp_path, download=download)
    assert code == EXIT_OK and list(manifest_of(store)["layers"]) == GFS_IDS + CHEM_IDS


def test_snow_download_url_contains_only_snow_variables(tmp_path):
    _, rec, _ = make_run(tmp_path)
    url = next(u for u in rec.downloads if is_snow(u))
    assert "filter_gfs_0p25_1hr" in url
    assert all(p in url for p in ("var_APCP=on", "var_CPOFP=on", "var_SNOD=on", "lev_surface=on"))
    assert "var_TMP" not in url and "var_PRMSL" not in url


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
