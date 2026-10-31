"""Tuiles forêt (Hansen GFC v1.12) : agrégation 30 m -> niveau et encodage PNG (spec forêt §5-§6)."""
from __future__ import annotations

import numpy as np

FOREST_THRESHOLD = 30  # % de canopée en 2000 : en dessous, pas forêt et aucune perte comptée

# Canaux de la tuile encodée, (H, W, 3) uint8, pour cut.write_png (RGB). MIRROR TS (Task 5).
#   R : couvert en % (0 = pas forêt ; sinon FOREST_THRESHOLD..100)
#   G : année de perte (0 = aucune ; 1..24 = 2001..2024)
#   B : toujours 0 (libre)
CHANNELS = {"cover": 0, "year": 1, "unused": 2}


def aggregate(
    cover: np.ndarray, loss: np.ndarray, factor: int, min_loss_share: float = 0.0
) -> tuple[np.ndarray, np.ndarray]:
    """Réduit des blocs factor x factor ; renvoie (couvert, année) uint8 de taille (H/f, W/f).

    - couvert : moyenne (arrondie) de `cover` sur les seuls pixels forêt (>= 30) du bloc ;
      0 s'il n'y en a aucun. Un bloc donne donc 0 ou une valeur >= 30.
    - année : année de perte la PLUS RÉCENTE parmi les pixels forêt perdus du bloc, 0 si la part
      de pixels perdus (parmi les pixels forêt) est <= `min_loss_share`. Par défaut (0.0), UN seul
      pixel perdu suffit. Justification : les « arêtes de poisson » (routes de 1 à 2 pixels de 30 m)
      ne touchent qu'une minorité des pixels d'un bloc 5x5 ; une règle majoritaire ou à part
      minimale les effacerait au niveau 8. La plus récente (max) est aussi associative.

    Composition : `aggregate(*aggregate(c, l, a), b)` donne la même année que `aggregate(c, l, a*b)`
    (exact : « une perte quelque part » et max se composent), et un couvert proche de
    `aggregate(c, l, a*b)` (moyenne de moyennes, non pondérée par le nombre de pixels forêt de
    chaque sous-bloc ; écart borné par 70, en pratique quelques points). Pour la même raison,
    `min_loss_share` > 0 casse l'égalité de composition : le garder à 0 sur la pyramide.
    Les entrées déjà agrégées sont valides : couvert 0 ou >= 30, année ignorée si couvert 0.
    """
    if cover.shape != loss.shape or cover.ndim != 2:
        raise ValueError("cover et loss doivent être deux tableaux 2D de même forme")
    h, w = cover.shape
    if factor < 1 or h % factor or w % factor:
        raise ValueError("H et W doivent être des multiples de factor")
    shape = (h // factor, factor, w // factor, factor)
    c = cover.reshape(shape)  # vues, sans copie
    y = loss.reshape(shape)
    axes = (1, 3)

    forest = c >= FOREST_THRESHOLD
    n_forest = forest.sum(axis=axes, dtype=np.uint32)
    total = np.add.reduce(c, axis=axes, dtype=np.uint32, where=forest)
    out_cover = np.where(n_forest > 0, (total + n_forest // 2) // np.maximum(n_forest, 1), 0)

    lost = forest & (y > 0)
    n_lost = lost.sum(axis=axes, dtype=np.uint32)
    latest = np.maximum.reduce(y, axis=axes, where=lost, initial=0)
    keep = n_lost > min_loss_share * n_forest  # min_loss_share = 0 : au moins un pixel perdu
    out_year = np.where(keep, latest, 0)
    return out_cover.astype(np.uint8), out_year.astype(np.uint8)


def encode_tile(cover: np.ndarray, year: np.ndarray) -> np.ndarray:
    """Empile en (H, W, 3) uint8 selon CHANNELS (512 x 512 pour une tuile de la pyramide)."""
    if cover.shape != year.shape or cover.ndim != 2:
        raise ValueError("cover et year doivent être deux tableaux 2D de même forme")
    tile = np.zeros((*cover.shape, 3), dtype=np.uint8)
    tile[..., CHANNELS["cover"]] = cover
    tile[..., CHANNELS["year"]] = year
    return tile


def is_empty_tile(tile: np.ndarray) -> bool:
    """Vrai si ni forêt ni perte (canaux couvert et année tous deux nuls)."""
    return not (tile[..., CHANNELS["cover"]].any() or tile[..., CHANNELS["year"]].any())
