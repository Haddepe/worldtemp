"""Manifeste `layers/latest.json` v2 — contrat avec le globe (spec couches §7). Pur."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta, timezone

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


def run_dir(run: datetime) -> str:
    """Dossier R2 d'un run (spec lot E §4.1) : `YYYYMMDDTHHZ` ; l'ordre alphabétique est chronologique."""
    return run.astimezone(timezone.utc).strftime("%Y%m%dT%HZ")


def frame_texture(run: datetime, layer_id: str, fh: int) -> str:
    """Chemin du PNG relatif à `layers/`, tel qu'écrit dans le manifeste."""
    return f"{run_dir(run)}/{layer_id}_f{fh:03d}.png"


def frame_key(run: datetime, layer_id: str, fh: int) -> str:
    return f"{config.LAYERS_PREFIX}/{frame_texture(run, layer_id, fh)}"


def progress_key(run: datetime, source_id: str) -> str:
    """Progression d'une source pour un run (spec lot E §3.2) : stats des échéances déjà publiées."""
    return f"{config.LAYERS_PREFIX}/{run_dir(run)}/{source_id}.json"


def stats_of(converted: np.ndarray) -> dict:
    return {"min": round(float(converted.min()), 1), "max": round(float(converted.max()), 1)}


def frame_entry(layer_id: str, run: datetime, fh: int, stats: Mapping) -> dict:
    return {
        "forecast_hour": fh,
        "valid_time_utc": iso_utc(run + timedelta(hours=fh)),
        "texture": frame_texture(run, layer_id, fh),
        "stats": {"min": stats["min"], "max": stats["max"]},
    }


def forecast_entry(spec: LayerSpec, source: SourceSpec, run: datetime, frames: Sequence[Mapping], generated_at: datetime) -> dict:
    """Entrée v3 d'une couche (spec lot E §4.2) : l'encodage est déclaré une fois, fixe pour toute la frise."""
    e = spec.encoding
    return {
        "model": source.model,
        "variable": spec.variable,
        "unit": spec.unit,
        "run": iso_utc(run),
        "generated_at": iso_utc(generated_at),
        "encoding": {"bits": 8, "min": e.min, "max": e.max, "scale": e.scale},
        "frames": sorted((dict(f) for f in frames), key=lambda f: f["forecast_hour"]),
    }


def build_forecast(entries: Mapping[str, dict], generated_at: datetime) -> dict:
    """Manifeste v3 ; couches dans l'ordre du registre, ids inconnus ignorés."""
    ordered = {s.id: entries[s.id] for s in LAYERS if s.id in entries}
    return {
        "schema_version": config.FORECAST_SCHEMA_VERSION,
        "generated_at": iso_utc(generated_at),
        "grid": dict(GRID),
        "layers": ordered,
    }


def cited_runs(manifest: Mapping | None) -> set[str]:
    """Dossiers de run cités par un manifeste v3 (rétention, spec lot E §4.3) ; entrées illisibles ignorées."""
    out: set[str] = set()
    for entry in ((manifest or {}).get("layers") or {}).values():
        try:
            run = datetime.strptime(entry["run"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except (TypeError, KeyError, ValueError):
            continue
        out.add(run_dir(run))
    return out


def to_json(obj: dict) -> bytes:
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
