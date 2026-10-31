"""Lecture des dalles Hansen GFC v1.12 (tiler/hansen.py, spec forêt §5.2 et §6).

Les tests `needs_gdal` créent de petites dalles synthétiques (0,25°/px au lieu de 0,00025°/px,
mêmes noms et même géométrie 10° × 10°, LZW à une ligne par bande comme les vraies) : ils
tournent sur Actions (gdal-bin installé) et sont sautés sans GDAL (Windows). Aucun test réseau.
"""
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

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
def test_read_block_seam_is_pixel_exact(tmp_path):
    # Valeurs distinctes par colonne (couvert) et par ligne (perte) : un décalage d'un pixel à la
    # jointure ou en latitude ferait échouer le test (règle R1 : grille exacte du bloc).
    src = tmp_path / "hansen"
    src.mkdir()
    cols = np.arange(40, dtype=np.uint8)
    rows = np.arange(40, dtype=np.uint8)[:, None]
    _granule(src, "treecover2000", "10N_000E", np.broadcast_to(100 + cols, (40, 40)))  # 100..139
    _granule(src, "treecover2000", "10N_010E", np.broadcast_to(150 + cols, (40, 40)))  # 150..189
    _granule(src, "lossyear", "10N_000E", np.broadcast_to(1 + rows, (40, 40)))         # 1..40
    _granule(src, "lossyear", "10N_010E", np.broadcast_to(101 + rows, (40, 40)))       # 101..140
    names = {"10N_000E", "10N_010E"}
    be = hansen.HansenBackend(tmp_path / "work", base=str(src),
                              available={"treecover2000": set(names), "lossyear": set(names)})
    # lon 9..11, lat 5..7 à 0,25°/px (résolution native des dalles synthétiques) : 8 × 8 px
    cover, year = be.read_block(Bounds(9, 11, 5, 7), 4, 4, 2)
    # Colonnes : lon 9..10 = colonnes 36..39 de l'ouest ; lon 10..11 = colonnes 0..3 de l'est
    expected_cols = np.array([136, 137, 138, 139, 150, 151, 152, 153], np.uint8)
    assert (cover == expected_cols[None, :]).all()
    # Lignes : lat 7..5 = lignes 12..19 des dalles (ligne 0 = lat 10..9,75)
    expected_rows = np.arange(13, 21, dtype=np.uint8)
    assert (year[:, :4] == expected_rows[:, None]).all()
    assert (year[:, 4:] == 100 + expected_rows[:, None]).all()


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


def test_download_cache_is_bounded_and_keeps_current_block(tmp_path, monkeypatch):
    # Téléchargement simulé (aucun réseau) : le cache LRU ne garde que max_cached dalles sur disque
    # et n'évince jamais une dalle du bloc en cours.
    got = []

    def fake_download(url, dest, **retry):
        got.append(url.rsplit("/", 1)[-1])
        dest.write_bytes(b"x")

    monkeypatch.setattr(hansen, "_download", fake_download)
    be = hansen.HansenBackend(tmp_path / "work", available={"treecover2000": set(), "lossyear": set()}, max_cached=2)
    work = tmp_path / "work"
    keep = {work / hansen.file_name("lossyear", n) for n in ("00N_000E", "00N_010E", "00N_020E")}
    for n in ("00N_000E", "00N_010E", "00N_020E"):
        be._fetch("lossyear", n, keep)
    assert len(list(work.glob("*.tif"))) == 3  # bloc en cours : rien d'évincé
    be._fetch("lossyear", "10N_000E", {work / hansen.file_name("lossyear", "10N_000E")})
    # Les plus anciennes sont évincées jusqu'à revenir à max_cached
    assert sorted(p.name for p in work.glob("*.tif")) == sorted(
        hansen.file_name("lossyear", n) for n in ("00N_020E", "10N_000E"))
    be._fetch("lossyear", "10N_000E", set())  # déjà en cache : pas de second téléchargement
    assert got.count(hansen.file_name("lossyear", "10N_000E")) == 1
    be.close()
    assert not list(work.glob("*.tif"))


# --- Téléchargement réel sur un serveur HTTP local (127.0.0.1, aucun réseau externe) -----------

BODY = bytes(range(256)) * 40  # 10 240 octets


