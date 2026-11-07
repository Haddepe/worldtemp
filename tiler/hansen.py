"""Lecture des dalles Hansen GFC-2024-v1.12 par blocs (spec forêt §5.2 et §6).

Dalles officielles : GeoTIFF 10° × 10°, 40 000 × 40 000 px de 0,00025° (≈ 30 m), uint8, LZW,
une ligne par bande (strip), sans aperçus ni nodata. Nom = coin haut-gauche (`00N_060W` couvre
lat 0..-10, lon -60..-50). Couverture 80° N – 60° S ; une dalle absente des listes officielles
(`treecover2000.txt`, `lossyear.txt`) est de l'océan : zéros. Une dalle listée qui ne se lit pas
lève toujours (jamais de trou silencieux).

Stratégie de lecture : téléchargement complet des dalles dans le dossier de travail, avec un
cache LRU borné (`max_cached` fichiers), plutôt que `/vsicurl/`. Les dalles étant en bandes d'une
ligne (40 000 bandes par fichier, ≈ 3 à 10 Ko chacune), une fenêtre par `/vsicurl/` coûterait des
milliers de requêtes HTTP par bloc et relirait les mêmes bandes pour chaque bloc voisin ; un
téléchargement entier (113 Mo + 376 Mo pour `00N_060W`) est un seul GET vérifié en taille.

Rééchantillonnage : `gdalwarp -r near` directement sur la grille exacte du bloc (règle R1) ; les
dalles sont passées ensemble à gdalwarp (mosaïque implicite) plutôt que par `gdalbuildvrt`, qui
saute sans échouer une dalle illisible.

Seul autre module (avec gdal_adapter) qui exécute des programmes externes ; testé réellement sur
Actions (`gdal-bin`), sauté sous Windows.
"""
from __future__ import annotations

import http.client
import math
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from pathlib import Path

import numpy as np

from .forest import FOREST_THRESHOLD
from .grid import Bounds

HANSEN_BASE = "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2024-v1.12/"
HANSEN_VERSION = "v1.12"
# Règle R7 : une dalle `lossyear` v1.12 en 404 sur une zone de forêt est remplacée par la même dalle
# de GFC-2023-v1.11 (même grille, années 1–23 : 2024 manque sur ces dalles, signalé au manifeste).
FALLBACK_BASE = "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2023-v1.11/"
FALLBACK_VERSION = "v1.11"
_FALLBACK_PREFIX = "Hansen_GFC-2023-v1.11_"
_PREFIX = "Hansen_GFC-2024-v1.12_"
LAYERS = ("treecover2000", "lossyear")  # ordre des sorties de read_block : couvert, année

LAT_TOP_MAX = 80   # rangée la plus au nord : 80N (lat 80..70)
LAT_TOP_MIN = -50  # rangée la plus au sud : 50S (lat -50..-60)
GRANULE_DEG = 10


class HansenReadError(RuntimeError):
    """Dalle officielle illisible (téléchargement incomplet, GeoTIFF corrompu, erreur GDAL)."""


class GranuleNotFound(HansenReadError):
    """Dalle listée à laquelle le serveur répond 404 (définitif) : voir la règle R6 de `read_block`."""


def granule_name(lat_top: int, lon_left: int) -> str:
    """Nom Hansen d'une dalle depuis son coin haut-gauche : (0, -60) → `00N_060W`, (10, 0) → `10N_000E`."""
    if lat_top % GRANULE_DEG or lon_left % GRANULE_DEG or not -180 <= lon_left < 180:
        raise ValueError(f"coin hors grille Hansen : lat {lat_top}, lon {lon_left}")
    ns = "N" if lat_top >= 0 else "S"
    ew = "E" if lon_left >= 0 else "W"
    return f"{abs(lat_top):02d}{ns}_{abs(lon_left):03d}{ew}"


def file_name(layer: str, name: str) -> str:
    return f"{_PREFIX}{layer}_{name}.tif"


def fallback_file_name(layer: str, name: str) -> str:
    return f"{_FALLBACK_PREFIX}{layer}_{name}.tif"


