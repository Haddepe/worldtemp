import numpy as np
import pytest

from pipeline import layers
from pipeline.layers import LAYERS, Encoding, LayerSpec, by_source, get
from pipeline.sources import SOURCES


def test_seven_layers_in_menu_order():
    assert [s.id for s in LAYERS] == ["temp", "clouds", "rain", "pressure", "humidity", "pm25", "dust"]


def test_ids_unique_and_sources_exist():
    ids = [s.id for s in LAYERS]
    assert len(set(ids)) == len(ids)
    assert all(s.source in SOURCES for s in LAYERS)


def test_encodings_and_plausible_ranges_are_ordered():
    for s in LAYERS:
        assert s.encoding.min < s.encoding.max, s.id
        assert s.plausible[0] < s.plausible[1], s.id
        assert s.encoding.scale in ("linear", "sqrt"), s.id


def test_by_source_partitions_registry():
    assert [s.id for s in by_source("gfs")] == ["temp", "clouds", "rain", "pressure", "humidity"]
    assert [s.id for s in by_source("gefs_chem")] == ["pm25", "dust"]
    assert by_source("nope") == []


def test_get_known_and_unknown():
    assert get("temp").variable == "TMP_2m"
    with pytest.raises(KeyError):
        get("wind")


def test_encoding_rejects_bad_values():
    with pytest.raises(ValueError):
        Encoding(0, 0, "linear")
    with pytest.raises(ValueError):
        Encoding(0, 1, "log")


@pytest.mark.parametrize("layer_id,raw,expected", [
    ("temp", 288.15, 15.0),
    ("clouds", 42.0, 42.0),
    ("rain", 0.001, 3.6),          # kg/m²/s → mm/h
    ("pressure", 101325.0, 1013.25),
    ("humidity", 101.5, 100.0),    # borné
    ("pm25", 12.0, 12.0),          # déjà en µg/m³ (unité eccodes réelle : (10**-6 g) m**-3)
    ("dust", 500.0, 500.0),
])
def test_convert(layer_id, raw, expected):
    out = get(layer_id).convert(np.array([raw], dtype=np.float64))
    assert out[0] == pytest.approx(expected, rel=1e-9)


def test_temp_layer_keeps_spec_1_encoding():
    e = get("temp").encoding
    assert (e.min, e.max, e.scale) == (-90, 60, "linear")


def test_registry_specs_are_frozen():
    with pytest.raises(Exception):
        LAYERS[0].id = "x"  # type: ignore[misc]
    assert isinstance(LAYERS[0], LayerSpec)
    assert layers.AEROSOL_TOTAL == 62000 and layers.AEROSOL_DUST == 62001
