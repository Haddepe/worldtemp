import numpy as np

from tiler import forest


def _blk(cover_val, loss_val=0, f=5):
    return np.full((f, f), cover_val, np.uint8), np.full((f, f), loss_val, np.uint8)


def test_threshold_29_is_not_forest_30_is():
    c, l = _blk(29)
    assert forest.aggregate(c, l, 5)[0][0, 0] == 0
    c, l = _blk(30)
    assert forest.aggregate(c, l, 5)[0][0, 0] == 30


def test_mean_only_over_forest_pixels():
    c = np.zeros((2, 2), np.uint8)
    c[0, 0], c[0, 1], c[1, 0] = 40, 80, 10  # 10 est sous le seuil, 0 aussi
    cov, _, _ = forest.aggregate(c, np.zeros_like(c), 2)
    assert cov[0, 0] == 60


def test_loss_on_non_forest_pixel_ignored():
    c = np.zeros((2, 2), np.uint8)
    l = np.zeros((2, 2), np.uint8)
    c[0, 0], l[0, 1] = 90, 12  # perte sur pixel non forêt
    _, yr, sh = forest.aggregate(c, l, 2)
    assert sh[0, 0] == 0
    assert yr[0, 0] == 0


def test_year_most_recent_among_lost_forest_pixels():
    c = np.full((4, 4), 80, np.uint8)
    l = np.zeros((4, 4), np.uint8)
    l[0, 0], l[3, 3] = 5, 20
    assert forest.aggregate(c, l, 4)[1][0, 0] == 20


def test_thin_clearing_minority_is_kept():
    # route d'un pixel de large dans un bloc 5x5 : 5 pixels perdus sur 25
    c = np.full((5, 5), 90, np.uint8)
    l = np.zeros((5, 5), np.uint8)
    l[:, 2] = 9
    assert forest.aggregate(c, l, 5)[1][0, 0] == 9


def test_factor_1_identity_up_to_threshold():
    rng = np.random.default_rng(0)
    c = rng.integers(0, 101, (8, 8), dtype=np.uint8)
    l = rng.integers(0, 25, (8, 8), dtype=np.uint8)
    cov, yr, sh = forest.aggregate(c, l, 1)
    f = c >= 30
    assert np.array_equal(cov, np.where(f, c, 0))
    assert np.array_equal(yr, np.where(f, l, 0))


def test_composition_4_then_2_close_to_8():
    rng = np.random.default_rng(1)
    c = rng.integers(0, 101, (64, 64), dtype=np.uint8)
    l = (rng.random((64, 64)) < 0.05) * rng.integers(1, 25, (64, 64))
    l = l.astype(np.uint8)
    direct_c, direct_y, direct_s = forest.aggregate(c, l, 8)
    c4, y4, s4 = forest.aggregate(c, l, 4)
    two_c, two_y, two_s = forest.aggregate(c4, y4, 2, s4)
    assert np.array_equal(direct_y, two_y)  # exact
    assert np.abs(direct_c.astype(int) - two_c).max() <= 12  # moyenne de moyennes
    assert np.abs(direct_s.astype(int) - two_s).max() <= 20
    assert ((direct_c == 0) == (two_c == 0)).all()


def test_no_extra_copy_large_array():
    c = np.full((4096, 4096), 50, np.uint8)
    cov, yr, sh = forest.aggregate(c, np.zeros_like(c), 8)
    assert sh.max() == 0
    assert cov.shape == (512, 512) and cov.dtype == np.uint8 and yr.max() == 0


def test_encode_round_trip_and_empty():
    cov = np.zeros((512, 512), np.uint8)
    yr = np.zeros((512, 512), np.uint8)
    assert forest.is_empty_tile(forest.encode_tile(cov, yr, np.zeros_like(cov)))
    cov[3, 4], yr[5, 6] = 77, 18
    sh = np.zeros_like(cov)
    sh[7, 8] = 200
    t = forest.encode_tile(cov, yr, sh)
    assert t.shape == (512, 512, 3) and t.dtype == np.uint8
    assert t[3, 4, forest.CHANNELS["cover"]] == 77
    assert t[5, 6, forest.CHANNELS["year"]] == 18
    assert t[7, 8, forest.CHANNELS["share"]] == 200
    assert not forest.is_empty_tile(t)


def test_is_empty_false_with_single_forest_pixel():
    cov = np.zeros((512, 512), np.uint8)
    cov[0, 0] = 30
    assert not forest.is_empty_tile(forest.encode_tile(cov, np.zeros_like(cov), np.zeros_like(cov)))


def test_share_exact_on_synthetic_block():
    c = np.full((5, 5), 90, np.uint8)
    l = np.zeros((5, 5), np.uint8)
    l[:, 2] = 9  # 5 perdus sur 25 forêt
    assert forest.aggregate(c, l, 5)[2][0, 0] == round(255 * 5 / 25)
    c[0, 0] = 0  # 24 pixels forêt
    assert forest.aggregate(c, l, 5)[2][0, 0] == round(255 * 5 / 24)


def test_share_zero_without_loss_or_forest():
    c = np.full((4, 4), 90, np.uint8)
    assert forest.aggregate(c, np.zeros_like(c), 4)[2][0, 0] == 0
    assert forest.aggregate(np.zeros_like(c), np.full((4, 4), 3, np.uint8), 4)[2][0, 0] == 0
