from datetime import datetime, timezone

import pytest
import requests

from pipeline.nomads import NotFound, TransientError, USER_AGENT, build_url, download
from pipeline.run_selection import Candidate

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
