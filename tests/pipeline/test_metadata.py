import json
from datetime import datetime, timedelta, timezone

import numpy as np

from pipeline.layers import get
from pipeline.metadata import GRID, build_legacy, build_manifest, iso_utc, layer_entry, to_json
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


def test_build_legacy_is_schema_1_contract():
    c = Candidate(datetime(2026, 8, 30, 6, tzinfo=UTC), 8)
    temp = layer_entry(get("temp"), GFS, c, np.array([[-71.34, 48.86]]), datetime(2026, 8, 30, 14, 7, 42, tzinfo=UTC))
    assert build_legacy(temp) == {
        "schema_version": 1,
        "model": "gfs_0p25",
        "variable": "TMP_2m",
        "run": "2026-08-30T06:00:00Z",
        "forecast_hour": 8,
        "valid_time_utc": "2026-08-30T14:00:00Z",
        "generated_at": "2026-08-30T14:07:42Z",
        "encoding": {"bits": 8, "min_c": -90, "max_c": 60},
        "grid": GRID,
        "texture": "latest.png",
        "stats": {"min_c": -71.3, "max_c": 48.9},
    }


def test_to_json_is_utf8_pretty_with_trailing_newline():
    data = to_json({"a": "µg/m³"})
    assert data.endswith(b"\n") and json.loads(data) == {"a": "µg/m³"}
