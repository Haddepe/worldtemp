import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from pipeline import nomads, texture
from pipeline.grib_adapter import Field
from pipeline.main import EXIT_DATA, EXIT_OK, EXIT_PUBLISH, EXIT_SOURCE, run
from pipeline.publish import PublishError

NOW = datetime(2026, 8, 30, 14, 20, tzinfo=timezone.utc)
FIRST_RUN = "2026-08-30T06:00:00Z"  # 1er candidat à 14:20 : 06z f008


def good_field(value=288.15):
    return Field(np.full((721, 1440), value, np.float32), np.linspace(90, -90, 721), np.arange(0, 360, 0.25))


class Recorder:
    def __init__(self):
        self.downloads: list[str] = []
        self.uploads: list[tuple[bytes, bytes]] = []
        self.sleeps: list[float] = []


def make_run(tmp_path: Path, *, download=None, decode=None, upload=None, current=None):
    rec = Recorder()

    def _download(url):
        rec.downloads.append(url)
        return b"GRIB" if download is None else download(url, len(rec.downloads))

    def _decode(data):
        return good_field() if decode is None else decode(data)

    def _upload(png, js):
        rec.uploads.append((png, js))
        if upload is not None:
            upload(png, js)

    code = run(
        NOW, download=_download, decode=_decode, upload=_upload,
        read_current=lambda: current, out_dir=tmp_path, sleep=rec.sleeps.append,
    )
    return code, rec


def test_happy_path_writes_files_and_uploads(tmp_path):
    code, rec = make_run(tmp_path)
    assert code == EXIT_OK
    assert len(rec.downloads) == 1 and "f008" in rec.downloads[0]
    assert (tmp_path / "latest.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    meta = json.loads((tmp_path / "latest.json").read_text())
    assert meta["run"] == FIRST_RUN and meta["forecast_hour"] == 8
    assert meta["stats"] == {"min_c": 15.0, "max_c": 15.0}
    assert len(rec.uploads) == 1
    png, js = rec.uploads[0]
    assert png == (tmp_path / "latest.png").read_bytes() and js == (tmp_path / "latest.json").read_bytes()


def test_404_moves_to_next_candidate(tmp_path):
    def download(url, n):
        if n == 1:
            raise nomads.NotFound(url)
        return b"GRIB"

    code, rec = make_run(tmp_path, download=download)
    assert code == EXIT_OK
    assert "f008" in rec.downloads[0] and "f014" in rec.downloads[1]
    assert rec.sleeps == []


def test_transient_error_retries_once_after_delay_then_next(tmp_path):
    def download(url, n):
        if n <= 2:
            raise nomads.TransientError("503")
        return b"GRIB"

    code, rec = make_run(tmp_path, download=download)
    assert code == EXIT_OK
    assert rec.downloads[0] == rec.downloads[1]      # retry du même candidat
    assert "f014" in rec.downloads[2]                 # puis le suivant
    assert rec.sleeps == [30]


def test_all_candidates_exhausted_is_exit_2(tmp_path):
    def download(url, n):
        raise nomads.NotFound(url)

    code, rec = make_run(tmp_path, download=download)
    assert code == EXIT_SOURCE
    assert len(rec.downloads) == 4
    assert rec.uploads == [] and not (tmp_path / "latest.png").exists()


def test_invalid_field_is_exit_3_without_upload(tmp_path):
    v = np.full((721, 1440), 288.15, np.float32)
    v[0, 0] = np.nan
    code, rec = make_run(tmp_path, decode=lambda data: Field(v, np.linspace(90, -90, 721), np.arange(0, 360, 0.25)))
    assert code == EXIT_DATA
    assert rec.uploads == [] and not (tmp_path / "latest.png").exists()


def test_decode_exception_is_exit_3(tmp_path):
    def decode(data):
        raise RuntimeError("Cannot find the ecCodes library")

    code, rec = make_run(tmp_path, decode=decode)
    assert code == EXIT_DATA
    assert len(rec.downloads) == 1  # pas de candidat suivant sur erreur de décodage


def test_upload_failure_is_exit_4_but_local_files_exist(tmp_path):
    def upload(png, js):
        raise PublishError("boom")

    code, rec = make_run(tmp_path, upload=upload)
    assert code == EXIT_PUBLISH
    assert (tmp_path / "latest.png").exists()


def test_already_published_is_noop_exit_0(tmp_path):
    code, rec = make_run(tmp_path, current={"run": FIRST_RUN, "forecast_hour": 8})
    assert code == EXIT_OK
    assert rec.downloads == [] and rec.uploads == []


def test_stale_published_metadata_does_not_block(tmp_path):
    code, rec = make_run(tmp_path, current={"run": FIRST_RUN, "forecast_hour": 7})
    assert code == EXIT_OK
    assert len(rec.downloads) == 1


def test_dry_run_when_upload_is_none(tmp_path):
    code = run(
        NOW, download=lambda url: b"GRIB", decode=lambda d: good_field(), upload=None,
        read_current=lambda: None, out_dir=tmp_path, sleep=lambda s: None,
    )
    assert code == EXIT_OK
    assert (tmp_path / "latest.json").exists()


def test_run_applies_longitude_roll(tmp_path):
    # Rampe de longitude en Kelvin (colonne 0 → 273,15 K, colonne 1439 → ~323,12 K),
    # tuilée sur les 721 lignes ; entièrement dans la plage plausible [180, 340].
    ramp_row = 273.15 + np.arange(1440, dtype=np.float32) / 1440 * 50
    values = np.tile(ramp_row, (721, 1)).astype(np.float32)
    field = Field(values, np.linspace(90, -90, 721), np.arange(0, 360, 0.25))

    code, rec = make_run(tmp_path, decode=lambda data: field)
    assert code == EXIT_OK

    img = Image.open(tmp_path / "latest.png")
    pixels = np.array(img)

    expected_from_col0 = texture.quantize(texture.kelvin_to_celsius(ramp_row[0:1]))[0]
    expected_from_col720 = texture.quantize(texture.kelvin_to_celsius(ramp_row[720:721]))[0]

    # roll de 720 colonnes exactement une fois : x=720 porte la colonne GFS 0,
    # x=0 porte la colonne GFS 720.
    assert pixels[0, 720] == expected_from_col0
    assert pixels[0, 0] == expected_from_col720
