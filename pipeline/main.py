"""Orchestration (spec lot E §3). Les effets sont injectés : `run` se teste sans réseau ni
eccodes. Règles : la source primaire publie une frise complète ou garde la précédente ; la
source secondaire en échec reporte ses couches précédentes ; chaque échéance est envoyée dès
qu'elle est prête, si bien qu'un passage interrompu reprend au suivant."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from pipeline import config, nomads, publish, texture
from pipeline.grib_adapter import Field
from pipeline.layers import LayerSpec, by_source
from pipeline.metadata import build_forecast, cited_runs, forecast_entry, frame_entry, frame_key, iso_utc, progress_key, stats_of, to_json
from pipeline.publish import Object, Store
from pipeline.run_selection import Candidate, frame_hours, runs_for
from pipeline.sources import SOURCES, SourceSpec

log = logging.getLogger("pipeline")

EXIT_OK = 0
EXIT_SOURCE = 2    # source primaire : aucun run complet atteignable ni publié
EXIT_DATA = 3      # décodage ou validation en échec
EXIT_PUBLISH = 4   # écriture R2 en échec

Download = Callable[[str], bytes]
Decode = Callable[[bytes, Sequence[LayerSpec]], dict[str, Field]]


class SourceFailure(Exception):
    def __init__(self, exit_code: int, message: str):
        super().__init__(message)
        self.exit_code = exit_code


@dataclass
class SourceOutput:
    entries: dict[str, dict] = field(default_factory=dict)  # id → entrée v3
    fresh: bool = False                                     # vrai : un run neuf à citer


def _current_entries(current: Mapping | None, ids: Sequence[str]) -> dict[str, dict]:
    layers = (current or {}).get("layers") or {}
    return {i: layers[i] for i in ids if isinstance(layers.get(i), dict)}


def _cited_run(entries: Mapping[str, dict], ids: Sequence[str]) -> str | None:
    """Run (ISO) que le manifeste courant cite pour toute la source, s'il a une frise pour chaque couche."""
    if not all(i in entries and entries[i].get("frames") for i in ids):
        return None
    cited = {entries[i].get("run") for i in ids}
    return cited.pop() if len(cited) == 1 else None


def _download(
    source: SourceSpec, specs: Sequence[LayerSpec], cand: Candidate, download: Download, sleep: Callable[[float], None],
) -> bytes | None:
    """GRIB d'une échéance ; None si elle n'est pas (encore) sur NOMADS ou après deux erreurs transitoires."""
    url = nomads.build_url(source, cand, specs)
    for attempt in (1, 2):
        try:
            data = download(url)
        except nomads.NotFound:
            log.info("%s absent : run %s f%03d", source.id, iso_utc(cand.run), cand.forecast_hour)
            return None
        except nomads.TransientError as exc:
            log.warning("%s erreur transitoire (%s) : run %s f%03d, tentative %d",
                        source.id, exc, iso_utc(cand.run), cand.forecast_hour, attempt)
            if attempt == 1:
                sleep(config.RETRY_DELAY_S)
            continue
        log.info("%s téléchargé : run %s f%03d, %d octets", source.id, iso_utc(cand.run), cand.forecast_hour, len(data))
        return data
    return None


def _progress(store: Store, run: datetime, source: SourceSpec) -> dict[str, dict]:
    """Stats des échéances déjà publiées pour ce run : {"<fh>": {id: {"min", "max"}}}."""
    raw = store.get_json(progress_key(run, source.id))
    if not raw or raw.get("run") != iso_utc(run) or not isinstance(raw.get("stats"), dict):
        return {}
    return raw["stats"]


def _fill_run(
    source: SourceSpec, specs: Sequence[LayerSpec], run: datetime, hours: Sequence[int], store: Store,
    download: Download, decode: Decode, sleep: Callable[[float], None],
) -> dict[str, list[dict]] | None:
    """Complète la frise de `run` (spec lot E §3.2). Renvoie les frames par couche quand toutes les
    `hours` sont publiées, None si une échéance manque encore (reprise au passage suivant)."""
    ids = [s.id for s in specs]
    stats = _progress(store, run, source)
    for fh in hours:
        done = stats.get(str(fh))
        if isinstance(done, dict) and all(i in done for i in ids):
            continue
        data = _download(source, specs, Candidate(run, fh), download, sleep)
        if data is None:
            return None
        objects: list[Object] = []
        frame_stats: dict[str, dict] = {}
        try:
            fields = decode(data, specs)
            for spec in specs:
                converted, pixels = texture.layer_pixels(fields[spec.id], spec)
                objects.append(Object(frame_key(run, spec.id, fh), texture.encode_png(pixels), "image/png", config.CACHE_IMMUTABLE))
                frame_stats[spec.id] = stats_of(converted)
        except Exception as exc:
            raise SourceFailure(EXIT_DATA, f"{source.id} : données invalides (run {iso_utc(run)} f{fh:03d}) : {exc}") from exc
        stats[str(fh)] = frame_stats
        # PNG d'abord, progression ensuite : la progression ne cite jamais un PNG absent.
        progress = to_json({"run": iso_utc(run), "source": source.id, "stats": stats})
        objects.append(Object(progress_key(run, source.id), progress, "application/json"))
        store.put(objects)
    return {i: [frame_entry(i, run, fh, stats[str(fh)][i]) for fh in hours] for i in ids}


