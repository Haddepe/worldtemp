"""Orchestration (spec §3, §6). Les effets sont injectés : `run` se teste sans
réseau ni cfgrib. Règle : échouer bruyamment ou publier une texture valide,
jamais entre les deux."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from pipeline import config, nomads, publish, texture
from pipeline.grib_adapter import Field
from pipeline.metadata import build_metadata, iso_utc, to_json
from pipeline.run_selection import Candidate, candidates

log = logging.getLogger("pipeline")

EXIT_OK = 0
EXIT_SOURCE = 2    # aucun candidat téléchargeable
EXIT_DATA = 3      # décodage ou validation en échec — bug ou format changé
EXIT_PUBLISH = 4   # upload R2 en échec

Download = Callable[[str], bytes]
Decode = Callable[[bytes], Field]
Upload = Callable[[bytes, bytes], None]
ReadCurrent = Callable[[], "dict | None"]


def _fetch_first_available(cands: list[Candidate], download: Download, sleep: Callable[[float], None]) -> tuple[Candidate, bytes] | None:
    for c in cands:
        url = nomads.build_url(c)
        for attempt in (1, 2):
            try:
                data = download(url)
            except nomads.NotFound:
                log.info("absent : run %s f%03d", iso_utc(c.run), c.forecast_hour)
                break
            except nomads.TransientError as exc:
                log.warning("erreur transitoire (%s) : run %s f%03d, tentative %d", exc, iso_utc(c.run), c.forecast_hour, attempt)
                if attempt == 1:
                    sleep(config.RETRY_DELAY_S)
                continue
            log.info("téléchargé : run %s f%03d, %d octets", iso_utc(c.run), c.forecast_hour, len(data))
            return c, data
    return None


def _already_published(current: dict | None, c: Candidate) -> bool:
    return bool(current) and current.get("run") == iso_utc(c.run) and current.get("forecast_hour") == c.forecast_hour


def run(
    now: datetime,
    *,
    download: Download,
    decode: Decode,
    upload: Upload | None,
    read_current: ReadCurrent,
    out_dir: Path,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    cands = candidates(now)
    if not cands:
        log.error("aucun candidat pour %s", iso_utc(now))
        return EXIT_SOURCE

    if _already_published(read_current(), cands[0]):
        log.info("déjà publié : run %s f%03d", iso_utc(cands[0].run), cands[0].forecast_hour)
        return EXIT_OK

    got = _fetch_first_available(cands, download, sleep)
    if got is None:
        log.error("source indisponible : %d candidats épuisés", len(cands))
        return EXIT_SOURCE
    cand, data = got

    try:
        field = decode(data)
        texture.validate(field)
    except Exception as exc:
        log.error("données invalides : %s", exc)
        return EXIT_DATA

    celsius = texture.kelvin_to_celsius(texture.reorient(field.values))
    png = texture.encode_png(texture.quantize(celsius))
    meta_json = to_json(build_metadata(cand, celsius, generated_at=now))

    publish.write_atomic(out_dir / "latest.png", png)
    publish.write_atomic(out_dir / "latest.json", meta_json)
    log.info("écrit : %s (%d octets PNG)", out_dir, len(png))

    if upload is None:
        log.info("dry-run : pas d'upload")
        return EXIT_OK
    try:
        upload(png, meta_json)
    except publish.PublishError as exc:
        log.error("publication en échec : %s", exc)
        return EXIT_PUBLISH
    log.info("publié : run %s f%03d, valide %s", iso_utc(cand.run), cand.forecast_hour, iso_utc(cand.valid_time))
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    import argparse
    import sys
    from datetime import timezone

    from pipeline.grib_adapter import decode_grib

    parser = argparse.ArgumentParser(prog="pipeline", description="GFS TMP 2 m → latest.png + latest.json")
    parser.add_argument("--dry-run", action="store_true", help="générer out/ sans publier sur R2")
    parser.add_argument("--out", type=Path, default=Path("out"), help="dossier de sortie (défaut : out)")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)

    cfg = None if args.dry_run else publish.R2Config.from_env()
    if cfg is None:
        log.info("dry-run : aucun upload R2 (%s)", "--dry-run" if args.dry_run else "secrets R2 absents")

    return run(
        datetime.now(timezone.utc),
        download=nomads.download,
        decode=decode_grib,
        upload=(lambda png, js: publish.upload_r2(cfg, png, js)) if cfg else None,
        read_current=(lambda: publish.read_current(cfg)) if cfg else (lambda: None),
        out_dir=args.out,
    )


if __name__ == "__main__":
    raise SystemExit(main())
