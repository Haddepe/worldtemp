"""Manifeste `layers/latest.json` v2 et legacy `gfs/latest.json` v1 — contrat avec
le globe (spec couches §7). Pur."""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime, timezone

import numpy as np

from pipeline import config
from pipeline.layers import LAYERS, LayerSpec
from pipeline.run_selection import Candidate
from pipeline.sources import SourceSpec

GRID = {
    "width": config.WIDTH, "height": config.HEIGHT,
    "lon_min": -180, "lon_max": 179.75, "lat_min": -90, "lat_max": 90,
    "lon_step": 0.25, "lat_step": 0.25,
}


def iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def layer_entry(spec: LayerSpec, source: SourceSpec, c: Candidate, converted: np.ndarray, generated_at: datetime) -> dict:
    e = spec.encoding
    return {
        "model": source.model,
        "variable": spec.variable,
        "unit": spec.unit,
        "run": iso_utc(c.run),
        "forecast_hour": c.forecast_hour,
        "valid_time_utc": iso_utc(c.valid_time),
        "generated_at": iso_utc(generated_at),
        "texture": f"{spec.id}.png",
        "encoding": {"bits": 8, "min": e.min, "max": e.max, "scale": e.scale},
        "stats": {"min": round(float(converted.min()), 1), "max": round(float(converted.max()), 1)},
    }


def build_manifest(entries: Mapping[str, dict], generated_at: datetime) -> dict:
    """Couches dans l'ordre du registre ; les ids inconnus sont ignorés."""
    ordered = {s.id: entries[s.id] for s in LAYERS if s.id in entries}
    return {
        "schema_version": config.SCHEMA_VERSION,
        "generated_at": iso_utc(generated_at),
        "grid": dict(GRID),
        "layers": ordered,
    }


def build_legacy(temp: dict) -> dict:
    """`gfs/latest.json` schema 1, publié une version encore (spec §7)."""
    enc = temp["encoding"]
    return {
        "schema_version": config.LEGACY_SCHEMA_VERSION,
        "model": temp["model"],
        "variable": temp["variable"],
        "run": temp["run"],
        "forecast_hour": temp["forecast_hour"],
        "valid_time_utc": temp["valid_time_utc"],
        "generated_at": temp["generated_at"],
        "encoding": {"bits": 8, "min_c": enc["min"], "max_c": enc["max"]},
        "grid": dict(GRID),
        "texture": "latest.png",
        "stats": {"min_c": temp["stats"]["min"], "max_c": temp["stats"]["max"]},
    }


def to_json(obj: dict) -> bytes:
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
