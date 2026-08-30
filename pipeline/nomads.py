"""Accès NOMADS : construction d'URL (pure) et téléchargement (réseau)."""

from __future__ import annotations

from urllib.parse import urlencode

import requests

from pipeline import config
from pipeline.run_selection import Candidate


class NotFound(Exception):
    """404 : ce run/échéance n'est pas (ou pas encore) sur NOMADS → candidat suivant."""


class TransientError(Exception):
    """5xx, timeout, erreur de connexion → un retry, puis candidat suivant."""


def build_url(c: Candidate, base: str = config.NOMADS_FILTER_URL) -> str:
    hh = f"{c.run.hour:02d}"
    params = [
        ("dir", f"/gfs.{c.run:%Y%m%d}/{hh}/atmos"),
        ("file", f"gfs.t{hh}z.pgrb2.0p25.f{c.forecast_hour:03d}"),
        ("var_TMP", "on"),
        ("lev_2_m_above_ground", "on"),
    ]
    return base + "?" + urlencode(params, safe="/")


def download(url: str, timeout: float = config.HTTP_TIMEOUT_S) -> bytes:
    try:
        resp = requests.get(url, timeout=timeout)
    except requests.RequestException as exc:
        raise TransientError(str(exc)) from exc
    if resp.status_code == 404:
        raise NotFound(url)
    if resp.status_code >= 500:
        raise TransientError(f"HTTP {resp.status_code}")
    resp.raise_for_status()
    # Le filtre NOMADS peut répondre 200 avec une page HTML d'erreur.
    if not resp.content.startswith(b"GRIB"):
        raise NotFound(f"réponse non GRIB ({len(resp.content)} octets)")
    return resp.content
