"""Lecture des dalles Hansen GFC v1.12 (tiler/hansen.py, spec forêt §5.2 et §6).

Les tests `needs_gdal` créent de petites dalles synthétiques (0,25°/px au lieu de 0,00025°/px,
mêmes noms et même géométrie 10° × 10°, LZW à une ligne par bande comme les vraies) : ils
tournent sur Actions (gdal-bin installé) et sont sautés sans GDAL (Windows). Aucun test réseau.
"""
import shutil
import subprocess

import numpy as np
import pytest
from PIL import Image

from tiler import hansen
from tiler.grid import Bounds

HAS_GDAL = shutil.which("gdalwarp") is not None and shutil.which("gdal_translate") is not None
needs_gdal = pytest.mark.skipif(not HAS_GDAL, reason="GDAL absent (attendu sous Windows ; testé sur Actions)")


# --- Noms et sélection des dalles (sans GDAL) ---------------------------------------------------

@pytest.mark.parametrize("lat, lon, name", [
    (0, -60, "00N_060W"),     # Amazonie, nord-ouest de l'hémisphère sud
    (-10, -70, "10S_070W"),   # hémisphère sud
    (80, -180, "80N_180W"),   # antiméridien, rangée la plus au nord
    (10, 0, "10N_000E"),      # méridien d'origine : 000E comme dans la liste officielle
    (-50, 170, "50S_170E"),   # dernière rangée sud, dernière colonne est
])
def test_granule_name(lat, lon, name):
    assert hansen.granule_name(lat, lon) == name


def test_granule_name_rejects_off_grid():
    with pytest.raises(ValueError):
        hansen.granule_name(5, 0)
    with pytest.raises(ValueError):
        hansen.granule_name(0, 180)


def test_granules_for_straddling_two_granules():
    # lon 8..12 à cheval sur 000E et 010E ; lat 4..6 dans la rangée 10N (lat 0..10)
    assert hansen.granules_for(Bounds(8, 12, 4, 6)) == ["10N_000E", "10N_010E"]


def test_granules_for_edges_are_exclusive():
    # Une boîte qui touche seulement un bord n'intersecte pas la dalle voisine
    assert hansen.granules_for(Bounds(0, 10, 0, 10)) == ["10N_000E"]


def test_granules_for_four_granules_order():
    # Ordre : du nord au sud, puis d'ouest en est (lisible, stable)
    assert hansen.granules_for(Bounds(-62, -58, -2, 2)) == ["10N_070W", "10N_060W", "00N_070W", "00N_060W"]


def test_granules_for_antimeridian():
    # Boîte 178°E..182°E (= 178°W) : dalles 170E et 180W, ramenées dans [-180, 180)
    assert hansen.granules_for(Bounds(178, 182, 60, 62)) == ["70N_170E", "70N_180W"]
    assert hansen.granules_for(Bounds(-182, -178, 60, 62)) == ["70N_170E", "70N_180W"]


def test_granules_for_clamped_to_hansen_coverage():
    assert hansen.granules_for(Bounds(0, 5, 82, 88)) == []          # au-delà de 80° N
    assert hansen.granules_for(Bounds(0, 5, -80, -62)) == []        # en deçà de 60° S
    assert hansen.granules_for(Bounds(0, 5, 78, 85)) == ["80N_000E"]
    assert hansen.granules_for(Bounds(0, 5, -65, -58)) == ["50S_000E"]


def test_parse_list_extracts_names():
    text = (f"{hansen.HANSEN_BASE}Hansen_GFC-2024-v1.12_treecover2000_00N_000E.tif\n"
            f"{hansen.HANSEN_BASE}Hansen_GFC-2024-v1.12_treecover2000_80N_180W.tif\n\n")
    assert hansen.parse_list(text, "treecover2000") == {"00N_000E", "80N_180W"}


def test_file_name():
    assert hansen.file_name("lossyear", "00N_060W") == "Hansen_GFC-2024-v1.12_lossyear_00N_060W.tif"


def test_read_block_absent_granules_are_zeros_without_gdal(tmp_path):
    # Aucune dalle intersectée n'est dans la liste officielle (océan) : zéros, sans appel GDAL
    be = hansen.HansenBackend(tmp_path / "work", base=str(tmp_path), available={"treecover2000": set(), "lossyear": set()})
    cover, year = be.read_block(Bounds(-30, -28, 0, 2), 3, 2, 4)
    assert cover.shape == year.shape == (8, 12)
    assert cover.dtype == year.dtype == np.uint8
    assert not cover.any() and not year.any()


def test_read_block_outside_coverage_is_zeros(tmp_path):
    be = hansen.HansenBackend(tmp_path / "work", base=str(tmp_path),
                              available={"treecover2000": {"80N_000E"}, "lossyear": {"80N_000E"}})
    cover, year = be.read_block(Bounds(0, 2, 82, 84), 2, 2, 5)
    assert cover.shape == (10, 10) and not cover.any() and not year.any()


def test_read_block_listed_but_missing_raises(tmp_path):
    # Dalle de la liste officielle introuvable : jamais de trou silencieux
    be = hansen.HansenBackend(tmp_path / "work", base=str(tmp_path),
                              available={"treecover2000": {"10N_000E"}, "lossyear": {"10N_000E"}})
    with pytest.raises(FileNotFoundError):
        be.read_block(Bounds(2, 4, 2, 4), 2, 2, 2)


