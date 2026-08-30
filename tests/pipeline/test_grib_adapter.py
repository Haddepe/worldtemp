from pathlib import Path

import numpy as np
import pytest

FIXTURE = Path(__file__).parent.parent / "fixtures" / "gfs_tmp2m.grib2"


def _grib_stack_available() -> bool:
    try:
        import cfgrib  # noqa: F401
        import eccodes  # noqa: F401
    except Exception:  # ImportError, ou RuntimeError « Cannot find the ecCodes library » sur Windows
        return False
    return True


@pytest.mark.skipif(not _grib_stack_available(), reason="cfgrib/eccodes indisponibles (poste Windows)")
def test_decode_real_gfs_file():
    from pipeline.grib_adapter import decode_grib

    field = decode_grib(FIXTURE.read_bytes())
    assert field.values.shape == (721, 1440)
    assert field.values.dtype == np.float32
    assert field.lat.shape == (721,) and field.lon.shape == (1440,)
    assert field.lat[0] == 90 and field.lat[-1] == -90
    assert field.lon[0] == 0 and field.lon[-1] == pytest.approx(359.75)
    assert not np.isnan(field.values).any()
    assert 180 < field.values.min() < field.values.max() < 340


def test_field_importable_without_decoding():
    from pipeline.grib_adapter import Field, decode_grib

    assert callable(decode_grib)
    field = Field(np.zeros((1, 1), np.float32), np.zeros(1), np.zeros(1))
    assert field.values.shape == (1, 1)
