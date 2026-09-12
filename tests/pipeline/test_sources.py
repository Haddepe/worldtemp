from datetime import timedelta

from pipeline.sources import GEFS_CHEM, GFS, SOURCES


def test_primary_is_gfs_and_unique():
    assert [s.id for s in SOURCES.values() if s.primary] == ["gfs"]
    assert list(SOURCES) == ["gfs", "gefs_chem"]  # primaire d'abord


def test_gfs_matches_spec_1():
    assert GFS.filter_url.endswith("/filter_gfs_0p25_1hr.pl")
    assert GFS.step_hours == 1 and GFS.availability_delay == timedelta(hours=3, minutes=30)
    assert GFS.max_forecast_hour == 48 and GFS.max_candidates == 4
    assert GFS.dir_pattern.format(ymd="20260912", hh="06") == "/gfs.20260912/06/atmos"
    assert GFS.file_pattern.format(hh="06", fh=8) == "gfs.t06z.pgrb2.0p25.f008"
    assert GFS.model == "gfs_0p25" and GFS.label == "NOAA GFS 0,25°"


def test_gefs_chem_matches_spec():
    assert GEFS_CHEM.filter_url.endswith("/filter_gefs_chem_0p25.pl")
    assert GEFS_CHEM.step_hours == 3 and GEFS_CHEM.availability_delay == timedelta(hours=5)
    assert GEFS_CHEM.max_forecast_hour == 84 and not GEFS_CHEM.primary
    assert GEFS_CHEM.dir_pattern.format(ymd="20260912", hh="00") == "/gefs.20260912/00/chem/pgrb2ap25"
    assert GEFS_CHEM.file_pattern.format(hh="00", fh=3) == "gefs.chem.t00z.a2d_0p25.f003.grib2"
    assert GEFS_CHEM.model == "gefs_chem_0p25"
