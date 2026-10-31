"""Couche neige (spec R5a §6). Deux champs publiés par la source `gfs_snow` :
`snowfall` (chutes de neige cumulées, dérivées) et `snow_depth` (épaisseur au sol, SNOD).

`CPOFP` (pourcentage de précipitation gelée) n'est qu'une entrée du calcul des chutes : décodée
avec les autres champs, jamais publiée, donc absente de `LAYERS`. -50 = « pas de précipitation »
(sentinelle NCEP, lue en réel à -50,0000076 : d'où la marge de `plausible`) ; `frozen_fraction`
l'écarte en bornant à 0..100 %."""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime

import numpy as np

from pipeline import config
from pipeline.layers import Encoding, LayerSpec, _identity, _keys
from pipeline.metadata import run_dir

CPOFP = LayerSpec("cpofp", "gfs_snow", "CPOFP_surface", "%", "CPOFP", "surface",
                  _keys(shortName="cpofp", typeOfLevel="surface"),
                  _identity, (-51.0, 101.0), Encoding(0, 100, "linear"))

# Rapport neige/eau 10:1 : 1 mm d'eau gelée = 10 mm de neige = 1 cm.
SNOW_RATIO = 10.0


def frozen_fraction(cpofp_pct: np.ndarray) -> np.ndarray:
    """Part gelée de la précipitation, 0..1. La sentinelle -50 (« pas de précipitation ») donne 0."""
    return np.clip(cpofp_pct, 0, 100) / 100


@dataclass(frozen=True)
class SnowState:
    """État flottant d'un run entre deux frames : grilles brutes 721 × 1440, non réorientées.
    `run` (ISO UTC) : la reprise refuse un état calculé pour un autre run."""
    fh: int
    apcp_mm: np.ndarray   # APCP continu (mm) à `fh`, pour en tirer l'incrément suivant
    cum_cm: np.ndarray    # chutes de neige cumulées (cm) depuis le début du run
    run: str = ""


def start(run: str = "") -> SnowState:
    shape = (config.HEIGHT, config.WIDTH)
    return SnowState(0, np.zeros(shape, np.float32), np.zeros(shape, np.float32), run)


def advance(state: SnowState, fh: int, apcp_mm: np.ndarray, cpofp_pct: np.ndarray) -> SnowState:
    """Ajoute la neige tombée entre `state.fh` et `fh` : ΔP (>= 0) × part gelée × 10:1, en cm."""
    if fh <= state.fh:
        raise ValueError(f"fh {fh} <= {state.fh} : les frames doivent se suivre dans l'ordre")
    dp = np.maximum(apcp_mm - state.apcp_mm, 0)
    cum = state.cum_cm + dp * frozen_fraction(cpofp_pct) * SNOW_RATIO / 10
    return SnowState(fh, apcp_mm.astype(np.float32), cum.astype(np.float32), state.run)


def encode_state(s: SnowState) -> bytes:
    buf = io.BytesIO()
    np.savez_compressed(buf, fh=np.int64(s.fh), apcp_mm=s.apcp_mm, cum_cm=s.cum_cm, run=np.str_(s.run))
    return buf.getvalue()


def decode_state(b: bytes) -> SnowState:
    """Relit un état ; toute donnée illisible ou de mauvaise forme lève ValueError."""
    expected = (config.HEIGHT, config.WIDTH)
    try:
        with np.load(io.BytesIO(b), allow_pickle=False) as z:
            fh, apcp, cum = int(z["fh"]), z["apcp_mm"], z["cum_cm"]
            run = str(z["run"]) if "run" in z.files else ""
    except Exception as e:
        raise ValueError(f"état neige illisible : {e}") from e
    if apcp.shape != expected or cum.shape != expected:
        raise ValueError(f"état neige de forme {apcp.shape}/{cum.shape}, attendu {expected}")
    return SnowState(fh, apcp.astype(np.float32), cum.astype(np.float32), run)


def state_key(run: datetime) -> str:
    """Clé R2 de l'état, dans le dossier du run : la rétention l'efface avec lui."""
    return f"{config.LAYERS_PREFIX}/{run_dir(run)}/gfs_snow_state.npz"
