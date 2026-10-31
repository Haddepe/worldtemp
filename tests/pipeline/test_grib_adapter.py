from pathlib import Path

import numpy as np
import pytest

from pipeline.layers import LAYERS, by_source

FIXTURES = Path(__file__).parent.parent / "fixtures"
GFS_FIXTURE = FIXTURES / "gfs_layers.grib2"
CHEM_FIXTURE = FIXTURES / "gefs_chem.grib2"
LEGACY_FIXTURE = FIXTURES / "gfs_tmp2m.grib2"
WIND_FIXTURE = FIXTURES / "gfs_wind.grib2"


def _grib_stack_available() -> bool:
    try:
        import eccodes  # noqa: F401
    except Exception:  # ImportError, ou RuntimeError « Cannot find the ecCodes library » sur Windows
        return False
    return True


needs_eccodes = pytest.mark.skipif(not _grib_stack_available(), reason="eccodes indisponible (poste Windows)")


def _assert_gfs_grid(field):
    assert field.values.shape == (721, 1440) and field.values.dtype == np.float32
    assert field.lat.shape == (721,) and field.lon.shape == (1440,)
    assert field.lat[0] == 90 and field.lat[-1] == -90
    assert field.lon[0] == 0 and field.lon[-1] == pytest.approx(359.75)
    assert not np.isnan(field.values).any()


@needs_eccodes
def test_decode_all_gfs_layers_from_real_file():
    from pipeline.grib_adapter import decode_fields, list_messages

    specs = [s for s in by_source("gfs") if not s.id.startswith("wind_")]  # gfs_layers.grib2 : 5 variables, vent en T3
    try:
        fields = decode_fields(GFS_FIXTURE.read_bytes(), specs)
    except Exception as exc:  # le listing est la seule façon de corriger grib_keys
        pytest.fail(f"{exc}\nMessages du fichier :\n" + "\n".join(map(str, list_messages(GFS_FIXTURE.read_bytes()))))
    assert set(fields) == {s.id for s in specs}
    for s in specs:
        _assert_gfs_grid(fields[s.id])
        lo, hi = float(fields[s.id].values.min()), float(fields[s.id].values.max())
        assert s.plausible[0] <= lo <= hi <= s.plausible[1], (s.id, lo, hi)


@needs_eccodes
def test_decode_chem_layers_from_real_file():
    from pipeline.grib_adapter import decode_fields, list_messages

    specs = by_source("gefs_chem")
    try:
        fields = decode_fields(CHEM_FIXTURE.read_bytes(), specs)
    except Exception as exc:
        pytest.fail(f"{exc}\nMessages du fichier :\n" + "\n".join(map(str, list_messages(CHEM_FIXTURE.read_bytes()))))
    assert set(fields) == {"pm25", "dust"}
    for s in specs:
        _assert_gfs_grid(fields[s.id])
        assert 0 <= float(fields[s.id].values.max()) <= s.plausible[1]
    # Total ≥ poussière fine partout n'est pas garanti (PM10 vs PM2.5) ; on vérifie juste des champs distincts.
    assert not np.array_equal(fields["pm25"].values, fields["dust"].values)


@needs_eccodes
def test_clouds_is_the_instantaneous_message_not_the_average():
    from pipeline.grib_adapter import list_messages

    msgs = [m for m in list_messages(GFS_FIXTURE.read_bytes()) if m.get("shortName") == "tcc"]
    step_types = {m.get("stepType") for m in msgs}
    assert "instant" in step_types and len(msgs) >= 2, msgs


@needs_eccodes
def test_legacy_single_field_file_still_decodes_temp():
    from pipeline.grib_adapter import decode_fields
    from pipeline.layers import get

    fields = decode_fields(LEGACY_FIXTURE.read_bytes(), [get("temp")])
    _assert_gfs_grid(fields["temp"])
    assert 180 < fields["temp"].values.min() < fields["temp"].values.max() < 340


@needs_eccodes
def test_missing_spec_raises_decode_error_listing_ids():
    from pipeline.grib_adapter import DecodeError, decode_fields
    from pipeline.layers import get

    with pytest.raises(DecodeError, match="pm25"):
        decode_fields(LEGACY_FIXTURE.read_bytes(), [get("temp"), get("pm25")])


@needs_eccodes
def test_decode_wind_layers_from_real_file():
    from pipeline.grib_adapter import decode_fields, list_messages
    from pipeline.layers import get

    specs = [get("wind_u"), get("wind_v")]
    try:
        fields = decode_fields(WIND_FIXTURE.read_bytes(), specs)
    except Exception as exc:
        pytest.fail(f"{exc}\nMessages du fichier :\n" + "\n".join(map(str, list_messages(WIND_FIXTURE.read_bytes()))))
    assert set(fields) == {"wind_u", "wind_v"}
    for s in specs:
        _assert_gfs_grid(fields[s.id])
        lo, hi = float(fields[s.id].values.min()), float(fields[s.id].values.max())
        assert s.plausible[0] <= lo <= hi <= s.plausible[1], (s.id, lo, hi)
    speed = np.hypot(fields["wind_u"].values, fields["wind_v"].values)
    assert 0 <= float(speed.max()) < 80, float(speed.max())
    assert not np.array_equal(fields["wind_u"].values, fields["wind_v"].values)