class _Handler(BaseHTTPRequestHandler):
    hits: dict = {}

    def log_message(self, *args):  # silence
        pass

    def do_GET(self):
        n = self.hits[self.path] = self.hits.get(self.path, 0) + 1
        if self.path == "/full.tif" or (self.path == "/flaky.tif" and n > 1):
            self._send(200, BODY, len(BODY))
        elif self.path == "/flaky.tif" or self.path == "/down.tif":
            self._send(500, b"oops", 4)
        elif self.path == "/short.tif":
            self._send(200, BODY[:100], len(BODY))  # Content-Length > corps, puis fermeture
        elif self.path == "/nolen.tif":
            self._send(200, BODY, None)  # HTTP/1.0 : corps délimité par la fermeture
        elif self.path in ("/treecover2000.txt", "/lossyear.txt"):
            layer = self.path[1:-4]
            if n == 1:
                self._send(503, b"busy", 4)
            else:
                self._send(200, (f"http://x/{hansen.file_name(layer, '00N_060W')}" + chr(10)).encode(), None)
        else:
            self._send(404, b"no", 2)

    def _send(self, code, body, length):
        self.send_response(code)
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def server():
    _Handler.hits = {}
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def _no_sleep(record):
    return lambda s: record.append(s)


def test_download_complete_file(tmp_path, server):
    dest = tmp_path / "full.tif"
    hansen._download(f"{server}/full.tif", dest, sleep=_no_sleep([]))
    assert dest.read_bytes() == BODY
    assert not list(tmp_path.glob("*.part"))


def test_download_truncated_raises_and_leaves_no_part(tmp_path, server):
    waits = []
    dest = tmp_path / "short.tif"
    with pytest.raises(hansen.HansenReadError):
        hansen._download(f"{server}/short.tif", dest, sleep=_no_sleep(waits))
    assert not dest.exists() and not list(tmp_path.glob("*.part"))
    assert _Handler.hits["/short.tif"] == hansen.RETRIES  # réessayé
    assert waits == [2.0, 4.0, 8.0, 16.0]  # pas d'attente après le dernier essai


def test_download_one_failure_then_success(tmp_path, server):
    waits = []
    dest = tmp_path / "flaky.tif"
    hansen._download(f"{server}/flaky.tif", dest, sleep=_no_sleep(waits))
    assert dest.read_bytes() == BODY
    assert _Handler.hits["/flaky.tif"] == 2 and waits == [2.0]


def test_download_4xx_is_not_retried(tmp_path, server):
    waits = []
    with pytest.raises(hansen.HansenReadError, match="404"):
        hansen._download(f"{server}/missing.tif", tmp_path / "m.tif", sleep=_no_sleep(waits))
    assert _Handler.hits["/missing.tif"] == 1 and waits == []
    assert not list(tmp_path.glob("*"))


def test_download_5xx_exhausts_retries(tmp_path, server):
    with pytest.raises(hansen.HansenReadError):
        hansen._download(f"{server}/down.tif", tmp_path / "d.tif", sleep=_no_sleep([]))
    assert _Handler.hits["/down.tif"] == hansen.RETRIES


def test_download_without_content_length_raises(tmp_path, server):
    with pytest.raises(hansen.HansenReadError, match="Content-Length"):
        hansen._download(f"{server}/nolen.tif", tmp_path / "n.tif", sleep=_no_sleep([]))
    assert _Handler.hits["/nolen.tif"] == 1
    assert not list(tmp_path.glob("*"))


def test_backoff_is_exponential_and_capped():
    assert [hansen.backoff(a) for a in range(7)] == [2.0, 4.0, 8.0, 16.0, 32.0, 60.0, 60.0]


def test_official_lists_are_retried(tmp_path, server):
    waits = []
    be = hansen.HansenBackend(tmp_path / "work", base=server, sleep=_no_sleep(waits))
    assert be.available == {"treecover2000": {"00N_060W"}, "lossyear": {"00N_060W"}}
    assert _Handler.hits["/treecover2000.txt"] == 2 and _Handler.hits["/lossyear.txt"] == 2
    assert waits == [2.0, 2.0]


def test_close_removes_leftover_part_files(tmp_path):
    be = hansen.HansenBackend(tmp_path / "work", available={"treecover2000": set(), "lossyear": set()})
    (tmp_path / "work" / "x.tif.part").write_bytes(b"x")
    be.close()
    assert not list((tmp_path / "work").glob("*.part"))
