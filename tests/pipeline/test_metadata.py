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
        "grid": {"width": 1440, "height": 721, "lon_min": -180, "lon_max": 179.75, "lat_min": -90, "lat_max": 90,
                 "lon_step": 0.25, "lat_step": 0.25},
        "texture": "latest.png",
        "stats": {"min_c": -71.3, "max_c": 48.9},
    }


def test_to_json_is_utf8_pretty_with_trailing_newline():
    data = to_json({"a": 1})
    assert data.endswith(b"\n")
    assert json.loads(data) == {"a": 1}
