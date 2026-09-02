"""Prépare la texture couleur de base du globe (spec globe §2).

Source : NASA Blue Marble Next Generation, août 2004, 5400 × 2700, domaine public
(https://visibleearth.nasa.gov/images/73776). Sortie : JPEG 4096 × 2048 commité
dans web/public/textures/. À relancer seulement pour changer la source.

Usage : .venv/Scripts/python tools/prepare_bluemarble.py
"""

from __future__ import annotations

import io
import urllib.request
from pathlib import Path

from PIL import Image

URL = (
    "https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73776/"
    "world.topo.bathy.200408.3x5400x2700.jpg"
)
SOURCE_SIZE = (5400, 2700)
TARGET_SIZE = (4096, 2048)
OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "textures" / "blue-marble-4k.jpg"


def main() -> None:
    with urllib.request.urlopen(URL, timeout=120) as resp:
        data = resp.read()
    img = Image.open(io.BytesIO(data)).convert("RGB")
    if img.size != SOURCE_SIZE:
        raise SystemExit(f"taille inattendue {img.size}, {SOURCE_SIZE} attendue")
    img = img.resize(TARGET_SIZE, Image.Resampling.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "JPEG", quality=85, optimize=True, progressive=True)
    print(f"{OUT} : {OUT.stat().st_size} octets")


if __name__ == "__main__":
    main()