def granules_for(bounds: Bounds) -> list[str]:
    """Dalles 10° intersectées (bords exclus), du nord au sud puis d'ouest en est.

    Bornées à la couverture Hansen (80° N – 60° S). Les longitudes au-delà de ±180°
    (boîte à cheval sur l'antiméridien) sont ramenées dans [-180, 180).
    """
    tops = []
    t = math.ceil(bounds.lat_max / GRANULE_DEG) * GRANULE_DEG
    while t > bounds.lat_min:
        if LAT_TOP_MIN <= t <= LAT_TOP_MAX:
            tops.append(t)
        t -= GRANULE_DEG
    lefts = []
    lon = math.floor(bounds.lon_min / GRANULE_DEG) * GRANULE_DEG
    while lon < bounds.lon_max:
        wrapped = (lon + 180) % 360 - 180
        if wrapped not in lefts:
            lefts.append(wrapped)
        lon += GRANULE_DEG
    return [granule_name(top, left) for top in tops for left in lefts]


def parse_list(text: str, layer: str) -> set[str]:
    """Noms de dalles d'une liste officielle (une URL complète par ligne)."""
    head = f"{_PREFIX}{layer}_"
    names = set()
    for line in text.split():
        base = line.rsplit("/", 1)[-1]
        if base.startswith(head) and base.endswith(".tif"):
            names.add(base[len(head):-4])
    return names


def _is_url(base: str) -> bool:
    return base.startswith(("http://", "https://"))


RETRIES = 5
BACKOFF_CAP = 60.0  # secondes


def backoff(attempt: int) -> float:
    """Délai avant l'essai `attempt + 1` : 2, 4, 8, 16, 32 s… plafonné à BACKOFF_CAP."""
    return min(BACKOFF_CAP, 2.0 * 2 ** attempt)


class _ShortRead(OSError):
    """Corps plus court que Content-Length : réessayé comme une coupure réseau."""


def _with_retries(what: str, fn, *, retries: int = RETRIES, delay=backoff, sleep=time.sleep):
    """Appelle `fn()` jusqu'à `retries` fois (erreurs réseau, 5xx, réponse tronquée).

    Un 4xx (404…) lève tout de suite : réessayer ne le corrigera pas. Pas d'attente après le
    dernier essai. `delay` et `sleep` sont injectables (tests rapides).
    """
    last: Exception | None = None
    for attempt in range(retries):
        try:
            return fn()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise GranuleNotFound(f"{what} : HTTP 404") from e
            if 400 <= e.code < 500:
                raise HansenReadError(f"{what} : HTTP {e.code}") from e
            last = e
        except (OSError, http.client.HTTPException) as e:  # URLError, coupure, IncompleteRead, _ShortRead
            last = e
        if attempt < retries - 1:
            sleep(delay(attempt))
    raise HansenReadError(f"{what} : échec après {retries} essais ({last!r})")


def _download(url: str, dest: Path, **retry) -> None:
    """GET complet vers `dest` (via `dest.part`), vérifié contre Content-Length.

    Content-Length absent → HansenReadError immédiate (taille invérifiable). Le `.part` est
    toujours supprimé en cas d'échec. `retry` : options de `_with_retries`.
    """
    part = dest.with_name(dest.name + ".part")

    def attempt() -> None:
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                length = r.headers.get("Content-Length")
                if length is None:
                    raise HansenReadError(f"{url} : Content-Length absent, taille invérifiable")
                expected = int(length)
                with open(part, "wb") as f:
                    shutil.copyfileobj(r, f, length=1 << 22)
            got = part.stat().st_size
            if got != expected:
                raise _ShortRead(f"{got} octets reçus sur {expected}")
            part.replace(dest)
        finally:
            part.unlink(missing_ok=True)

    _with_retries(f"téléchargement {url}", attempt, **retry)


def _fetch_text(url: str, **retry) -> str:
    """Petit fichier texte (listes officielles) avec les mêmes essais que les dalles."""

    def attempt() -> bytes:
        with urllib.request.urlopen(url, timeout=60) as r:
            length = r.headers.get("Content-Length")
            body = r.read()
        if length is not None and len(body) != int(length):
            raise _ShortRead(f"{len(body)} octets reçus sur {length}")
        return body

    body = _with_retries(f"lecture {url}", attempt, **retry)
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError as e:  # liste corrompue : réessayer ne la corrigera pas
        raise HansenReadError(f"lecture {url} : contenu non UTF-8 ({e})") from e