def test_read_block_rejects_bounds_beyond_antimeridian(tmp_path):
    be = hansen.HansenBackend(tmp_path / "work", base=str(tmp_path), available={"treecover2000": set(), "lossyear": set()})
    with pytest.raises(ValueError):
        be.read_block(Bounds(178, 182, 0, 2), 2, 2, 2)


# --- Lecture réelle par GDAL ------------------------------------------------------------------

def _granule(dir_, layer, name, values, *, lzw=True):
    """Dalle synthétique 40 × 40 px de 0,25° (10° × 10°), coin haut-gauche lu dans `name`.

    `values` : tableau 40 × 40 uint8 ; écrit en PNG + world file puis gdal_translate (EPSG:4326).
    """
    lat_top = int(name[:2]) * (1 if name[2] == "N" else -1)
    lon_left = int(name[4:7]) * (1 if name[7] == "E" else -1)
    png = dir_ / f"{layer}_{name}.png"
    Image.fromarray(values.astype(np.uint8), "L").save(png)
    (dir_ / f"{layer}_{name}.pgw").write_text(
        f"0.25\n0\n0\n-0.25\n{lon_left + 0.125}\n{lat_top - 0.125}\n", encoding="utf-8")
    out = dir_ / hansen.file_name(layer, name)
    co = ["-co", "COMPRESS=LZW", "-co", "BLOCKYSIZE=1"] if lzw else []
    subprocess.run(["gdal_translate", "-q", "-a_srs", "EPSG:4326", *co, str(png), str(out)], check=True)
    png.unlink()
    return out


@pytest.fixture
def pair(tmp_path):
    """Deux dalles voisines 10N_000E (couvert 50, perte 3) et 10N_010E (couvert 80, perte 7).

    Repère dans 10N_000E : un carré de 1° (lon 9..10, lat 5..6) au couvert 90, pour vérifier
    l'orientation nord/sud à l'intérieur d'une dalle.
    """
    src = tmp_path / "hansen"
    src.mkdir()
    west = np.full((40, 40), 50, np.uint8)
    west[16:20, 36:40] = 90  # lignes 16..19 = lat 6..5 ; colonnes 36..39 = lon 9..10
    _granule(src, "treecover2000", "10N_000E", west)
    _granule(src, "treecover2000", "10N_010E", np.full((40, 40), 80, np.uint8))
    _granule(src, "lossyear", "10N_000E", np.full((40, 40), 3, np.uint8))
    _granule(src, "lossyear", "10N_010E", np.full((40, 40), 7, np.uint8))
    names = {"10N_000E", "10N_010E"}
    return src, {"treecover2000": set(names), "lossyear": set(names)}


@needs_gdal
def test_read_block_straddling_two_granules(tmp_path, pair):
    src, available = pair
    be = hansen.HansenBackend(tmp_path / "work", base=str(src), available=available)
    # lon 8..12, lat 4..7 ; 4 × 3 « pixels de tuile » × facteur 2 → 8 × 6 px de 0,5°
    cover, year = be.read_block(Bounds(8, 12, 4, 7), 4, 3, 2)
    assert cover.shape == year.shape == (6, 8)
    assert cover.dtype == year.dtype == np.uint8
    # Colonnes 0..3 = lon 8..10 (ouest), 4..7 = lon 10..12 (est)
    assert (cover[:, 4:] == 80).all() and (year[:, 4:] == 7).all()
    assert (year[:, :4] == 3).all()
    # Repère lon 9..10, lat 5..6 : colonnes 2..3, lignes 2..3 (ligne 0 = lat 7..6,5)
    assert (cover[2:4, 2:4] == 90).all()
    cover[2:4, 2:4] = 50
    assert (cover[:, :4] == 50).all()


@needs_gdal
def test_read_block_mixes_absent_granule_as_zeros(tmp_path, pair):
    src, available = pair
    be = hansen.HansenBackend(tmp_path / "work", base=str(src), available=available)
    # lat 9..11 : moitié nord dans 20N_000E, absente de la liste → zéros
    cover, year = be.read_block(Bounds(2, 4, 9, 11), 2, 2, 2)
    assert cover.shape == (4, 4)
    assert not cover[:2].any() and not year[:2].any()
    assert (cover[2:] == 50).all() and (year[2:] == 3).all()


@needs_gdal
def test_read_block_garbage_granule_raises(tmp_path, pair):
    src, available = pair
    (src / hansen.file_name("lossyear", "10N_010E")).write_bytes(b"pas un GeoTIFF" * 100)
    be = hansen.HansenBackend(tmp_path / "work", base=str(src), available=available)
    with pytest.raises(hansen.HansenReadError):
        be.read_block(Bounds(8, 12, 4, 6), 4, 2, 2)


@needs_gdal
def test_read_block_truncated_granule_raises(tmp_path, pair):
    # Dalle tronquée (téléchargement interrompu) : en-tête lisible, bandes manquantes → doit lever
    src, available = pair
    path = src / hansen.file_name("treecover2000", "10N_010E")
    data = path.read_bytes()
    path.write_bytes(data[: len(data) // 2])
    be = hansen.HansenBackend(tmp_path / "work", base=str(src), available=available)
    with pytest.raises(hansen.HansenReadError):
        be.read_block(Bounds(8, 12, 0, 10), 4, 10, 2)
