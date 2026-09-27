import json
from datetime import datetime, timedelta, timezone

import numpy as np

from pipeline.layers import get
from pipeline.metadata import GRID, build_manifest, iso_utc, layer_entry, to_json
from pipeline.run_selection import Candidate
from pipeline.sources import GEFS_CHEM, GFS

UTC = timezone.utc
GEN = datetime(2026, 9, 12, 14, 12, 40, tzinfo=UTC)


def test_iso_utc_format_and_conversion():
    assert iso_utc(datetime(2026, 8, 30, 14, 7, 42, tzinfo=UTC)) == "2026-08-30T14:07:42Z"
    paris = timezone(timedelta(hours=2))
    assert iso_utc(datetime(2026, 8, 30, 16, 0, tzinfo=paris)) == "2026-08-30T14:00:00Z"


def test_layer_entry_matches_spec_7():
    c = Candidate(datetime(2026, 9, 12, 6, tzinfo=UTC), 8)
    entry = layer_entry(get("temp"), GFS, c, np.array([[-61.34, 47.86]]), GEN)
    assert entry == {
        "model": "gfs_0p25", "variable": "TMP_2m", "unit": "°C",
        "run": "2026-09-12T06:00:00Z", "forecast_hour": 8,
        "valid_time_utc": "2026-09-12T14:00:00Z", "generated_at": "2026-09-12T14:12:40Z",
        "texture": "temp.png",
        "encoding": {"bits": 8, "min": -90, "max": 60, "scale": "linear"},
        "stats": {"min": -61.3, "max": 47.9},
    }


def test_layer_entry_chem_uses_its_source_and_sqrt():
    c = Candidate(datetime(2026, 9, 12, 6, tzinfo=UTC), 6)
    entry = layer_entry(get("pm25"), GEFS_CHEM, c, np.array([[0.0, 312.44]]), GEN)
    assert entry["model"] == "gefs_chem_0p25" and entry["texture"] == "pm25.png"
    assert entry["encoding"] == {"bits": 8, "min": 0, "max": 500, "scale": "sqrt"}
    assert entry["valid_time_utc"] == "2026-09-12T12:00:00Z" and entry["stats"] == {"min": 0.0, "max": 312.4}


def test_build_manifest_orders_layers_by_registry_and_carries_grid():
    entries = {"pm25": {"texture": "pm25.png"}, "temp": {"texture": "temp.png"}, "rain": {"texture": "rain.png"}}
    m = build_manifest(entries, GEN)
    assert m["schema_version"] == 2 and m["generated_at"] == "2026-09-12T14:12:40Z"
    assert m["grid"] == GRID == {
        "width": 1440, "height": 721, "lon_min": -180, "lon_max": 179.75, "lat_min": -90, "lat_max": 90,
        "lon_step": 0.25, "lat_step": 0.25,
    }
    assert list(m["layers"]) == ["temp", "rain", "pm25"]


def test_build_manifest_ignores_unknown_ids():
    assert list(build_manifest({"wind": {}, "temp": {}}, GEN)["layers"]) == ["temp"]


def test_to_json_is_utf8_pretty_with_trailing_newline():
    data = to_json({"a": "µg/m³"})
    assert data.endswith(b"\n") and json.loads(data) == {"a": "µg/m³"}


from pipeline import config
from pipeline.metadata import (
    build_forecast, cited_runs, forecast_entry, frame_entry, frame_key, frame_texture, progress_key, run_dir, stats_of,
)

RUN = datetime(2026, 9, 12, 6, tzinfo=UTC)


def test_run_dir_and_keys_match_spec_4_1():
    assert run_dir(RUN) == "20260912T06Z"
    assert run_dir(datetime(2026, 9, 12, 8, tzinfo=timezone(timedelta(hours=2)))) == "20260912T06Z"
    assert frame_texture(RUN, "temp", 3) == "20260912T06Z/temp_f003.png"
    assert frame_key(RUN, "temp", 60) == "layers/20260912T06Z/temp_f060.png"
    assert progress_key(RUN, "gefs_chem") == "layers/20260912T06Z/gefs_chem.json"


def test_stats_of_rounds_to_one_decimal():
    assert stats_of(np.array([[-61.34, 47.86]])) == {"min": -61.3, "max": 47.9}


def test_frame_entry_matches_spec_4_2():
    assert frame_entry("temp", RUN, 9, {"min": -41.2, "max": 44.8}) == {
        "forecast_hour": 9, "valid_time_utc": "2026-09-12T15:00:00Z",
        "texture": "20260912T06Z/temp_f009.png", "stats": {"min": -41.2, "max": 44.8},
    }


def test_forecast_entry_declares_encoding_once_and_sorts_frames():
    frames = [frame_entry("pm25", RUN, fh, {"min": 0.0, "max": 1.0}) for fh in (6, 3)]
    e = forecast_entry(get("pm25"), GEFS_CHEM, RUN, frames, GEN)
    assert e["model"] == "gefs_chem_0p25" and e["variable"] == "PMTF_surface_total" and e["unit"] == "µg/m³"
    assert e["run"] == "2026-09-12T06:00:00Z" and e["generated_at"] == "2026-09-12T14:12:40Z"
    assert e["encoding"] == {"bits": 8, "min": 0, "max": 500, "scale": "sqrt"}
    assert [f["forecast_hour"] for f in e["frames"]] == [3, 6]
    assert "texture" not in e and "forecast_hour" not in e


def test_build_forecast_is_schema_3_ordered_by_registry():
    m = build_forecast({"pm25": {"run": "x"}, "temp": {"run": "y"}, "wind": {}}, GEN)
    assert m["schema_version"] == 3 == config.FORECAST_SCHEMA_VERSION
    assert m["generated_at"] == "2026-09-12T14:12:40Z" and m["grid"] == GRID
    assert list(m["layers"]) == ["temp", "pm25"]


def test_cited_runs_reads_run_of_every_layer_and_ignores_garbage():
    m = {"layers": {"temp": {"run": "2026-09-12T06:00:00Z"}, "pm25": {"run": "2026-09-12T00:00:00Z"},
                    "dust": {"run": "pas une date"}, "rain": {}}}
    assert cited_runs(m) == {"20260912T06Z", "20260912T00Z"}
    assert cited_runs(None) == set() and cited_runs({}) == set()
