"""Signale les URLs du sitemap aux moteurs IndexNow (Bing, Yandex, Naver, Seznam, Yep).

    python tools/indexnow.py [dist]        # dist par défaut : web/dist

Lancé par le job `deploy` de `.github/workflows/test.yml`, après `wrangler deploy`.
Lit le sitemap du build (les URLs futures y entrent sans toucher ce script), vérifie
que le fichier-clé est bien dans le build, puis un seul POST à api.indexnow.org, qui
relaie aux autres moteurs. Google ne lit pas IndexNow.

La clé est publique par conception (servie sur `/<clé>.txt`) : ce n'est pas un secret.
Sortie : 0 si l'API répond 200/202, 1 sinon.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

HOST = "globelayers.com"
KEY = "0e7c671bd5f632c5d0a560cb6667c6b6"
ENDPOINT = "https://api.indexnow.org/indexnow"
_SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


class IndexNowError(Exception):
    """Entrée invalide : rien n'est envoyé."""


def urls_from_sitemap(xml: str) -> list[str]:
    """Les `<loc>` du sitemap, dans l'ordre ; toute URL hors de `https://HOST/` lève."""
    root = ET.fromstring(xml)
    urls = [(loc.text or "").strip() for loc in root.iter(f"{_SITEMAP_NS}loc")]
    if not urls:
        raise IndexNowError("sitemap sans aucune URL")
    for url in urls:
        if not url.startswith(f"https://{HOST}/"):
            raise IndexNowError(f"URL hors de https://{HOST}/ : {url}")
    return urls


def build_payload(urls: list[str]) -> dict:
    return {
        "host": HOST,
        "key": KEY,
        "keyLocation": f"https://{HOST}/{KEY}.txt",
        "urlList": urls,
    }


def check_key_file(dist: Path) -> None:
    """Le fichier-clé doit être publié avec le build, sinon l'API refuse (403)."""
    path = dist / f"{KEY}.txt"
    if not path.is_file():
        raise IndexNowError(f"fichier-clé absent : {path}")
    if path.read_text(encoding="utf-8").strip() != KEY:
        raise IndexNowError(f"contenu du fichier-clé différent de la clé : {path}")


def submit(payload: dict) -> int:
    """POST à l'API ; renvoie le code HTTP (les erreurs HTTP comprises)."""
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


def main(argv: list[str]) -> int:
    dist = Path(argv[1]) if len(argv) > 1 else Path("web/dist")
    try:
        check_key_file(dist)
        urls = urls_from_sitemap((dist / "sitemap.xml").read_text(encoding="utf-8"))
    except (IndexNowError, OSError, ET.ParseError) as e:
        print(f"indexnow : {e}", file=sys.stderr)
        return 1
    try:
        status = submit(build_payload(urls))
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"indexnow : appel impossible : {e}", file=sys.stderr)
        return 1
    print(f"indexnow : {len(urls)} URL(s) envoyée(s), HTTP {status}")
    return 0 if status in (200, 202) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