class HansenBackend:
    """Couvert 2000 (%) et année de perte (0–24) pour un bloc, en uint8 (H·factor, W·factor).

    - `base` : URL du dépôt Hansen (téléchargement dans `work_dir`) ou dossier local contenant
      déjà les dalles (lues en place ; utilisé par les tests).
    - `available` : {couche: noms de dalles existantes} ; None → listes officielles lues sous `base`.
    - `max_cached` : nombre maximal de dalles téléchargées gardées sur disque (toutes couches) ;
      un bloc de 5,6° touche au plus 4 dalles par couche, lues couche par couche. Défaut 8 :
      ≤ 4 paires, ≈ 2 Go au pire (paire `00N_060W` = 489 Mo).
    """

    def __init__(self, work_dir: Path, base: str = HANSEN_BASE,
                 available: dict[str, set[str]] | None = None, max_cached: int = 8,
                 sleep=time.sleep, fallback_base: str | None = None) -> None:
        self.work = Path(work_dir)
        self.work.mkdir(parents=True, exist_ok=True)
        self.base = base if not _is_url(base) or base.endswith("/") else base + "/"
        self.max_cached = max_cached
        self._cache: OrderedDict[Path, None] = OrderedDict()
        # Dépôt de repli R7 (URL) ; None → pas de repli, un lossyear 404 sur forêt lève.
        self.fallback_base = (fallback_base if fallback_base is None or fallback_base.endswith("/")
                              else fallback_base + "/")
        self.fallback: set[str] = set()  # dalles dont le lossyear vient de FALLBACK_VERSION
        self.missing: set[tuple[str, str]] = set()  # (couche, dalle) listées mais 404 (R6)
        self.downloads = 0  # nombre de GET de dalles et octets reçus (mesure sur Actions)
        self.downloaded_bytes = 0
        self._sleep = sleep  # injectable : attentes entre essais réseau (tests rapides)
        self.available = (available if available is not None
                          else {layer: self._load_list(layer) for layer in LAYERS})

    def _load_list(self, layer: str) -> set[str]:
        if _is_url(self.base):
            text = _fetch_text(f"{self.base}{layer}.txt", sleep=self._sleep)
        else:
            path = Path(self.base) / f"{layer}.txt"
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError as e:
                raise HansenReadError(f"lecture {path} : contenu non UTF-8 ({e})") from e
        names = parse_list(text, layer)
        if not names:
            raise HansenReadError(f"liste officielle vide : {layer}")
        return names

    def _fetch(self, layer: str, name: str, keep: set[Path], *, fallback: bool = False) -> Path:
        """Chemin local de la dalle ; téléchargée si besoin. Ne supprime jamais une dalle de `keep`.

        `fallback` : la dalle de même nom du dépôt de repli R7 (`fallback_base`).
        """
        fname = fallback_file_name(layer, name) if fallback else file_name(layer, name)
        base = self.fallback_base if fallback else self.base
        if not fallback and not _is_url(self.base):
            path = Path(self.base) / fname
            if not path.is_file():
                raise FileNotFoundError(f"dalle listée mais introuvable : {path}")
            return path
        path = self.work / fname
        if path in self._cache:
            self._cache.move_to_end(path)
            return path
        for old in list(self._cache):
            if len(self._cache) < self.max_cached:
                break
            if old not in keep:
                old.unlink(missing_ok=True)
                del self._cache[old]
        _download(base + fname, path, sleep=self._sleep)
        self.downloads += 1
        self.downloaded_bytes += path.stat().st_size
        self._cache[path] = None
        return path

    def _warp(self, sources: list[Path], bounds: Bounds, w: int, h: int, layer: str) -> np.ndarray:
        stem = self.work / f"{layer}_block"
        dst = stem.with_suffix(".bin")
        cmd = [
            "gdalwarp", "-q", "-overwrite", "-of", "ENVI", "-ot", "Byte", "-t_srs", "EPSG:4326",
            "-te", repr(bounds.lon_min), repr(bounds.lat_min), repr(bounds.lon_max), repr(bounds.lat_max),
            "-ts", str(w), str(h), "-r", "near",
            "-srcnodata", "None", "-dstnodata", "None", "-wo", "INIT_DEST=0",
            "-wm", "512", "-multi", "-wo", "NUM_THREADS=ALL_CPUS",
            *map(str, sources), str(dst),
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True)
            # Toute erreur GDAL lève, même si gdalwarp sort avec 0 (lecture d'une bande corrompue).
            if res.returncode != 0 or "ERROR" in res.stderr:
                raise HansenReadError(f"gdalwarp {layer} {[p.name for p in sources]} : {res.stderr.strip()}")
            if not dst.is_file() or dst.stat().st_size != w * h:
                raise HansenReadError(f"sortie gdalwarp {layer} de taille inattendue")
            return np.fromfile(dst, dtype=np.uint8).reshape(h, w)
        finally:
            for p in self.work.glob(f"{stem.name}.*"):
                p.unlink(missing_ok=True)

    def read_block(self, bounds: Bounds, width: int, height: int, factor: int) -> tuple[np.ndarray, np.ndarray]:
        """(couvert, année) de forme (height·factor, width·factor) sur la grille exacte de `bounds`.

        Règle R6 : une dalle listée qui répond 404 n'est traitée comme vide (zéros) que si elle ne
        peut pas cacher de forêt, vérifié sur sa partie du bloc : les 2 couches 404 → zéros ;
        `lossyear` seul 404 → lève s'il y a de la forêt (couvert ≥ FOREST_THRESHOLD) ;
        `treecover2000` seul 404 → lève s'il y a une perte. Tout autre échec lève toujours.

        Règle R7 : `lossyear` seul 404 sur une zone de forêt → la même dalle du dépôt de repli
        (v1.11) est lue à la place, consignée dans `self.fallback` ; si elle manque aussi (ou sans
        dépôt de repli), lève.
        """
        if bounds.lon_min < -180 or bounds.lon_max > 180:
            raise ValueError("bloc au-delà de l'antiméridien : découper en [-180, 180] avant read_block")
        w, h = width * factor, height * factor
        names = granules_for(bounds)
        out = []
        absent: dict[str, set[str]] = {}
        for layer in LAYERS:
            present = [n for n in names if n in self.available[layer]]
            keep = {self.work / file_name(layer, n) for n in present}
            keep |= {self.work / fallback_file_name(layer, n) for n in present if layer == "lossyear"}
            paths = []
            for n in present:
                if layer == "lossyear" and n in self.fallback:
                    paths.append(self._fetch(layer, n, keep, fallback=True))
                    continue
                if (layer, n) not in self.missing:
                    try:
                        paths.append(self._fetch(layer, n, keep))
                        continue
                    except GranuleNotFound as e:
                        print(f"avertissement : dalle listée absente du serveur (404), {layer} {n} : {e}")
                        self.missing.add((layer, n))
                if (layer == "lossyear" and ("treecover2000", n) not in self.missing
                        and (out[0][self._window(n, bounds, w, h)] >= FOREST_THRESHOLD).any()):
                    if self.fallback_base is None:
                        raise HansenReadError(f"lossyear {n} absent (404) sur une zone de forêt, sans dépôt de repli")
                    try:
                        paths.append(self._fetch(layer, n, keep, fallback=True))
                    except GranuleNotFound as e:
                        raise HansenReadError(
                            f"lossyear {n} absent (404) sur une zone de forêt, en v1.12 et en {FALLBACK_VERSION}") from e
                    print(f"repli : lossyear {n} lu en {FALLBACK_VERSION} (absent en v1.12, forêt présente)")
                    self.fallback.add(n)
            absent[layer] = {n for n in present if (layer, n) in self.missing and n not in self.fallback}
            out.append(self._warp(paths, bounds, w, h, layer) if paths else np.zeros((h, w), np.uint8))
        cover, loss = out
        # Un lossyear 404 sur de la forêt a déjà été remplacé par le repli R7 (ou a levé) : il ne
        # reste à vérifier que treecover2000 seul absent.
        only_cover = absent["treecover2000"] - absent["lossyear"]
        for n in sorted(only_cover):
            if loss[self._window(n, bounds, w, h)].any():
                raise HansenReadError(f"treecover2000 {n} absent (404) sur une zone de pertes")
        return cover, loss

    @staticmethod
    def _window(name: str, bounds: Bounds, w: int, h: int) -> tuple[slice, slice]:
        """Pixels du bloc couverts par la dalle `name` (10° × 10°, coin haut-gauche dans le nom)."""
        top = int(name[:2]) * (1 if name[2] == "N" else -1)
        left = int(name[4:7]) * (1 if name[7] == "E" else -1)
        sx, sy = w / bounds.width, h / bounds.height
        c0 = max(0, math.floor((left - bounds.lon_min) * sx))
        c1 = min(w, math.ceil((left + GRANULE_DEG - bounds.lon_min) * sx))
        r0 = max(0, math.floor((bounds.lat_max - top) * sy))
        r1 = min(h, math.ceil((bounds.lat_max - (top - GRANULE_DEG)) * sy))
        return slice(r0, r1), slice(c0, c1)

    def close(self) -> None:
        """Supprime les dalles téléchargées (dossier de travail des runners ≈ 14 Go)."""
        for p in self._cache:
            p.unlink(missing_ok=True)
        self._cache.clear()
        for p in self.work.glob("*.part"):  # restes d'un téléchargement interrompu
            p.unlink(missing_ok=True)

    def __enter__(self) -> "HansenBackend":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
