"""Seul module dépendant de cfgrib/eccodes. Il rend du numpy nu : rien de xarray
ne sort d'ici. Les imports lourds sont dans la fonction : sur le poste Windows
(sans eccodes) le module s'importe, seul `decode_grib` échoue."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Field:
    values: np.ndarray  # (721, 1440) float32, Kelvin, lat 90→-90 (haut→bas), lon 0→359.75
    lat: np.ndarray     # (721,)
    lon: np.ndarray     # (1440,)


def decode_grib(data: bytes) -> Field:
    import xarray as xr  # cfgrib est chargé via engine="cfgrib"

    fd, path = tempfile.mkstemp(suffix=".grib2")  # cfgrib lit un chemin, pas un buffer
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        with xr.open_dataset(path, engine="cfgrib", backend_kwargs={"indexpath": ""}) as ds:
            da = ds["t2m"]  # nom cfgrib de TMP à 2 m
            return Field(
                values=np.ascontiguousarray(da.values, dtype=np.float32),
                lat=np.asarray(ds["latitude"].values, dtype=np.float64),
                lon=np.asarray(ds["longitude"].values, dtype=np.float64),
            )
    finally:
        os.unlink(path)
