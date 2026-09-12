import json
from pathlib import Path

import pytest

from pipeline.publish import Object, PublishError, R2Config, read_current, upload_r2, write_atomic

ENV = {
    "R2_ACCOUNT_ID": "acc", "R2_ACCESS_KEY_ID": "key",
    "R2_SECRET_ACCESS_KEY": "secret", "R2_BUCKET": "worldtemp",
}


class FakeClient:
    """Enregistre les put_object ; peut échouer sur une clé donnée."""

    def __init__(self, fail_on: str | None = None, current: bytes | None = None):
        self.calls: list[dict] = []
        self.gets: list[str] = []
        self.fail_on = fail_on
        self.current = current

    def put_object(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs["Key"] == self.fail_on:
            raise RuntimeError("boom")

    def get_object(self, **kwargs):
        self.gets.append(kwargs["Key"])
        if self.current is None:
            raise RuntimeError("NoSuchKey")
        return {"Body": _Body(self.current)}


class _Body:
    def __init__(self, data):
        self._data = data

    def read(self):
        return self._data


# --- write_atomic ---------------------------------------------------------

def test_write_atomic_creates_parents_and_leaves_no_temp(tmp_path: Path):
    target = tmp_path / "out" / "latest.png"
    write_atomic(target, b"abc")
    assert target.read_bytes() == b"abc"
    assert list((tmp_path / "out").iterdir()) == [target]


def test_write_atomic_overwrites(tmp_path: Path):
    target = tmp_path / "f"
    write_atomic(target, b"1")
    write_atomic(target, b"22")
    assert target.read_bytes() == b"22"


# --- R2Config -------------------------------------------------------------

def test_from_env_complete():
    cfg = R2Config.from_env(ENV)
    assert cfg == R2Config("acc", "key", "secret", "worldtemp")
    assert cfg.endpoint_url == "https://acc.r2.cloudflarestorage.com"


@pytest.mark.parametrize("missing", list(ENV))
def test_from_env_missing_any_secret_is_dry_run(missing):
    env = {k: v for k, v in ENV.items() if k != missing}
    assert R2Config.from_env(env) is None


def test_from_env_empty_value_is_dry_run():
    assert R2Config.from_env({**ENV, "R2_BUCKET": ""}) is None


# --- upload_r2 ------------------------------------------------------------

PNG = Object("layers/temp.png", b"png", "image/png")
JS = Object("layers/latest.json", b"{}", "application/json")


def test_upload_objects_in_order_with_headers():
    client = FakeClient()
    upload_r2(R2Config.from_env(ENV), [PNG, JS], client_factory=lambda cfg: client)
    assert [c["Key"] for c in client.calls] == ["layers/temp.png", "layers/latest.json"]
    png, js = client.calls
    assert png["Bucket"] == "worldtemp" and png["Body"] == b"png"
    assert png["ContentType"] == "image/png" and js["ContentType"] == "application/json"
    assert png["CacheControl"] == js["CacheControl"] == "public, max-age=300"


def test_upload_stops_at_first_failure():
    client = FakeClient(fail_on="layers/temp.png")
    with pytest.raises(PublishError):
        upload_r2(R2Config.from_env(ENV), [PNG, JS], client_factory=lambda cfg: client)
    assert [c["Key"] for c in client.calls] == ["layers/temp.png"]


def test_upload_last_failure_raises_publish_error():
    client = FakeClient(fail_on="layers/latest.json")
    with pytest.raises(PublishError):
        upload_r2(R2Config.from_env(ENV), [PNG, JS], client_factory=lambda cfg: client)


# --- read_current ---------------------------------------------------------

def test_read_current_reads_manifest_key_by_default():
    client = FakeClient(current=json.dumps({"schema_version": 2, "layers": {}}).encode())
    got = read_current(R2Config.from_env(ENV), client_factory=lambda cfg: client)
    assert got == {"schema_version": 2, "layers": {}}
    assert client.gets == ["layers/latest.json"]


def test_read_current_absent_or_broken_is_none():
    assert read_current(R2Config.from_env(ENV), client_factory=lambda cfg: FakeClient()) is None
    assert read_current(R2Config.from_env(ENV), client_factory=lambda cfg: FakeClient(current=b"{not json")) is None
