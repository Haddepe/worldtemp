from datetime import datetime, timezone

from pipeline.nomads import build_url
from pipeline.run_selection import Candidate


def test_build_url_exact_for_06z_f008():
    c = Candidate(datetime(2026, 8, 30, 6, tzinfo=timezone.utc), 8)
    assert build_url(c) == (
        "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25_1hr.pl"
        "?dir=/gfs.20260830/06/atmos"
        "&file=gfs.t06z.pgrb2.0p25.f008"
        "&var_TMP=on&lev_2_m_above_ground=on"
    )


def test_build_url_zero_pads_hour_and_forecast():
    c = Candidate(datetime(2026, 1, 2, 0, tzinfo=timezone.utc), 26)
    url = build_url(c)
    assert "dir=/gfs.20260102/00/atmos" in url
    assert "file=gfs.t00z.pgrb2.0p25.f026" in url


def test_build_url_has_no_subregion():
    c = Candidate(datetime(2026, 8, 30, 6, tzinfo=timezone.utc), 8)
    assert "subregion" not in build_url(c)
