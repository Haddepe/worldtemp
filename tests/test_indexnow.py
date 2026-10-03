"""Tests de la logique pure de tools/indexnow.py (l'appel réseau n'est pas testé).

    python -m unittest discover -s tests

Stdlib seule, comme `test_history_check.py` ; attendus écrits en dur, et chaque
contrôle a un cas qui passe ET un cas qui échoue.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from indexnow import (  # noqa: E402
    HOST,
    KEY,
    IndexNowError,
    build_payload,
    check_key_file,
    urls_from_sitemap,
)

ROOT = Path(__file__).resolve().parent.parent

SITEMAP_TWO = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://globelayers.com/</loc>
  </url>
  <url><loc> https://globelayers.com/temperature </loc></url>
</urlset>
"""


class UrlsFromSitemapTest(unittest.TestCase):
    def test_extracts_every_loc_in_order_and_strips_spaces(self) -> None:
        self.assertEqual(
            urls_from_sitemap(SITEMAP_TWO),
            ["https://globelayers.com/", "https://globelayers.com/temperature"],
        )

    def test_rejects_url_of_another_host(self) -> None:
        xml = SITEMAP_TWO.replace("https://globelayers.com/temperature", "https://example.com/x")
        with self.assertRaisesRegex(IndexNowError, "example.com"):
            urls_from_sitemap(xml)

    def test_rejects_plain_http(self) -> None:
        xml = SITEMAP_TWO.replace("https://globelayers.com/temperature", "http://globelayers.com/t")
        with self.assertRaisesRegex(IndexNowError, "http://globelayers.com/t"):
            urls_from_sitemap(xml)

    def test_rejects_empty_sitemap(self) -> None:
        xml = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'
        with self.assertRaisesRegex(IndexNowError, "aucune URL"):
            urls_from_sitemap(xml)

    def test_published_sitemap_lists_home(self) -> None:
        xml = (ROOT / "web" / "public" / "sitemap.xml").read_text(encoding="utf-8")
        self.assertIn("https://globelayers.com/", urls_from_sitemap(xml))


class BuildPayloadTest(unittest.TestCase):
    def test_payload_names_host_key_and_key_location(self) -> None:
        self.assertEqual(
            build_payload(["https://globelayers.com/"]),
            {
                "host": "globelayers.com",
                "key": "0e7c671bd5f632c5d0a560cb6667c6b6",
                "keyLocation": "https://globelayers.com/0e7c671bd5f632c5d0a560cb6667c6b6.txt",
                "urlList": ["https://globelayers.com/"],
            },
        )


class CheckKeyFileTest(unittest.TestCase):
    def test_accepts_file_holding_the_key(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / f"{KEY}.txt").write_text(KEY + "\n", encoding="utf-8")
            check_key_file(Path(d))

    def test_rejects_missing_file(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(IndexNowError, "absent"):
                check_key_file(Path(d))

    def test_rejects_file_with_another_key(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / f"{KEY}.txt").write_text("deadbeef", encoding="utf-8")
            with self.assertRaisesRegex(IndexNowError, "contenu"):
                check_key_file(Path(d))

    def test_committed_public_key_file_matches(self) -> None:
        check_key_file(ROOT / "web" / "public")


class ConstantsTest(unittest.TestCase):
    def test_host_and_key_shape(self) -> None:
        self.assertEqual(HOST, "globelayers.com")
        self.assertRegex(KEY, r"^[0-9a-f]{32}$")


if __name__ == "__main__":
    unittest.main()
