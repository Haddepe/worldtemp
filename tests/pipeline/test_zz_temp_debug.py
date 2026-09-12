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
def test_zz_dump_chem_units():
    import eccodes

    from pipeline.grib_adapter import _with_temp_file

    out = []

    def visit(gid):
        info = {}
        for key in ("shortName", "aerosolType", "units", "name", "parameterUnits", "cfVarName", "packingType"):
            try:
                if eccodes.codes_is_defined(gid, key):
                    info[key] = eccodes.codes_get(gid, key)
            except Exception as exc:
                info[key] = f"ERR:{exc}"
        vals = eccodes.codes_get_values(gid)
        info["min"] = float(vals.min())
        info["max"] = float(vals.max())
        info["mean"] = float(vals.mean())
        out.append(info)

    _with_temp_file(CHEM_FIXTURE.read_bytes(), visit)
    pytest.fail("Unités du fichier chem :\n" + "\n".join(map(str, out)))
