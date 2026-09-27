from datetime import datetime, timedelta, timezone

import pytest

from pipeline.run_selection import Candidate

UTC = timezone.utc


def dt(y, m, d, h, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=UTC)


def test_valid_time_is_run_plus_forecast_hour():
    c = Candidate(dt(2026, 8, 30, 6), 8)
    assert c.valid_time == dt(2026, 8, 30, 14)


from pipeline import config
from pipeline.run_selection import frame_hours, runs, runs_for
from pipeline.sources import GEFS_CHEM, GFS

GFS_DELAY = timedelta(hours=3, minutes=30)


def test_runs_newest_first_once_available():
    # 14:20 − 3 h 30 = 10:50 → run 06z, puis 00z, 18z et 12z la veille (spec lot E §3.1)
    assert runs(dt(2026, 8, 30, 14, 20), delay=GFS_DELAY, max_candidates=4) == [
        dt(2026, 8, 30, 6), dt(2026, 8, 30, 0), dt(2026, 8, 29, 18), dt(2026, 8, 29, 12),
    ]


def test_runs_early_morning_skips_00z():
    assert runs(dt(2026, 8, 30, 3, 0), delay=GFS_DELAY, max_candidates=2) == [dt(2026, 8, 29, 18), dt(2026, 8, 29, 12)]


def test_runs_exactly_at_delay():
    assert runs(dt(2026, 8, 30, 9, 30), delay=GFS_DELAY, max_candidates=1) == [dt(2026, 8, 30, 6)]


def test_runs_naive_datetime_rejected():
    with pytest.raises(ValueError):
        runs(datetime(2026, 8, 30, 14, 20), delay=GFS_DELAY, max_candidates=1)


def test_runs_non_utc_timezone_is_converted():
    paris = timezone(timedelta(hours=2))
    assert runs(datetime(2026, 8, 30, 16, 20, tzinfo=paris), delay=GFS_DELAY, max_candidates=2) == runs(
        dt(2026, 8, 30, 14, 20), delay=GFS_DELAY, max_candidates=2,
    )


def test_runs_for_uses_source_delay_and_candidates():
    now = dt(2026, 9, 12, 14, 40)
    assert runs_for(GFS, now)[0] == dt(2026, 9, 12, 6)                         # 11:10 → 06z
    assert runs_for(GEFS_CHEM, now)[0] == dt(2026, 9, 12, 6)                   # 09:40 → 06z
    assert runs_for(GEFS_CHEM, dt(2026, 9, 12, 10, 40))[0] == dt(2026, 9, 12, 0)  # 05:40 → 00z
    assert len(runs_for(GFS, now)) == GFS.max_candidates


def test_frame_hours_is_f003_to_f060_every_3h():
    h = frame_hours()
    assert h == config.FRAME_HOURS and len(h) == 20 and h[0] == 3 and h[-1] == 60
    assert all(b - a == 3 for a, b in zip(h, h[1:]))


def test_frame_hours_max_frames_keeps_the_first_ones():
    assert frame_hours(1) == (3,) and frame_hours(2) == (3, 6) and frame_hours(99) == config.FRAME_HOURS
    with pytest.raises(ValueError):
        frame_hours(0)
