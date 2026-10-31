from datetime import datetime, timezone

import numpy as np
import pytest

from pipeline import config, snow

SHAPE = (config.HEIGHT, config.WIDTH)


def g(v):
    return np.full(SHAPE, v, dtype=np.float32)


def test_frozen_fraction_maps_sentinel_to_zero():
    out = snow.frozen_fraction(np.array([-50, 0, 50, 100, 120], dtype=np.float32))
    assert np.allclose(out, [0, 0, 0.5, 1, 1])


def test_ten_mm_of_fully_frozen_water_is_ten_cm():
    s = snow.advance(snow.start(), 3, g(10), g(100))
    assert np.allclose(s.cum_cm, 10)


def test_cumulative_over_frames():
    s = snow.start()
    got = []
    for fh, p, c in [(3, 2, 100), (6, 5, 50), (9, 5, 100)]:
        s = snow.advance(s, fh, g(p), g(c))
        got.append(float(s.cum_cm[0, 0]))
    assert np.allclose(got, [2, 3.5, 3.5])


def test_negative_increment_is_clamped():
    s = snow.advance(snow.start(), 3, g(5), g(100))
    s2 = snow.advance(s, 6, g(4.9), g(100))
    assert np.array_equal(s2.cum_cm, s.cum_cm)
    assert (s2.cum_cm >= 0).all()


def test_rain_adds_nothing():
    s = snow.advance(snow.start(), 3, g(30), g(0))
    assert (s.cum_cm == 0).all()


def test_advance_refuses_non_increasing_fh():
    s = snow.advance(snow.start(), 3, g(1), g(100))
    with pytest.raises(ValueError):
        snow.advance(s, 3, g(2), g(100))
    with pytest.raises(ValueError):
        snow.advance(s, 0, g(2), g(100))


def test_state_roundtrip_is_exact():
    s = snow.advance(snow.start(), 3, g(1.2345), g(70))
    r = snow.decode_state(snow.encode_state(s))
    assert r.fh == s.fh
    assert np.array_equal(r.apcp_mm, s.apcp_mm)
    assert np.array_equal(r.cum_cm, s.cum_cm)


def test_state_carries_its_run_through_advance_and_roundtrip():
    s = snow.advance(snow.start("2026-10-31T06:00:00Z"), 3, g(1), g(100))
    assert s.run == "2026-10-31T06:00:00Z"
    assert snow.decode_state(snow.encode_state(s)).run == "2026-10-31T06:00:00Z"
    assert snow.start().run == ""


def test_decode_state_rejects_garbage():
    with pytest.raises(ValueError):
        snow.decode_state(b"x")
    small = snow.SnowState(3, np.zeros((10, 10), np.float32), np.zeros((10, 10), np.float32))
    with pytest.raises(ValueError):
        snow.decode_state(snow.encode_state(small))


def test_state_key_is_inside_run_dir():
    run = datetime(2026, 10, 31, 6, tzinfo=timezone.utc)
    assert snow.state_key(run) == "layers/20261031T06Z/gfs_snow_state.npz"
