"""Choix du couple (run GFS, échéance) dont la prévision est valide à l'heure
courante (spec §3). Fonction pure : aucune I/O."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from pipeline import config


@dataclass(frozen=True)
class Candidate:
    run: datetime          # heure du run, tz-aware UTC, multiple de 6 h
    forecast_hour: int     # échéance en heures

    @property
    def valid_time(self) -> datetime:
        return self.run + timedelta(hours=self.forecast_hour)


def _floor_to_hour(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def _floor_to_run(dt: datetime) -> datetime:
    return dt.replace(hour=(dt.hour // 6) * 6, minute=0, second=0, microsecond=0)


def candidates(
    now_utc: datetime,
    *,
    delay: timedelta = config.RUN_AVAILABILITY_DELAY,
    max_candidates: int = config.MAX_CANDIDATES,
    max_forecast_hour: int = config.MAX_FORECAST_HOUR,
) -> list[Candidate]:
    """Candidats du plus récent au plus ancien, tous valides à `now` tronqué à l'heure.

    Un run n'est retenu que s'il a eu `delay` pour apparaître sur NOMADS ; un 404
    en aval couvre l'imprécision de ce délai dans les deux sens.
    """
    if now_utc.tzinfo is None:
        raise ValueError("now_utc doit être tz-aware (UTC)")
    target = _floor_to_hour(now_utc.astimezone(timezone.utc))
    run = _floor_to_run(target - delay)
    found: list[Candidate] = []
    for _ in range(max_candidates):
        fh = int((target - run).total_seconds() // 3600)
        if 0 <= fh <= max_forecast_hour:
            found.append(Candidate(run, fh))
        run -= timedelta(hours=6)
    return found
