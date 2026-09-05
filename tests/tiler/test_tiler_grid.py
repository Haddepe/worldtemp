import pytest

from tiler import grid


def test_tiles_per_level_and_span():
    assert grid.tiles_per_level(0) == (2, 1)
    assert grid.tiles_per_level(8) == (512, 256)
    assert grid.tile_span(0) == 180.0
    assert grid.tile_span(8) == pytest.approx(0.703125)


def test_control_numbers_shared_with_ts():
    b = grid.tile_bounds(0, 1, 0)
    assert (b.lon_min, b.lon_max, b.lat_min, b.lat_max) == (0.0, 180.0, -90.0, 90.0)
    b = grid.tile_bounds(8, 254, 57)
    assert b.lon_min == pytest.approx(-1.40625)
    assert b.lon_max == pytest.approx(-0.703125)
    assert b.lat_min == pytest.approx(49.21875)
    assert b.lat_max == pytest.approx(49.921875)
    assert grid.tile_at(8, -1.62, 49.64) == (253, 57)


def test_tile_at_edges_are_clamped():
    assert grid.tile_at(0, -180.0, 90.0) == (0, 0)
    assert grid.tile_at(0, 180.0, -90.0) == (1, 0)
    assert grid.tile_at(3, 180.0, -90.0) == (15, 7)


def test_pixels_per_degree():
    assert grid.pixels_per_degree(5) == pytest.approx(512 * 32 / 180)
    assert grid.pixels_per_degree(8) == pytest.approx(728.1777, abs=1e-3)


def test_boxes_cover_the_world_once():
    boxes = [grid.box_for_job(n) for n in range(8)]
    assert boxes[0] == grid.Bounds(-180.0, -90.0, 0.0, 90.0)
    assert boxes[4] == grid.Bounds(-180.0, -90.0, -90.0, 0.0)
    assert boxes[7] == grid.Bounds(90.0, 180.0, -90.0, 0.0)
    assert sum(b.width * b.height for b in boxes) == 360 * 180


def test_gebco_pattern():
    assert grid.gebco_pattern(grid.box_for_job(0)) == "*n90.0_s0.0_w-180.0_e-90.0*.tif"
    assert grid.gebco_pattern(grid.box_for_job(7)) == "*n0.0_s-90.0_w90.0_e180.0*.tif"


def test_tile_range_of_a_box():
    assert grid.tile_range(0, grid.box_for_job(0)) == (0, 0, 0, 0)
    assert grid.tile_range(1, grid.box_for_job(5)) == (1, 1, 1, 1)
    assert grid.tile_range(8, grid.box_for_job(3)) == (384, 511, 0, 127)


def test_iter_blocks_partition_the_box():
    blocks = list(grid.iter_blocks(8, grid.box_for_job(0), block=8))
    assert len(blocks) == 16 * 16
    assert blocks[0] == grid.Block(8, 0, 0, 8, 8)
    assert blocks[-1] == grid.Block(8, 120, 120, 8, 8)
    bb = grid.block_bounds(blocks[0])
    assert (bb.lon_min, bb.lat_max) == (-180.0, 90.0)
    assert bb.width == pytest.approx(8 * grid.tile_span(8))


def test_iter_blocks_small_levels_are_single_partial_blocks():
    blocks = list(grid.iter_blocks(1, grid.box_for_job(0), block=8))
    assert blocks == [grid.Block(1, 0, 0, 1, 1)]


def test_bounds_intersects():
    a = grid.Bounds(0, 10, 0, 10)
    assert a.intersects(grid.Bounds(5, 15, 5, 15))
    assert not a.intersects(grid.Bounds(10.5, 20, 0, 10))