def test_wind_fixture_is_a_small_real_grib():
    data = WIND_FIXTURE.read_bytes()
    assert data[:4] == b"GRIB" and 300_000 < len(data) < 3_000_000


SNOW_F006 = FIXTURES / "gfs_snow_f006.grib2"
SNOW_F009 = FIXTURES / "gfs_snow_f009.grib2"


def test_snow_fixtures_are_small_real_gribs():
    for f in (SNOW_F006, SNOW_F009):
        data = f.read_bytes()
        assert data[:4] == b"GRIB" and 300_000 < len(data) < 4_000_000, f.name


@needs_eccodes
def test_decode_snow_layers_from_real_file():
    import warnings

    from pipeline import snow
    from pipeline.grib_adapter import decode_fields, list_messages
    from pipeline.layers import get

    specs = [get("snowfall"), get("snow_depth"), snow.CPOFP]
    try:
        fields = decode_fields(SNOW_F006.read_bytes(), specs)  # tolère les deux APCP 0-6 identiques
    except Exception as exc:
        pytest.fail(f"{exc}\nMessages du fichier :\n" + "\n".join(map(str, list_messages(SNOW_F006.read_bytes()))))
    assert set(fields) == {"snowfall", "snow_depth", "cpofp"}
    for s in specs:
        _assert_gfs_grid(fields[s.id])
        lo, hi = float(fields[s.id].values.min()), float(fields[s.id].values.max())
        assert s.plausible[0] <= lo <= hi <= s.plausible[1], (s.id, lo, hi)
    cp = fields["cpofp"].values
    assert -50.001 <= float(cp.min()) and float(cp.max()) <= 100.001  # -50 : sentinelle « pas de précip. »
    # Mesure demandée par la spec §6 (borne de snow_depth), lue dans le log Actions.
    f = fields["snow_depth"]
    lat, lon, v = f.lat[:, None], f.lon[None, :], f.values
    antarctique = float(v[np.broadcast_to(lat < -60, v.shape)].max())
    groenland = float(v[np.broadcast_to((lat > 60) & (lat < 84) & (lon > 285) & (lon < 350), v.shape)].max())
    alpes = float(v[np.broadcast_to((lat > 44) & (lat < 48) & (lon > 5) & (lon < 16), v.shape)].max())
    warnings.warn(f"SNOD max global {float(v.max()):.1f} m ; Antarctique (lat<-60) {antarctique:.1f} m ; "
                  f"Groenland (60<lat<84, 285<lon<350) {groenland:.1f} m ; Alpes (44<lat<48, 5<lon<16) {alpes:.2f} m")


@needs_eccodes
def test_snowfall_selects_continuous_apcp():
    from pipeline.grib_adapter import decode_fields, list_messages
    from pipeline.layers import get

    data = SNOW_F009.read_bytes()
    msgs = list_messages(data)
    tps = [m for m in msgs if m.get("shortName") == "tp"]
    assert len(tps) == 2, msgs
    assert sorted(m["startStep"] for m in tps) == [0, 6], tps
    chosen = decode_fields(data, [get("snowfall")])["snowfall"]
    # Somme du message bucket 6-9, relue en isolant startStep == 6.
    import eccodes
    import tempfile, os
    sums = {}
    fd, path = tempfile.mkstemp(suffix=".grib2")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        with open(path, "rb") as fh:
            while (gid := eccodes.codes_grib_new_from_file(fh)) is not None:
                try:
                    if eccodes.codes_get(gid, "shortName") == "tp":
                        sums[int(eccodes.codes_get(gid, "startStep"))] = float(
                            np.asarray(eccodes.codes_get_values(gid), dtype=np.float64).sum())
                finally:
                    eccodes.codes_release(gid)
    finally:
        os.unlink(path)
    assert float(chosen.values.astype(np.float64).sum()) == pytest.approx(sums[0], rel=1e-5)
    assert sums[0] >= sums[6]


def test_module_importable_without_eccodes():
    from pipeline.grib_adapter import DecodeError, Field, decode_fields, list_messages

    assert callable(decode_fields) and callable(list_messages) and issubclass(DecodeError, ValueError)
    assert Field(np.zeros((1, 1), np.float32), np.zeros(1), np.zeros(1)).values.shape == (1, 1)
    assert len(LAYERS) == 11
