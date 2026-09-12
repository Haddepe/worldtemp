"""Champ GRIB brut → pixels 8 bits orientés pour la sphère (spec couches §6).
Fonctions pures sur numpy."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from pipeline import config
from pipeline.grib_adapter import Field
from pipeline.layers import Encoding, LayerSpec


class InvalidData(ValueError):
    """Données invraisemblables : la source échoue (exit 3 si primaire), jamais de remplissage."""


def validate_grid(field: Field, label: str = "") -> None:
    tag = f"{label} : " if label else ""
    v = field.values
    expected = (config.HEIGHT, config.WIDTH)
    if v.shape != expected:
        raise InvalidData(f"{tag}forme {v.shape}, attendu {expected}")
    if np.isnan(v).any():
        raise InvalidData(f"{tag}NaN présent dans le champ")
    if field.lat[0] != 90:
        raise InvalidData(f"{tag}lat[0] = {field.lat[0]}, attendu 90 (nord en haut)")
    if field.lon[0] != 0:
        raise InvalidData(f"{tag}lon[0] = {field.lon[0]}, attendu 0")


def validate_range(values: np.ndarray, plausible: tuple[float, float], label: str = "") -> None:
    tag = f"{label} : " if label else ""
    lo, hi = float(values.min()), float(values.max())
    if lo < plausible[0] or hi > plausible[1]:
        raise InvalidData(f"{tag}plage invraisemblable [{lo:.4g}, {hi:.4g}], attendu {plausible}")


def reorient(values: np.ndarray) -> np.ndarray:
    """Grille lon 0→360 → lon -180→180 : roll d'une demi-largeur. Pas de flip
    latitude, le GRIB livre déjà le nord en haut (garanti par `validate_grid`)."""
    return np.roll(values, values.shape[1] // 2, axis=1)


def quantize(values: np.ndarray, enc: Encoding) -> np.ndarray:
    if np.isnan(values).any():
        raise InvalidData("NaN présent avant quantification")
    x = (np.asarray(values, dtype=np.float64) - enc.min) / (enc.max - enc.min)
    x = np.clip(x, 0.0, 1.0)
    if enc.scale == "sqrt":
        x = np.sqrt(x)
    return np.clip(np.rint(x * 255.0), 0, 255).astype(np.uint8)


def dequantize(pixels: np.ndarray, enc: Encoding) -> np.ndarray:
    x = np.asarray(pixels, dtype=np.float64) / 255.0
    if enc.scale == "sqrt":
        x = x * x
    return enc.min + (enc.max - enc.min) * x


def layer_pixels(field: Field, spec: LayerSpec) -> tuple[np.ndarray, np.ndarray]:
    """Valide, convertit, réoriente, quantifie. Renvoie (valeurs converties
    réorientées en float64 — pour `stats` —, pixels uint8)."""
    validate_grid(field, spec.id)
    validate_range(field.values, spec.plausible, spec.id)
    converted = reorient(np.asarray(spec.convert(field.values.astype(np.float64)), dtype=np.float64))
    return converted, quantize(converted, spec.encoding)


def encode_png(pixels: np.ndarray) -> bytes:
    if pixels.dtype != np.uint8 or pixels.ndim != 2:
        raise ValueError("encode_png attend un tableau 2D uint8")
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, format="PNG", optimize=True)
    return buf.getvalue()
