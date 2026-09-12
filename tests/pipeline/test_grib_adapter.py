from pathlib import Path

import numpy as np
import pytest

from pipeline.layers import LAYERS, by_source

FIXTURES = Path(__file__).parent.parent / "fixtures"
GFS_FIXTURE = FIXTURES / "gfs_layers.grib2"
CHEM_FIXTURE = FIXTURES / "gefs_chem.grib2"
LEGACY_FIXTURE = FIXTURES / "gfs_tmp2m.grib2"


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

    specs = by_source("gfs")
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


def test_module_importable_without_eccodes():
    from pipeline.grib_adapter import DecodeError, Field, decode_fields, list_messages

    assert callable(decode_fields) and callable(list_messages) and issubclass(DecodeError, ValueError)
    assert Field(np.zeros((1, 1), np.float32), np.zeros(1), np.zeros(1)).values.shape == (1, 1)
    assert len(LAYERS) == 7
