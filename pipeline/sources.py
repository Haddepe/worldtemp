"""Descripteurs de source NOMADS (spec couches §4). `primary` : son échec arrête le
run ; une source secondaire en échec voit ses couches reportées (main.py)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

NOMADS = "https://nomads.ncep.noaa.gov/cgi-bin/"


@dataclass(frozen=True)
class SourceSpec:
    id: str
    label: str                  # bandeau côté front (informatif ici)
    model: str                  # champ `model` du manifeste
    filter_url: str
    dir_pattern: str            # .format(ymd=, hh=)
    file_pattern: str           # .format(hh=, fh=)
    step_hours: int             # pas des échéances
    availability_delay: timedelta
    max_forecast_hour: int
    max_candidates: int
    primary: bool


GFS = SourceSpec(
    id="gfs", label="NOAA GFS 0,25°", model="gfs_0p25",
    filter_url=NOMADS + "filter_gfs_0p25_1hr.pl",
    dir_pattern="/gfs.{ymd}/{hh}/atmos",
    file_pattern="gfs.t{hh}z.pgrb2.0p25.f{fh:03d}",
    step_hours=1, availability_delay=timedelta(hours=3, minutes=30),
    max_forecast_hour=48, max_candidates=4, primary=True,
)

GEFS_CHEM = SourceSpec(
    id="gefs_chem", label="NOAA GEFS-Aerosols 0,25°", model="gefs_chem_0p25",
    filter_url=NOMADS + "filter_gefs_chem_0p25.pl",
    dir_pattern="/gefs.{ymd}/{hh}/chem/pgrb2ap25",
    file_pattern="gefs.chem.t{hh}z.a2d_0p25.f{fh:03d}.grib2",
    step_hours=3, availability_delay=timedelta(hours=5),
    max_forecast_hour=84, max_candidates=4, primary=False,
)

# Primaire d'abord : main.py itère dans cet ordre.
SOURCES: dict[str, SourceSpec] = {s.id: s for s in (GFS, GEFS_CHEM)}
