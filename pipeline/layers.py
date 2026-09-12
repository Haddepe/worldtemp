"""Registre des couches (spec couches §3). Seule source de vérité côté Python :
variable NOMADS, clés GRIB de sélection, conversion, plage plausible, encodage 8 bits.
Le front ne recopie rien : il lit `encoding` dans le manifeste (spec §7)."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType

import numpy as np

SCALES = ("linear", "sqrt")

# GRIB2 code table 4.233 (aerosolType) — valeurs vérifiées par le test de décodage réel (T4).
AEROSOL_TOTAL = 62000
AEROSOL_DUST = 62001


@dataclass(frozen=True)
class Encoding:
    min: float
    max: float
    scale: str  # "linear" | "sqrt"

    def __post_init__(self) -> None:
        if self.scale not in SCALES:
            raise ValueError(f"scale {self.scale!r}, attendu {SCALES}")
        if not self.min < self.max:
            raise ValueError(f"min {self.min} doit être < max {self.max}")


@dataclass(frozen=True)
class LayerSpec:
    id: str
    source: str                          # id dans sources.SOURCES
    variable: str                        # nom informatif dans le manifeste
    unit: str                            # unité affichée (informatif)
    nomads_var: str                      # paramètre var_X du filtre
    nomads_lev: str                      # paramètre lev_Y du filtre
    grib_keys: Mapping[str, object]      # sélection du message (grib_adapter.decode_fields)
    convert: Callable[[np.ndarray], np.ndarray]  # brut GRIB → unité affichée
    plausible: tuple[float, float]       # bornes brutes (avant convert), sinon exit 3
    encoding: Encoding


def _identity(v: np.ndarray) -> np.ndarray:
    return v


def _kelvin_to_celsius(v: np.ndarray) -> np.ndarray:
    return v - 273.15


def _pa_to_hpa(v: np.ndarray) -> np.ndarray:
    return v / 100.0


def _rate_to_mm_per_hour(v: np.ndarray) -> np.ndarray:
    return v * 3600.0


def _clip_percent(v: np.ndarray) -> np.ndarray:
    return np.clip(v, 0.0, 100.0)


def _keys(**kw: object) -> Mapping[str, object]:
    return MappingProxyType(dict(kw))


LAYERS: tuple[LayerSpec, ...] = (
    LayerSpec("temp", "gfs", "TMP_2m", "°C", "TMP", "2_m_above_ground",
              _keys(shortName="2t", typeOfLevel="heightAboveGround", level=2),
              _kelvin_to_celsius, (180.0, 340.0), Encoding(-90, 60, "linear")),
    LayerSpec("clouds", "gfs", "TCDC_entire_atmosphere", "%", "TCDC", "entire_atmosphere",
              _keys(shortName="tcc", typeOfLevel="atmosphere", stepType="instant"),
              _identity, (0.0, 100.0), Encoding(0, 100, "linear")),
    LayerSpec("rain", "gfs", "PRATE_surface", "mm/h", "PRATE", "surface",
              _keys(shortName="prate", typeOfLevel="surface", stepType="instant"),
              _rate_to_mm_per_hour, (0.0, 0.1), Encoding(0, 50, "sqrt")),
    LayerSpec("pressure", "gfs", "PRMSL", "hPa", "PRMSL", "mean_sea_level",
              _keys(shortName="prmsl", typeOfLevel="meanSea"),
              _pa_to_hpa, (85_000.0, 110_000.0), Encoding(940, 1060, "linear")),
    LayerSpec("humidity", "gfs", "RH_2m", "%", "RH", "2_m_above_ground",
              _keys(shortName="2r", typeOfLevel="heightAboveGround", level=2),
              _clip_percent, (0.0, 102.0), Encoding(0, 100, "linear")),
    # Unité eccodes réelle du fichier NOMADS (clé `units`) : "(10**-6 g) m**-3", donc
    # déjà en µg/m³ — pas de conversion kg/m³→µg/m³ (l'hypothèse initiale, non vérifiée,
    # était fausse ; corrigée par le test de décodage réel T4, cf. plausible ci-dessous).
    # Bornes plausibles élargies (T7, calibration) : un run réel a atteint 3 187 µg/m³ sur
    # pm25, au-delà des 2000 d'origine, ce qui reportait systématiquement les couches chem
    # en production. (0, 20 000)/(0, 50 000) restent un garde-fou d'ordre de grandeur, pas
    # une plage d'affichage : l'encodage 8 bits (min/max ci-dessous) ne change pas.
    LayerSpec("pm25", "gefs_chem", "PMTF_surface_total", "µg/m³", "PMTF", "surface",
              _keys(shortName="pmtf", typeOfLevel="surface", aerosolType=AEROSOL_TOTAL),
              _identity, (0.0, 20_000.0), Encoding(0, 500, "sqrt")),
    LayerSpec("dust", "gefs_chem", "PMTC_surface_dust", "µg/m³", "PMTC", "surface",
              _keys(shortName="pmtc", typeOfLevel="surface", aerosolType=AEROSOL_DUST),
              _identity, (0.0, 50_000.0), Encoding(0, 2000, "sqrt")),
)

_BY_ID = {s.id: s for s in LAYERS}


def by_source(source_id: str) -> list[LayerSpec]:
    return [s for s in LAYERS if s.source == source_id]


def get(layer_id: str) -> LayerSpec:
    return _BY_ID[layer_id]
