"""Tuiles forêt (Hansen GFC v1.12) : agrégation 30 m -> niveau et encodage PNG (spec forêt §5-§6)."""
from __future__ import annotations

import numpy as np

FOREST_THRESHOLD = 30  # % de canopée en 2000 : en dessous, pas forêt et aucune perte comptée

# Canaux de la tuile encodée, (H, W, 3) uint8, pour cut.write_png (RGB). MIRROR TS (Task 5).
#   R : couvert en % (0 = pas forêt ; sinon FOREST_THRESHOLD..100)
#   G : année de perte (0 = aucune ; 1..24 = 2001..2024)
#   B : part de perte = round(255 x pixels forêt perdus / pixels forêt du bloc), 0 sans forêt ni perte
CHANNELS = {"cover": 0, "year": 1, "share": 2}


def aggregate(
    cover: np.ndarray,
    loss: np.ndarray,
    factor: int,
    share: np.ndarray | None = None,
    min_loss_share: float = 0.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Réduit des blocs factor x factor ; renvoie (couvert, année, part) uint8 de taille (H/f, W/f).

    - part : round(255 x pixels forêt perdus / pixels forêt) du bloc (0 sans forêt). Le front
      l'utilise pour moduler l'opacité de la perte (de loin, proportionnelle ; au niveau 8 une
      coupe fine reste visible). `share=None` : entrée à 30 m, part calculée. Entrée déjà agrégée :
      passer le `share` du niveau fin ; la part est alors la moyenne arrondie des parts des
      sous-blocs forêt, non pondérée par leur nombre de pixels forêt (approximation, écart
      mesuré <= 14/255 sur données aléatoires ; test : <= 20/255).

    - couvert : moyenne (arrondie) de `cover` sur les seuls pixels forêt (>= 30) du bloc ;
      0 s'il n'y en a aucun. Un bloc donne donc 0 ou une valeur >= 30.
    - année : année de perte la PLUS RÉCENTE parmi les pixels forêt perdus du bloc, 0 si la part
      de pixels perdus (parmi les pixels forêt) est <= `min_loss_share`. Par défaut (0.0), UN seul
      pixel perdu suffit. Justification : les « arêtes de poisson » (routes de 1 à 2 pixels de 30 m)
      ne touchent qu'une minorité des pixels d'un bloc 5x5 ; une règle majoritaire ou à part
      minimale les effacerait au niveau 8. La plus récente (max) est aussi associative.

    Composition : `aggregate(*aggregate(c, l, a), b)` (cover, year, share) donne la même année que `aggregate(c, l, a*b)`
    (exact : « une perte quelque part » et max se composent), et un couvert proche de
    `aggregate(c, l, a*b)` (moyenne de moyennes, non pondérée par le nombre de pixels forêt de
    chaque sous-bloc ; écart borné par 70, en pratique quelques points). Pour la même raison,
    `min_loss_share` > 0 casse l'égalité de composition : le garder à 0 sur la pyramide.
    Les entrées déjà agrégées sont valides : couvert 0 ou >= 30, année ignorée si couvert 0.
    """
    if cover.shape != loss.shape or cover.ndim != 2 or (share is not None and share.shape != cover.shape):
        raise ValueError("cover, loss (et share) doivent être tableaux 2D de même forme")
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
    if share is None:
        n_f = np.maximum(n_forest, 1)
        out_share = (n_lost * 255 + n_f // 2) // n_f
    else:
        s_sum = np.add.reduce(share.reshape(shape), axis=axes, dtype=np.uint32, where=forest)
        n_f = np.maximum(n_forest, 1)
        out_share = (s_sum + n_f // 2) // n_f
    return out_cover.astype(np.uint8), out_year.astype(np.uint8), out_share.astype(np.uint8)


def encode_tile(cover: np.ndarray, year: np.ndarray, share: np.ndarray) -> np.ndarray:
    """Empile en (H, W, 3) uint8 selon CHANNELS (512 x 512 pour une tuile de la pyramide)."""
    if cover.shape != year.shape or cover.shape != share.shape or cover.ndim != 2:
        raise ValueError("cover, year et share doivent être des tableaux 2D de même forme")
    tile = np.zeros((*cover.shape, 3), dtype=np.uint8)
    tile[..., CHANNELS["cover"]] = cover
    tile[..., CHANNELS["year"]] = year
    tile[..., CHANNELS["share"]] = share
    return tile


def is_empty_tile(tile: np.ndarray) -> bool:
    """Vrai si ni forêt ni perte (canaux couvert, année et part tous nuls)."""
    return not (tile[..., CHANNELS["cover"]].any() or tile[..., CHANNELS["year"]].any() or tile[..., CHANNELS["share"]].any())
