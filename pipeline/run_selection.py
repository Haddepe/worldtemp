"""Choix du run et de sa frise d'échéances (spec lot E §3.1). Fonctions pures : aucune I/O."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from pipeline import config
from pipeline.sources import SourceSpec


@dataclass(frozen=True)
class Candidate:
    run: datetime          # heure du run, tz-aware UTC, multiple de 6 h
    forecast_hour: int     # échéance en heures

    @property
    def valid_time(self) -> datetime:
        return self.run + timedelta(hours=self.forecast_hour)


def _floor_to_run(dt: datetime) -> datetime:
    return dt.replace(hour=(dt.hour // 6) * 6, minute=0, second=0, microsecond=0)


def runs(now_utc: datetime, *, delay: timedelta, max_candidates: int) -> list[datetime]:
    """Runs candidats du plus récent au plus ancien (spec lot E §3.1). Un run n'est retenu que
    s'il a eu `delay` pour paraître sur NOMADS ; un 404 en aval couvre l'imprécision du délai."""
    if now_utc.tzinfo is None:
        raise ValueError("now_utc doit être tz-aware (UTC)")
    newest = _floor_to_run(now_utc.astimezone(timezone.utc) - delay)
    return [newest - timedelta(hours=6 * i) for i in range(max_candidates)]


def runs_for(source: SourceSpec, now_utc: datetime) -> list[datetime]:
    return runs(now_utc, delay=source.availability_delay, max_candidates=source.max_candidates)


def frame_hours(max_frames: int | None = None) -> tuple[int, ...]:
    """Échéances de la frise ; `max_frames` ne garde que les premières (dry-run de la CI)."""
    if max_frames is None:
        return config.FRAME_HOURS
    if max_frames < 1:
        raise ValueError(f"max_frames {max_frames} doit être ≥ 1")
    return config.FRAME_HOURS[:max_frames]