def _process_source(
    source: SourceSpec, specs: Sequence[LayerSpec], now: datetime, current: Mapping | None, hours: Sequence[int],
    store: Store, download: Download, decode: Decode, sleep: Callable[[float], None],
) -> SourceOutput:
    ids = [s.id for s in specs]
    reused = _current_entries(current, ids)
    cited = _cited_run(reused, ids)
    candidates = runs_for(source, now)
    for run in candidates:  # du plus récent au plus ancien
        if cited is not None and iso_utc(run) <= cited:
            log.info("%s déjà publié : run %s", source.id, cited)
            return SourceOutput(reused)
        frames = _fill_run(source, specs, run, hours, store, download, decode, sleep)
        if frames is not None:
            log.info("%s : frise complète, run %s (%d échéances)", source.id, iso_utc(run), len(hours))
            return SourceOutput({s.id: forecast_entry(s, source, run, frames[s.id], now) for s in specs}, fresh=True)
        if cited is not None:
            log.info("%s : run %s incomplet, le run %s reste publié", source.id, iso_utc(run), cited)
            return SourceOutput(reused)
        # Aucun run complet publié (premier déploiement) : on essaie le candidat plus ancien.
    raise SourceFailure(EXIT_SOURCE, f"{source.id} : aucun run complet parmi {len(candidates)} candidats")


def _retain(store: Store, previous: Mapping | None, manifest: Mapping) -> None:
    """Rétention (spec lot E §4.3) : supprime les dossiers de run cités ni par l'ancien manifeste
    (encore servi par le CDN ≤ 300 s) ni par le nouveau, et plus anciens que le plus récent run
    cité (un run plus récent est en cours de téléchargement). Clés hors dossiers de run jamais
    touchées. Un échec n'empêche pas la publication : réessai au prochain manifeste."""
    keep = cited_runs(previous) | cited_runs(manifest)
    newest = max(cited_runs(manifest), default=None)
    if newest is None:
        return
    try:
        doomed = [d for d in store.list_run_dirs() if d not in keep and d < newest]
        if doomed:
            n = store.delete_run_dirs(doomed)
            log.info("rétention : %d objets supprimés (%s)", n, ", ".join(doomed))
    except Exception as exc:
        log.warning("rétention en échec (%s) : réessai au prochain manifeste publié", exc)


def run(
    now: datetime,
    *,
    download: Download,
    decode: Decode,
    store: Store,
    out_dir: Path,
    hours: Sequence[int] = config.FRAME_HOURS,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    current = store.get_json(config.FORECAST_KEY)
    if current is not None and current.get("schema_version") != config.FORECAST_SCHEMA_VERSION:
        current = None
    outputs: dict[str, SourceOutput] = {}
    for source in SOURCES.values():  # primaire d'abord
        specs = by_source(source.id)
        try:
            outputs[source.id] = _process_source(source, specs, now, current, hours, store, download, decode, sleep)
        except publish.PublishError as exc:
            log.error("publication en échec : %s", exc)
            return EXIT_PUBLISH
        except SourceFailure as exc:
            if source.primary:
                log.error("%s", exc)
                return exc.exit_code
            log.warning("%s — couches %s reportées depuis le manifeste courant", exc, [s.id for s in specs], exc_info=True)
            outputs[source.id] = SourceOutput(_current_entries(current, [s.id for s in specs]))

    if not any(o.fresh for o in outputs.values()):
        log.info("rien de neuf : manifeste inchangé")
        return EXIT_OK

    entries: dict[str, dict] = {}
    for o in outputs.values():
        entries.update(o.entries)
    manifest = build_forecast(entries, now)
    body = to_json(manifest)
    publish.write_atomic(out_dir / config.FORECAST_KEY, body)  # copie locale : artefact du workflow
    try:
        store.put([Object(config.FORECAST_KEY, body, "application/json")])
    except publish.PublishError as exc:
        log.error("publication en échec : %s", exc)
        return EXIT_PUBLISH
    log.info("publié : %s", ", ".join(f"{i} {e['run']}" for i, e in entries.items()))
    _retain(store, current, manifest)
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    import argparse
    import sys
    from datetime import timezone

    from pipeline.grib_adapter import decode_fields

    parser = argparse.ArgumentParser(prog="pipeline", description="GFS + GEFS-Aerosols → layers/<run>/*.png + layers/forecast.json")
    parser.add_argument("--dry-run", action="store_true", help="générer out/ sans publier sur R2")
    parser.add_argument("--out", type=Path, default=Path("out"), help="dossier de sortie (défaut : out)")
    parser.add_argument("--max-frames", type=int, default=None, metavar="N",
                        help="ne traiter que les N premières échéances (dry-run de la CI)")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)

    cfg = None if args.dry_run else publish.R2Config.from_env()
    if args.max_frames is not None and cfg is not None:
        parser.error("--max-frames n'est permis qu'en dry-run : une frise tronquée ne doit jamais être publiée")
    if cfg is None:
        log.info("dry-run : aucun upload R2 (%s)", "--dry-run" if args.dry_run else "secrets R2 absents")

    store: Store = publish.R2Store(cfg) if cfg else publish.LocalStore(args.out)
    return run(
        datetime.now(timezone.utc),
        download=nomads.download,
        decode=decode_fields,
        store=store,
        out_dir=args.out,
        hours=frame_hours(args.max_frames),
    )


if __name__ == "__main__":
    raise SystemExit(main())
