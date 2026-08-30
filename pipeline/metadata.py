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
            "lon_min": -180, "lon_max": 179.75, "lat_min": -90, "lat_max": 90,
            "lon_step": 0.25, "lat_step": 0.25,
        },
        "texture": "latest.png",
        "stats": {"min_c": round(float(celsius.min()), 1), "max_c": round(float(celsius.max()), 1)},
    }


def to_json(meta: dict) -> bytes:
    return (json.dumps(meta, indent=2) + "\n").encode("utf-8")
