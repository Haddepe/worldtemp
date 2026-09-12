import io

import numpy as np
import pytest
from PIL import Image

from pipeline.grib_adapter import Field
from pipeline.layers import Encoding, get
from pipeline.texture import (
    InvalidData, dequantize, encode_png, layer_pixels, quantize, reorient, validate_grid, validate_range,
)

LIN = Encoding(-90, 60, "linear")
SQRT = Encoding(0, 50, "sqrt")


def make_field(values=None, fill=288.15):
    if values is None:
        values = np.full((721, 1440), fill, dtype=np.float32)
    return Field(values=values, lat=np.linspace(90, -90, 721), lon=np.arange(0, 360, 0.25))


# --- validate_grid ------------------------------------------------------------

def test_validate_grid_accepts_gfs_grid():
    validate_grid(make_field())


def test_validate_grid_rejects_nan():
    v = np.full((721, 1440), 1.0, np.float32)
    v[3, 4] = np.nan
    with pytest.raises(InvalidData, match="NaN"):
        validate_grid(make_field(v))


def test_validate_grid_rejects_wrong_shape():
    with pytest.raises(InvalidData, match="forme"):
        validate_grid(Field(np.zeros((720, 1440), np.float32), np.linspace(90, -90, 720), np.arange(0, 360, 0.25)))


def test_validate_grid_rejects_south_up_grid():
    with pytest.raises(InvalidData, match="lat"):
        validate_grid(Field(np.zeros((721, 1440), np.float32), np.linspace(-90, 90, 721), np.arange(0, 360, 0.25)))


def test_validate_grid_rejects_shifted_longitudes():
    with pytest.raises(InvalidData, match="lon"):
        validate_grid(Field(np.zeros((721, 1440), np.float32), np.linspace(90, -90, 721), np.arange(-180, 180, 0.25)))


def test_validate_grid_label_in_message():
    with pytest.raises(InvalidData, match="rain"):
        validate_grid(Field(np.zeros((1, 1), np.float32), np.zeros(1), np.zeros(1)), "rain")


# --- validate_range -----------------------------------------------------------

@pytest.mark.parametrize("bad", [179.9, 340.1])
def test_validate_range_rejects_out_of_plausible(bad):
    with pytest.raises(InvalidData, match="plage"):
        validate_range(np.array([288.0, bad]), (180.0, 340.0), "temp")


def test_validate_range_accepts_bounds_inclusive():
    validate_range(np.array([180.0, 340.0]), (180.0, 340.0))


# --- reorient -----------------------------------------------------------------

def test_reorient_rolls_longitude_zero_to_center():
    v = np.zeros((2, 1440), np.float32)
    v[:, 0] = 1
    out = reorient(v)
    assert out[0, 720] == 1 and out[0, 0] == 0


# --- quantize / dequantize ----------------------------------------------------

# Table partagée avec web/tests/encoding.test.ts : (enc, valeur, pixel). Aucun demi-entier
# (np.rint arrondit au pair, Math.round au supérieur).
ROUNDTRIP_CASES = [
    (LIN, -90.0, 0), (LIN, 60.0, 255), (LIN, 0.0, 153), (LIN, 20.0, 187), (LIN, -100.0, 0), (LIN, 70.0, 255),
    (SQRT, 0.0, 0), (SQRT, 50.0, 255), (SQRT, 0.5, 26), (SQRT, 2.0, 51), (SQRT, 12.5, 128), (SQRT, 60.0, 255),
]


@pytest.mark.parametrize("enc,value,pixel", ROUNDTRIP_CASES)
def test_quantize_known_values(enc, value, pixel):
    assert quantize(np.array([value]), enc)[0] == pixel


@pytest.mark.parametrize("enc", [LIN, SQRT])
def test_dequantize_is_inverse_within_one_step(enc):
    px = np.arange(256, dtype=np.uint8)
    back = quantize(dequantize(px, enc), enc)
    assert np.array_equal(back, px)


def test_dequantize_sqrt_is_quadratic():
    assert dequantize(np.array([255], np.uint8), SQRT)[0] == pytest.approx(50.0)
    assert dequantize(np.array([128], np.uint8), SQRT)[0] == pytest.approx(50 * (128 / 255) ** 2)


def test_quantize_rejects_nan():
    with pytest.raises(InvalidData):
        quantize(np.array([np.nan]), LIN)


def test_quantize_returns_uint8_2d_shape_preserved():
    out = quantize(np.zeros((3, 4)), LIN)
    assert out.dtype == np.uint8 and out.shape == (3, 4)


# --- layer_pixels -------------------------------------------------------------

def test_layer_pixels_temp_converts_reorients_and_quantizes():
    v = np.full((721, 1440), 273.15, np.float32)
    v[:, 0] = 293.15  # colonne GFS 0 (lon 0) → 20 °C
    converted, px = layer_pixels(make_field(v), get("temp"))
    assert converted.dtype == np.float64 and converted.shape == (721, 1440)
    assert converted[0, 720] == pytest.approx(20.0) and converted[0, 0] == pytest.approx(0.0, abs=1e-5)
    assert px[0, 720] == 187 and px[0, 0] == 153


def test_layer_pixels_rain_uses_sqrt():
    v = np.full((721, 1440), 0.001, np.float32)  # 3,6 mm/h
    converted, px = layer_pixels(make_field(v), get("rain"))
    assert converted[0, 0] == pytest.approx(3.6, rel=1e-6)
    assert px[0, 0] == round(255 * (3.6 / 50) ** 0.5)


def test_layer_pixels_rejects_implausible_raw_before_convert():
    with pytest.raises(InvalidData, match="pressure"):
        layer_pixels(make_field(fill=50_000.0), get("pressure"))


# --- encode_png ---------------------------------------------------------------

def test_encode_png_roundtrip():
    px = np.arange(0, 256, dtype=np.uint8).reshape(16, 16)
    data = encode_png(px)
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    back = np.array(Image.open(io.BytesIO(data)))
    assert np.array_equal(back, px)


def test_encode_png_rejects_non_uint8():
    with pytest.raises(ValueError):
        encode_png(np.zeros((2, 2), np.float32))
