"""Orchestration (spec couches §8). Les effets sont injectés : `run` se teste sans
réseau ni eccodes. Règle : la source primaire échoue bruyamment ou publie valide ;
la source secondaire en échec reporte ses couches précédentes."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from pipeline import config, nomads, publish, texture
from pipeline.grib_adapter import Field
from pipeline.layers import LAYERS, LayerSpec, by_source
from pipeline.metadata import build_legacy, build_manifest, iso_utc, layer_entry, to_json
from pipeline.publish import Object
from pipeline.run_selection import Candidate, candidates_for
from pipeline.sources import SOURCES, SourceSpec

log = logging.getLogger("pipeline")

EXIT_OK = 0
EXIT_SOURCE = 2    # source primaire : aucun candidat téléchargeable
EXIT_DATA = 3      # source primaire : décodage ou validation en échec
EXIT_PUBLISH = 4   # upload R2 en échec

Download = Callable[[str], bytes]
Decode = Callable[[bytes, Sequence[LayerSpec]], dict[str, Field]]
Upload = Callable[[Sequence[Object]], None]
ReadCurrent = Callable[[], "dict | None"]


class SourceFailure(Exception):
    def __init__(self, exit_code: int, message: str):
        super().__init__(message)
        self.exit_code = exit_code


@dataclass
class SourceOutput:
    entries: dict[str, dict] = field(default_factory=dict)   # id → entrée manifeste
    pngs: dict[str, bytes] = field(default_factory=dict)     # id → PNG neuf (vide si repris)
    fresh: bool = False


def _fetch_first_available(
    source: SourceSpec, specs: Sequence[LayerSpec], cands: list[Candidate], download: Download, sleep: Callable[[float], None],
) -> tuple[Candidate, bytes] | None:
    for c in cands:
        url = nomads.build_url(source, c, specs)
        for attempt in (1, 2):
            try:
                data = download(url)
            except nomads.NotFound:
                log.info("%s absent : run %s f%03d", source.id, iso_utc(c.run), c.forecast_hour)
                break
            except nomads.TransientError as exc:
                log.warning("%s erreur transitoire (%s) : run %s f%03d, tentative %d", source.id, exc, iso_utc(c.run), c.forecast_hour, attempt)
                if attempt == 1:
                    sleep(config.RETRY_DELAY_S)
                continue
            log.info("%s téléchargé : run %s f%03d, %d octets", source.id, iso_utc(c.run), c.forecast_hour, len(data))
            return c, data
    return None


def _current_entries(current: Mapping | None, ids: Sequence[str]) -> dict[str, dict]:
    layers = (current or {}).get("layers") or {}
    return {i: layers[i] for i in ids if isinstance(layers.get(i), dict)}


def _up_to_date(entries: Mapping[str, dict], ids: Sequence[str], c: Candidate) -> bool:
    return all(
        i in entries and entries[i].get("run") == iso_utc(c.run) and entries[i].get("forecast_hour") == c.forecast_hour
        for i in ids
    )


def _process_source(
    source: SourceSpec, specs: Sequence[LayerSpec], now: datetime, current: Mapping | None,
    download: Download, decode: Decode, sleep: Callable[[float], None],
) -> SourceOutput:
    ids = [s.id for s in specs]
    cands = candidates_for(source, now)
    if not cands:
        raise SourceFailure(EXIT_SOURCE, f"{source.id} : aucun candidat pour {iso_utc(now)}")
    reused = _current_entries(current, ids)
    if _up_to_date(reused, ids, cands[0]):
        log.info("%s déjà publié : run %s f%03d", source.id, iso_utc(cands[0].run), cands[0].forecast_hour)
        return SourceOutput(reused, {}, False)
    got = _fetch_first_available(source, specs, cands, download, sleep)
    if got is None:
        raise SourceFailure(EXIT_SOURCE, f"{source.id} : source indisponible, {len(cands)} candidats épuisés")
    cand, data = got
    out = SourceOutput(fresh=True)
    try:
        fields = decode(data, specs)
        for spec in specs:
            converted, pixels = texture.layer_pixels(fields[spec.id], spec)
            out.entries[spec.id] = layer_entry(spec, source, cand, converted, now)
            out.pngs[spec.id] = texture.encode_png(pixels)
    except Exception as exc:
        raise SourceFailure(EXIT_DATA, f"{source.id} : données invalides : {exc}") from exc
    return out


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
    current = read_current()
    outputs: dict[str, SourceOutput] = {}
    for source in SOURCES.values():  # primaire d'abord
        specs = by_source(source.id)
        try:
            outputs[source.id] = _process_source(source, specs, now, current, download, decode, sleep)
        except SourceFailure as exc:
            if source.primary:
                log.error("%s", exc)
                return exc.exit_code
            log.warning("%s — couches %s reportées depuis le manifeste courant", exc, [s.id for s in specs], exc_info=True)
            outputs[source.id] = SourceOutput(_current_entries(current, [s.id for s in specs]), {}, False)

    if not any(o.fresh for o in outputs.values()):
        log.info("rien de neuf : manifeste inchangé")
        return EXIT_OK

    entries: dict[str, dict] = {}
    pngs: dict[str, bytes] = {}
    for o in outputs.values():
        entries.update(o.entries)
        pngs.update(o.pngs)

    objects = [Object(f"{config.LAYERS_PREFIX}/{s.id}.png", pngs[s.id], "image/png") for s in LAYERS if s.id in pngs]
    if "temp" in pngs:
        objects.append(Object(config.LEGACY_PNG_KEY, pngs["temp"], "image/png"))
        objects.append(Object(config.LEGACY_JSON_KEY, to_json(build_legacy(entries["temp"])), "application/json"))
    objects.append(Object(config.MANIFEST_KEY, to_json(build_manifest(entries, now)), "application/json"))

    for o in objects:
        publish.write_atomic(out_dir / o.key, o.body)
    log.info("écrit : %s (%d objets, %d couches)", out_dir, len(objects), len(entries))

    if upload is None:
        log.info("dry-run : pas d'upload")
        return EXIT_OK
    try:
        upload(objects)
    except publish.PublishError as exc:
        log.error("publication en échec : %s", exc)
        return EXIT_PUBLISH
    log.info("publié : %s", ", ".join(f"{i} {e['run']} f{e['forecast_hour']:03d}" for i, e in entries.items()))
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    import argparse
    import sys
    from datetime import timezone

    from pipeline.grib_adapter import decode_fields

    parser = argparse.ArgumentParser(prog="pipeline", description="GFS + GEFS-Aerosols → layers/*.png + layers/latest.json")
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
        decode=decode_fields,
        upload=(lambda objects: publish.upload_r2(cfg, objects)) if cfg else None,
        read_current=(lambda: publish.read_current(cfg)) if cfg else (lambda: None),
        out_dir=args.out,
    )


if __name__ == "__main__":
    raise SystemExit(main())
