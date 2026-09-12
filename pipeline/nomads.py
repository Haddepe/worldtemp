"""Accès NOMADS : construction d'URL (pure) et téléchargement (réseau)."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from urllib.parse import urlencode

import requests

from pipeline import config
from pipeline.layers import LayerSpec
from pipeline.run_selection import Candidate
from pipeline.sources import SourceSpec

USER_AGENT = "worldtemp-pipeline (+https://github.com/Haddepe/worldtemp)"


class NotFound(Exception):
    """404 : ce run/échéance n'est pas (ou pas encore) sur NOMADS → candidat suivant."""


class TransientError(Exception):
    """5xx, timeout, erreur de connexion → un retry, puis candidat suivant."""


def _unique(items: Iterable[str]) -> list[str]:
    seen: list[str] = []
    for it in items:
        if it not in seen:
            seen.append(it)
    return seen


def build_url(source: SourceSpec, c: Candidate, specs: Sequence[LayerSpec]) -> str:
    """Un téléchargement par source : toutes ses variables et tous ses niveaux.
    Le filtre renvoie le produit var × niveau (messages superflus sans effet :
    decode_fields sélectionne par clés)."""
    hh = f"{c.run.hour:02d}"
    params = [
        ("dir", source.dir_pattern.format(ymd=f"{c.run:%Y%m%d}", hh=hh)),
        ("file", source.file_pattern.format(hh=hh, fh=c.forecast_hour)),
    ]
    params += [(f"var_{v}", "on") for v in _unique(s.nomads_var for s in specs)]
    params += [(f"lev_{lev}", "on") for lev in _unique(s.nomads_lev for s in specs)]
    return source.filter_url + "?" + urlencode(params, safe="/")


def download(url: str, timeout: float = config.HTTP_TIMEOUT_S, get=requests.get) -> bytes:
    try:
        resp = get(url, timeout=timeout, headers={"User-Agent": USER_AGENT})
    except requests.RequestException as exc:
        raise TransientError(str(exc)) from exc
    if resp.status_code == 404:
        raise NotFound(url)
    # 403 : NOMADS renvoie ce code aux IP partagées limitées (dont les runners
    # Actions) — c'est une IP throttlée, pas une interdiction définitive.
    if resp.status_code in (403, 429) or resp.status_code >= 500:
        raise TransientError(f"HTTP {resp.status_code}")
    try:
        resp.raise_for_status()
    except requests.HTTPError as exc:
        raise TransientError(str(exc)) from exc
    # Le filtre NOMADS peut répondre 200 avec une page HTML d'erreur.
    if not resp.content.startswith(b"GRIB"):
        raise NotFound(f"réponse non GRIB ({len(resp.content)} octets)")
    return resp.content
