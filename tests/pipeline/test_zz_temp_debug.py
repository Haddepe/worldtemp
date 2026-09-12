"""Fichier temporaire de diagnostic T4, supprimé avant le commit final."""

from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent.parent / "fixtures"
CHEM_FIXTURE = FIXTURES / "gefs_chem.grib2"


def _grib_stack_available() -> bool:
    try:
        import eccodes  # noqa: F401
    except Exception:
        return False
    return True


@pytest.mark.skipif(not _grib_stack_available(), reason="eccodes indisponible")
def test_zz_dump_chem_messages():
    from pipeline.grib_adapter import list_messages

    msgs = list_messages(CHEM_FIXTURE.read_bytes())
    pytest.fail("Messages du fichier chem :\n" + "\n".join(map(str, msgs)))
