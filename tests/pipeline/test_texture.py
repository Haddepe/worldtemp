import io

import numpy as np
import pytest
from PIL import Image

from pipeline.grib_adapter import Field
from pipeline.texture import InvalidData, encode_png, kelvin_to_celsius, quantize, reorient, validate


def make_field(values=None):
    if values is None:
        values = np.full((721, 1440), 288.15, dtype=np.float32)
    return Field(values=values, lat=np.linspace(90, -90, 721), lon=np.arange(0, 360, 0.25))


# --- validate -------------------------------------------------------------

def test_validate_accepts_plausible_field():
    validate(make_field())


def test_validate_rejects_nan():
    v = np.full((721, 1440), 288.15, dtype=np.float32)
    v[10, 10] = np.nan
    with pytest.raises(InvalidData, match="NaN"):
        validate(make_field(v))


@pytest.mark.parametrize("bad", [170.0, 350.0])
def test_validate_rejects_implausible_kelvin(bad):
    v = np.full((721, 1440), 288.15, dtype=np.float32)
    v[0, 0] = bad
    with pytest.raises(InvalidData):
        validate(make_field(v))


def test_validate_rejects_wrong_shape():
    with pytest.raises(InvalidData, match="forme"):
        validate(Field(np.zeros((10, 10), np.float32) + 288, np.zeros(10), np.zeros(10)))


def test_validate_rejects_south_up_grid():
    f = make_field()
    with pytest.raises(InvalidData, match="lat"):
        validate(Field(f.values, f.lat[::-1].copy(), f.lon))


def test_validate_rejects_shifted_longitudes():
    f = make_field()
    with pytest.raises(InvalidData, match="lon"):
        validate(Field(f.values, f.lat, f.lon - 180))


# --- conversions ----------------------------------------------------------

def test_kelvin_to_celsius():
    assert kelvin_to_celsius(np.array([273.15, 288.15])) == pytest.approx([0.0, 15.0])


def test_reorient_rolls_longitude_zero_to_center():
    values = np.tile(np.arange(1440, dtype=np.float32), (721, 1))  # colonne j vaut j
    out = reorient(values)
    assert out.shape == (721, 1440)
    assert (out[:, 720] == 0).all()      # lon 0 arrive au centre
    assert (out[:, 0] == 720).all()      # lon 180 (= -180) arrive à gauche
    assert (out[0] == values[0][[(j + 720) % 1440 for j in range(1440)]]).all()


@pytest.mark.parametrize("celsius,pixel", [(-90, 0), (60, 255), (15, 178), (-15, 128)])
def test_quantize_known_values(celsius, pixel):
    assert quantize(np.array([[float(celsius)]]))[0, 0] == pixel


def test_quantize_clips_out_of_range():
    out = quantize(np.array([[-120.0, 90.0]]))
    assert out.tolist() == [[0, 255]]
    assert out.dtype == np.uint8


def test_quantize_rejects_nan():
    with pytest.raises(InvalidData):
        quantize(np.array([[np.nan]]))


# --- PNG ------------------------------------------------------------------

def test_encode_png_roundtrip():
    pixels = np.random.default_rng(0).integers(0, 256, size=(721, 1440), dtype=np.uint8)
    data = encode_png(pixels)
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    img = Image.open(io.BytesIO(data))
    assert img.mode == "L"
    assert img.size == (1440, 721)
    assert (np.asarray(img) == pixels).all()


def test_encode_png_rejects_non_uint8():
    with pytest.raises(ValueError):
        encode_png(np.zeros((2, 2), dtype=np.float32))
