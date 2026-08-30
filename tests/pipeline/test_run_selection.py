from datetime import datetime, timedelta, timezone

import pytest

from pipeline.run_selection import Candidate, candidates

UTC = timezone.utc


def dt(y, m, d, h, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=UTC)


def test_spec_example_14h20():
    got = candidates(dt(2026, 8, 30, 14, 20))
    assert got == [
        Candidate(dt(2026, 8, 30, 6), 8),
        Candidate(dt(2026, 8, 30, 0), 14),
        Candidate(dt(2026, 8, 29, 18), 20),
        Candidate(dt(2026, 8, 29, 12), 26),
    ]


def test_early_morning_skips_00z_run():
    got = candidates(dt(2026, 8, 30, 3, 0))
    assert got[0] == Candidate(dt(2026, 8, 29, 18), 9)
    assert all(c.run != dt(2026, 8, 30, 0) for c in got)


def test_midnight_crossing():
    got = candidates(dt(2026, 8, 30, 0, 0))
    assert got[0] == Candidate(dt(2026, 8, 29, 18), 6)
    assert got[-1] == Candidate(dt(2026, 8, 29, 0), 24)


def test_target_is_floored_to_the_hour():
    assert candidates(dt(2026, 8, 30, 14, 59)) == candidates(dt(2026, 8, 30, 14, 0))


def test_forecast_hour_is_capped():
    got = candidates(dt(2026, 8, 30, 14, 20), max_candidates=20, max_forecast_hour=48)
    assert got, "au moins un candidat"
    assert all(0 <= c.forecast_hour <= 48 for c in got)
    assert len(got) < 20


def test_valid_time_is_run_plus_forecast_hour():
    c = Candidate(dt(2026, 8, 30, 6), 8)
    assert c.valid_time == dt(2026, 8, 30, 14)


def test_naive_datetime_rejected():
    with pytest.raises(ValueError):
        candidates(datetime(2026, 8, 30, 14, 20))


def test_non_utc_timezone_is_converted():
    paris = timezone(timedelta(hours=2))
    assert candidates(datetime(2026, 8, 30, 16, 20, tzinfo=paris)) == candidates(dt(2026, 8, 30, 14, 20))
