"""Couche neige (spec R5a §6). Deux champs publiés par la source `gfs_snow` :
`snowfall` (chutes de neige cumulées, dérivées) et `snow_depth` (épaisseur au sol, SNOD).

`CPOFP` (pourcentage de précipitation gelée) n'est qu'une entrée du calcul des chutes : décodée
avec les autres champs, jamais publiée, donc absente de `LAYERS`. -50 = « pas de précipitation » (sentinelle NCEP,
lue en réel à -50,0000076 : d'où la marge de `plausible`) ; le calcul des chutes devra l'écarter."""

from __future__ import annotations

from pipeline.layers import Encoding, LayerSpec, _identity, _keys

CPOFP = LayerSpec("cpofp", "gfs_snow", "CPOFP_surface", "%", "CPOFP", "surface",
                  _keys(shortName="cpofp", typeOfLevel="surface"),
                  _identity, (-51.0, 101.0), Encoding(0, 100, "linear"))
