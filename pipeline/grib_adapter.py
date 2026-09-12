"""Seul module dépendant d'eccodes. Il rend du numpy nu. Les imports lourds sont
dans les fonctions : sur le poste Windows (sans eccodes) le module s'importe, seules
`decode_fields` et `list_messages` échouent.

Sélection par clés (spec couches §5) : un message est retenu pour une couche quand
toutes ses `grib_keys` sont égales aux clés du message. Un fichier NOMADS filtré
contient le produit var × niveau et parfois deux pas de temps (TCDC instantané et
moyenné) ou plusieurs aérosols (PMTF) : les clés lèvent l'ambiguïté."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import numpy as np

from pipeline.layers import LayerSpec

# Clés lues sur chaque message, quand elles sont définies.
MATCH_KEYS = (
    "shortName", "typeOfLevel", "level", "stepType", "aerosolType",
    "discipline", "parameterCategory", "parameterNumber",
)


@dataclass(frozen=True)
class Field:
    values: np.ndarray  # (721, 1440) float32, valeur brute GRIB, lat 90→-90 (haut→bas), lon 0→359.75
    lat: np.ndarray     # (721,)
    lon: np.ndarray     # (1440,)


class DecodeError(ValueError):
    """Champ absent ou ambigu : bug de registre ou format NOMADS changé."""


def _message_keys(gid: int) -> dict[str, object]:
    import eccodes

    out: dict[str, object] = {}
    for key in MATCH_KEYS:
        try:
            if eccodes.codes_is_defined(gid, key):
                out[key] = eccodes.codes_get(gid, key)
        except Exception:  # clé non lisible pour ce message : on l'ignore
            continue
    return out


def _field(gid: int) -> Field:
    import eccodes

    ni = int(eccodes.codes_get(gid, "Ni"))
    nj = int(eccodes.codes_get(gid, "Nj"))
    values = np.asarray(eccodes.codes_get_values(gid), dtype=np.float32).reshape(nj, ni)
    lat0 = float(eccodes.codes_get(gid, "latitudeOfFirstGridPointInDegrees"))
    lon0 = float(eccodes.codes_get(gid, "longitudeOfFirstGridPointInDegrees"))
    dlat = float(eccodes.codes_get(gid, "jDirectionIncrementInDegrees"))
    dlon = float(eccodes.codes_get(gid, "iDirectionIncrementInDegrees"))
    j_positive = int(eccodes.codes_get(gid, "jScansPositively")) == 1
    lat = lat0 + (dlat if j_positive else -dlat) * np.arange(nj, dtype=np.float64)
    lon = lon0 + dlon * np.arange(ni, dtype=np.float64)
    return Field(np.ascontiguousarray(values), lat, lon)


def _matches(keys: Mapping[str, object], wanted: Mapping[str, object]) -> bool:
    return all(keys.get(k) == v for k, v in wanted.items())


def _with_temp_file(data: bytes, visit) -> None:
    """Écrit `data` dans un fichier temporaire et appelle `visit(gid)` sur chaque message."""
    import eccodes

    fd, path = tempfile.mkstemp(suffix=".grib2")  # eccodes lit un chemin, pas un buffer
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        with open(path, "rb") as f:
            while True:
                gid = eccodes.codes_grib_new_from_file(f)
                if gid is None:
                    break
                try:
                    visit(gid)
                finally:
                    eccodes.codes_release(gid)
    finally:
        os.unlink(path)


def list_messages(data: bytes) -> list[dict[str, object]]:
    """Diagnostic : les clés de chaque message, dans l'ordre du fichier."""
    out: list[dict[str, object]] = []
    _with_temp_file(data, lambda gid: out.append(_message_keys(gid)))
    return out


def decode_fields(data: bytes, specs: Sequence[LayerSpec]) -> dict[str, Field]:
    found: dict[str, Field] = {}

    def visit(gid: int) -> None:
        keys = _message_keys(gid)
        for spec in specs:
            if _matches(keys, spec.grib_keys):
                if spec.id in found:
                    raise DecodeError(f"{spec.id} : plusieurs messages correspondent à {dict(spec.grib_keys)} ({keys})")
                found[spec.id] = _field(gid)

    _with_temp_file(data, visit)
    missing = [s.id for s in specs if s.id not in found]
    if missing:
        raise DecodeError(f"champs absents du fichier : {missing}")
    return found
