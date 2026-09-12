from datetime import datetime, timezone

import pytest
import requests

from pipeline.layers import by_source, get
from pipeline.nomads import NotFound, TransientError, USER_AGENT, build_url, download
from pipeline.run_selection import Candidate
from pipeline.sources import GEFS_CHEM, GFS

URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25_1hr.pl?dir=x"


class FakeResponse:
    def __init__(self, status_code: int, content: bytes = b""):
        self.status_code = status_code
        self.content = content

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} error")


def fake_get(status_code: int, content: bytes = b""):
    def _get(url, timeout=None, headers=None):
        assert headers == {"User-Agent": USER_AGENT}
        return FakeResponse(status_code, content)

    return _get


def test_build_url_gfs_all_layers_exact():
    c = Candidate(datetime(2026, 8, 30, 6, tzinfo=timezone.utc), 8)
    url = build_url(GFS, c, by_source("gfs"))
    assert url == (
        "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25_1hr.pl"
        "?dir=/gfs.20260830/06/atmos&file=gfs.t06z.pgrb2.0p25.f008"
        "&var_TMP=on&var_TCDC=on&var_PRATE=on&var_PRMSL=on&var_RH=on"
        "&lev_2_m_above_ground=on&lev_entire_atmosphere=on&lev_surface=on&lev_mean_sea_level=on"
    )


def test_build_url_dedups_vars_and_levels_in_first_seen_order():
    c = Candidate(datetime(2026, 8, 30, 6, tzinfo=timezone.utc), 8)
    url = build_url(GFS, c, [get("humidity"), get("temp")])
    assert url.endswith("&var_RH=on&var_TMP=on&lev_2_m_above_ground=on")


def test_build_url_gefs_chem_zero_pads_and_uses_its_patterns():
    c = Candidate(datetime(2026, 9, 12, 0, tzinfo=timezone.utc), 3)
    url = build_url(GEFS_CHEM, c, by_source("gefs_chem"))
    assert url == (
        "https://nomads.ncep.noaa.gov/cgi-bin/filter_gefs_chem_0p25.pl"
        "?dir=/gefs.20260912/00/chem/pgrb2ap25&file=gefs.chem.t00z.a2d_0p25.f003.grib2"
        "&var_PMTF=on&var_PMTC=on&lev_surface=on"
    )


def test_build_url_has_no_subregion():
    c = Candidate(datetime(2026, 8, 30, 6, tzinfo=timezone.utc), 8)
    assert "subregion" not in build_url(GFS, c, by_source("gfs"))


def test_download_200_grib_returns_bytes():
    assert download(URL, get=fake_get(200, b"GRIB...")) == b"GRIB..."


def test_download_404_raises_not_found():
    with pytest.raises(NotFound):
        download(URL, get=fake_get(404))


def test_download_200_html_body_raises_not_found():
    with pytest.raises(NotFound):
        download(URL, get=fake_get(200, b"<html>erreur</html>"))


def test_download_403_raises_transient_error():
    with pytest.raises(TransientError):
        download(URL, get=fake_get(403))


def test_download_429_raises_transient_error():
    with pytest.raises(TransientError):
        download(URL, get=fake_get(429))


def test_download_503_raises_transient_error():
    with pytest.raises(TransientError):
        download(URL, get=fake_get(503))


def test_download_connection_error_raises_transient_error():
    def get(url, timeout=None, headers=None):
        raise requests.ConnectionError("boom")

    with pytest.raises(TransientError):
        download(URL, get=get)


def test_download_400_raises_transient_error():
    with pytest.raises(TransientError):
        download(URL, get=fake_get(400))
