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
